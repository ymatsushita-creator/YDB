-- =============================================================
-- 起業家アカデミー 集客〜選考 一元管理DB
-- PostgreSQL 15+
--
-- 設計原則
--   1. 記録層は上書きカラムを持たない。導出可能な値は物理保存しない
--   2. 再現不能なものだけ凍結する（スコアのみ）
--   3. 集計定義に関わるマスタは更新せず、追加と非活性化で運用する
--   4. 定義が変わる可能性のあるものは変更履歴を残す
--   5. 訂正は打ち消しの追記で表現し、元の記録は残す
--   6. 変わるものはデータ、変わらないものはコード
--   7. 事実の有無で判定し、理由で分岐しない
--
-- 実装段階
--   [1] 記録層 + マスタ + ダッシュボード(1)(2)
--   [2] Touchpoint分析 + (3)(4) + Partner系
--   [3] スコアリング（着手判断は1年後）
--   [4] 名寄せ候補提示UI（テーブルは[1]で作成済み）
--
-- 値が未定のカラムには「運用時に決定」とコメントを付す。
-- =============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- =============================================================
-- マスタ層
-- =============================================================

-- [1] 学校マスタ。名寄せの完全一致に使うため自由入力を禁じる。
-- 統廃合した学校は物理削除せず is_active = false（原則3）。
CREATE TABLE schools (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text        NOT NULL,
    is_active   boolean     NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT schools_name_key UNIQUE (name)
);


-- [1] 人。林以降の実体。一生1行（資料1-1）。
-- current_stage / 最終接触日 / origin_partner_id は持たない（原則1）。
-- いずれも v_person_state で導出する。
CREATE TABLE persons (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    family_name         text        NOT NULL,
    given_name          text        NOT NULL,
    family_name_kana    text,                       -- 照合には使わない
    given_name_kana     text,
    birth_date          date        NOT NULL,
    school_id           uuid        NOT NULL REFERENCES schools(id),
    faculty             text,                       -- 進学で変わるため照合対象外
    email               text        NOT NULL,
    phone               text,
    line_user_id        text,
    referrer_person_id  uuid        REFERENCES persons(id),  -- 資料3-4 自己参照
    note                text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    anonymized_at       timestamptz,                -- 個人情報削除依頼への対応（資料9-2）
    deleted_at          timestamptz,
    CONSTRAINT persons_no_self_referral CHECK (referrer_person_id IS NULL OR referrer_person_id <> id)
);

CREATE UNIQUE INDEX persons_line_user_id_key
    ON persons (line_user_id) WHERE line_user_id IS NOT NULL;

-- 名寄せ候補の抽出に使う。3項目一致で自動紐づけ、部分一致は候補提示。
CREATE INDEX persons_match_keys_idx
    ON persons (family_name, given_name, birth_date, school_id) WHERE deleted_at IS NULL;


-- [1] 面接官・運営スタッフ。認証と権限の主体。
-- person_id は卒業生スタッフのみ埋まる（NULL 可）。利益相反の検出に使う。
CREATE TABLE staffs (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id     uuid        REFERENCES persons(id),
    display_name  text        NOT NULL,
    email         text        NOT NULL,
    is_active     boolean     NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT staffs_email_key UNIQUE (email)
);

CREATE UNIQUE INDEX staffs_person_id_key
    ON staffs (person_id) WHERE person_id IS NOT NULL;


-- [1] 兼務があるため1人が複数ロールを持つ。
-- 権限モデルは最終的に「確度スコアを見られるか」の1点に縮退したが、
-- ロールの追加は年度ごとに起きるためテーブルとして保持する。
CREATE TABLE staff_roles (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id    uuid        NOT NULL REFERENCES staffs(id) ON DELETE CASCADE,
    role        text        NOT NULL,   -- 値は運用時に決定
    granted_at  timestamptz NOT NULL DEFAULT now(),
    revoked_at  timestamptz,
    CONSTRAINT staff_roles_unique UNIQUE (staff_id, role)
);


-- [1] 年度。enrollment_year は入学年（幹になる年）。
-- outreach_start_date は Touchpoint の年度帰属判定の起点。
-- 期間の重複を許容する（今年の選考中に来年の集客が動くため）。
-- 重複時は enrollment_year が最小の Season に帰属させる。
CREATE TABLE seasons (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    enrollment_year           integer     NOT NULL,
    outreach_start_date       date        NOT NULL,   -- 集客起点。運用時に決定
    application_open_date     date        NOT NULL,
    application_close_date    date        NOT NULL,
    selection_end_date        date        NOT NULL,
    target_application_count  integer,                -- 目標応募数。運用時に決定
    capacity                  integer,                -- 採用枠数。運用時に決定
    created_at                timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT seasons_year_key UNIQUE (enrollment_year),
    CONSTRAINT seasons_date_order CHECK (
        outreach_start_date <= application_open_date
        AND application_open_date <= application_close_date
        AND application_close_date <= selection_end_date
    )
);


-- [1] Season の日付は実質的に集計定義そのもの。
-- 変更すると過去の帰属が動くため、変更履歴を残す（原則4）。
CREATE TABLE season_revisions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id           uuid        NOT NULL REFERENCES seasons(id),
    changed_field       text        NOT NULL,
    old_value           text,
    new_value           text,
    changed_at          timestamptz NOT NULL DEFAULT now(),
    changed_by_staff_id uuid        NOT NULL REFERENCES staffs(id),
    reason              text
);

CREATE INDEX season_revisions_season_idx ON season_revisions (season_id, changed_at);


-- [1] 選考フロー定義。年度ごとに可変（資料5-1）。
-- sla_days は(2)の滞留判定の閾値。ステップごとに異なる。
CREATE TABLE selection_steps (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id     uuid        NOT NULL REFERENCES seasons(id),
    sort_order    integer     NOT NULL,
    name          text        NOT NULL,
    pass_criteria text,                   -- 決定者への参考情報。自動判定には使わない
    sla_days      integer,                -- 運用時に決定
    CONSTRAINT selection_steps_order_key UNIQUE (season_id, sort_order),
    CONSTRAINT selection_steps_name_key  UNIQUE (season_id, name)
);


-- [1] 評価軸。ステップに属するため年度をまたいで共有されない。
-- applies_to = 'reapplicant_only' の軸は再応募者の評価にのみ現れる。
CREATE TABLE evaluation_criteria (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    selection_step_id  uuid    NOT NULL REFERENCES selection_steps(id),
    name               text    NOT NULL,
    scale_max          integer NOT NULL,        -- 運用時に決定
    applies_to         text    NOT NULL DEFAULT 'all',
    sort_order         integer NOT NULL,
    CONSTRAINT evaluation_criteria_applies_to_chk
        CHECK (applies_to IN ('all', 'reapplicant_only')),
    CONSTRAINT evaluation_criteria_order_key UNIQUE (selection_step_id, sort_order)
);


-- [1] 応募の無効化理由。
-- counts_as_application は「この無効化に対応する代替の Application が生まれるか」で決まる。
-- 名寄せ誤り → false（付け替え先で1件数える）、取り下げ → true。
-- 集計定義に関わるため、確定後は更新せず追加と非活性化で運用する（原則3）。
CREATE TABLE void_reasons (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code                   text    NOT NULL,
    label                  text    NOT NULL,
    counts_as_application  boolean NOT NULL,
    is_active              boolean NOT NULL DEFAULT true,
    CONSTRAINT void_reasons_code_key UNIQUE (code)
);


-- [1] 辞退理由。自由入力にすると集計が死ぬため選択式。
-- 辞退理由の分布はチャネルの質を表すため(4)で参照する。
CREATE TABLE withdraw_reasons (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code      text    NOT NULL,
    label     text    NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    CONSTRAINT withdraw_reasons_code_key UNIQUE (code)
);


-- =============================================================
-- 記録層：応募・選考
-- =============================================================

-- [1] 応募。人×年度の交差（資料1-1）。
-- is_reapplication は導出値だが、確定した過去の事実であり、
-- 判定ロジックの散逸を防ぐため物理カラムで保持する（原則1の唯一の例外）。
-- 名寄せ確定処理から必ず再計算する。
-- voided_at（無効化）と deleted_at（個人情報削除）は意味が異なるため分離。
CREATE TABLE applications (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id         uuid        NOT NULL REFERENCES persons(id),
    season_id         uuid        NOT NULL REFERENCES seasons(id),
    submitted_at      timestamptz NOT NULL,          -- フォーム送信時刻。取り込み時刻ではない
    form_response_id  text,                          -- 取り込みの冪等性を担保
    is_reapplication  boolean     NOT NULL DEFAULT false,
    voided_at         timestamptz,
    void_reason_id    uuid        REFERENCES void_reasons(id),
    deleted_at        timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT applications_void_pair CHECK (
        (voided_at IS NULL) = (void_reason_id IS NULL)
    )
);

-- 同一年度の二重応募を防ぐ。無効化・削除済みは対象外。
CREATE UNIQUE INDEX applications_person_season_key
    ON applications (person_id, season_id)
    WHERE voided_at IS NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX applications_form_response_key
    ON applications (form_response_id) WHERE form_response_id IS NOT NULL;

CREATE INDEX applications_season_idx ON applications (season_id, submitted_at);


-- [1] 状態遷移の追記ログ（資料1-3）。
-- to_status を文字列で持たず、transition_type + selection_step_id の組で表現する。
-- ステップ名が年度で変わっても型は不変。
-- 訂正は打ち消し行の追記で表現し、元の行は不変（原則5）。
CREATE TABLE status_histories (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id       uuid        NOT NULL REFERENCES applications(id),
    transition_type      text        NOT NULL,
    selection_step_id    uuid        REFERENCES selection_steps(id),
    withdraw_reason_id   uuid        REFERENCES withdraw_reasons(id),
    occurred_at          timestamptz NOT NULL,
    changed_by_staff_id  uuid        NOT NULL REFERENCES staffs(id),
    is_correction        boolean     NOT NULL DEFAULT false,
    corrects_history_id  uuid        REFERENCES status_histories(id),
    note                 text,
    created_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT status_histories_type_chk
        CHECK (transition_type IN ('advance', 'reject', 'withdraw', 'revert')),
    CONSTRAINT status_histories_correction_pair
        CHECK (is_correction = false OR corrects_history_id IS NOT NULL),
    CONSTRAINT status_histories_withdraw_reason
        CHECK (withdraw_reason_id IS NULL OR transition_type = 'withdraw')
);

CREATE INDEX status_histories_application_idx
    ON status_histories (application_id, occurred_at);


-- [1] 評価。応募×ステップ×面接官×試行（資料5-2）。
-- 行の生成はステップ到達時。遷移と面接官の割り当てが同一トランザクションになる。
-- 第1ステップのみ interviewer_staff_id が NULL で生成され、(2)に「担当未割当」として出る。
-- attempt は差し戻し（revert）が起きたときに増える。
CREATE TABLE evaluations (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id        uuid        NOT NULL REFERENCES applications(id),
    selection_step_id     uuid        NOT NULL REFERENCES selection_steps(id),
    interviewer_staff_id  uuid        REFERENCES staffs(id),
    attempt               integer     NOT NULL DEFAULT 1,
    state                 text        NOT NULL DEFAULT 'pending',
    hold_reason           text,
    handover_note         text,       -- 申し送り。評価とは分ける（資料5-3）
    assigned_at           timestamptz NOT NULL DEFAULT now(),  -- (2)の滞留判定の起点
    submitted_at          timestamptz,
    CONSTRAINT evaluations_state_chk
        CHECK (state IN ('pending', 'submitted', 'held')),
    CONSTRAINT evaluations_submitted_pair
        CHECK (state <> 'submitted' OR submitted_at IS NOT NULL),
    CONSTRAINT evaluations_hold_reason_required
        CHECK (state <> 'held' OR hold_reason IS NOT NULL),
    -- NULLS NOT DISTINCT により、担当未割当行の重複も防ぐ（PostgreSQL 15+）
    CONSTRAINT evaluations_assignment_key
        UNIQUE NULLS NOT DISTINCT (application_id, selection_step_id, interviewer_staff_id, attempt)
);

CREATE INDEX evaluations_pending_idx
    ON evaluations (assigned_at) WHERE state = 'pending';

CREATE INDEX evaluations_interviewer_idx
    ON evaluations (interviewer_staff_id, state);


-- [1] 評価軸ごとのスコア。軸が可変なため子テーブルに分離。
-- rationale（根拠エピソード）を必須にする（資料5-3）。
CREATE TABLE evaluation_scores (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    evaluation_id  uuid    NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
    criteria_id    uuid    NOT NULL REFERENCES evaluation_criteria(id),
    score          integer NOT NULL,
    rationale      text    NOT NULL,
    CONSTRAINT evaluation_scores_key UNIQUE (evaluation_id, criteria_id)
);


-- 再応募者限定の評価軸は、is_reapplication = false の応募に付けられない。
-- 外部キーでは表現できないためトリガで担保する。
CREATE OR REPLACE FUNCTION check_criteria_applicability()
RETURNS trigger AS $$
DECLARE
    v_applies_to text;
    v_is_reapp   boolean;
BEGIN
    SELECT ec.applies_to INTO v_applies_to
      FROM evaluation_criteria ec WHERE ec.id = NEW.criteria_id;

    IF v_applies_to = 'reapplicant_only' THEN
        SELECT a.is_reapplication INTO v_is_reapp
          FROM evaluations e
          JOIN applications a ON a.id = e.application_id
         WHERE e.id = NEW.evaluation_id;

        IF NOT v_is_reapp THEN
            RAISE EXCEPTION
                'criteria % is restricted to reapplicants', NEW.criteria_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER evaluation_scores_applicability
    BEFORE INSERT OR UPDATE ON evaluation_scores
    FOR EACH ROW EXECUTE FUNCTION check_criteria_applicability();


-- [4] 同一性判定の履歴。却下（別人と確定）も残す。
-- 残さないと同じ組み合わせが毎年候補として上がる。
-- matched_keys は照合の信頼度を表し、面接官画面での表示に使う。
CREATE TABLE identity_resolutions (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id            uuid        NOT NULL REFERENCES persons(id),
    candidate_person_id  uuid        NOT NULL REFERENCES persons(id),
    decision             text        NOT NULL,
    matched_keys         text[]      NOT NULL,
    decided_at           timestamptz NOT NULL DEFAULT now(),
    decided_by_staff_id  uuid        REFERENCES staffs(id),   -- 自動一致時は NULL
    note                 text,
    CONSTRAINT identity_resolutions_decision_chk
        CHECK (decision IN ('auto_matched', 'confirmed_same', 'confirmed_different')),
    CONSTRAINT identity_resolutions_pair_key
        UNIQUE (person_id, candidate_person_id),
    CONSTRAINT identity_resolutions_not_self
        CHECK (person_id <> candidate_person_id)
);


-- =============================================================
-- 記録層：集客
-- =============================================================

-- [1] 流入チャネル。自由入力を禁じる（資料3-2）。
-- form_param_value は事前入力リンクで渡る値。計測用の細かい粒度を持つ。
-- self_report_group はフォームの自己申告設問で使う粗い粒度。
CREATE TABLE channels (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name               text    NOT NULL,
    form_param_value   text,
    self_report_group  text,
    category           text,
    is_active          boolean NOT NULL DEFAULT true,
    CONSTRAINT channels_name_key UNIQUE (name)
);

CREATE UNIQUE INDEX channels_form_param_key
    ON channels (form_param_value) WHERE form_param_value IS NOT NULL;


-- [1] 接点。複数行で積む（資料3-1）。
-- year を持たない。年度帰属は seasons の日付範囲から都度判定する（原則1）。
-- applied_at があって attended_at が NULL ならドタキャン（資料3-3）。
CREATE TABLE touchpoints (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id         uuid        NOT NULL REFERENCES persons(id),
    channel_id        uuid        NOT NULL REFERENCES channels(id),
    partner_id        uuid,       -- 団体経由の場合のみ。FKは partners 定義後に付与
    occurred_at       timestamptz NOT NULL,
    applied_at        timestamptz,
    attended_at       timestamptz,
    is_self_reported  boolean     NOT NULL DEFAULT false,
    is_scout          boolean     NOT NULL DEFAULT false,  -- タレントプールからの再アプローチ
    source_param      text,       -- 事前入力リンクで渡った生値
    note              text,
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX touchpoints_person_idx  ON touchpoints (person_id, occurred_at);
CREATE INDEX touchpoints_channel_idx ON touchpoints (channel_id, occurred_at);


-- [2] 連携団体。
CREATE TABLE partners (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name               text    NOT NULL,
    category           text,
    contact_name       text,
    contact_email      text,
    first_contact_date date,
    is_active          boolean NOT NULL DEFAULT true,
    CONSTRAINT partners_name_key UNIQUE (name)
);

ALTER TABLE touchpoints
    ADD CONSTRAINT touchpoints_partner_fk FOREIGN KEY (partner_id) REFERENCES partners(id);


-- [2] 団体との関係。送客と講演受入は逆方向のため複数行で持つ（資料4）。
CREATE TABLE partner_relations (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id     uuid    NOT NULL REFERENCES partners(id),
    relation_type  text    NOT NULL,   -- 値は運用時に決定
    started_on     date,
    ended_on       date,
    status         text,
    CONSTRAINT partner_relations_key UNIQUE (partner_id, relation_type, started_on)
);


-- [2] 森。個人識別なしのリーチ記録。1行=1回の接触機会（資料2-2）。
-- person_id を持たない。単位が他と違うため(3)のファネルには並べず(4)に置く。
-- estimated_reach は推定値。実数と同じ縦軸に並べない。
CREATE TABLE partner_reaches (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id       uuid    NOT NULL REFERENCES partners(id),
    season_id        uuid    REFERENCES seasons(id),
    occurred_on      date    NOT NULL,
    method           text,
    estimated_reach  integer,
    note             text
);

CREATE INDEX partner_reaches_partner_idx ON partner_reaches (partner_id, occurred_on);


-- =============================================================
-- スコアリング層（実装段階[3]。着手判断は1年後）
-- =============================================================

-- ルールセット全体で版を切る。個別に版を持つと組み合わせが復元できない。
CREATE TABLE scoring_rule_sets (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    version             integer     NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    created_by_staff_id uuid        NOT NULL REFERENCES staffs(id),
    memo                text,
    CONSTRAINT scoring_rule_sets_version_key UNIQUE (version)
);


-- 条件種別は3種に限定する。無制限にすると誰も説明できないスコアになる。
-- 担当者が編集するのは threshold と points のみ。
CREATE TABLE scoring_rules (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_set_id           uuid    NOT NULL REFERENCES scoring_rule_sets(id),
    condition_type        text    NOT NULL,
    target_key            text    NOT NULL,   -- 評価対象の識別子。運用時に決定
    comparator            text,
    threshold             integer,            -- 運用時に決定
    points                integer NOT NULL,   -- 運用時に決定
    decay_half_life_days  integer,            -- 時間減衰の半減期。運用時に決定
    sort_order            integer NOT NULL,
    CONSTRAINT scoring_rules_condition_chk
        CHECK (condition_type IN ('existence', 'count_threshold', 'recency_days')),
    CONSTRAINT scoring_rules_order_key UNIQUE (rule_set_id, sort_order)
);


-- 計算結果の凍結。ルール変更で再現不能になるため、唯一の正当な物理保存（原則2）。
-- decay_basis_date は募集期なら募集開始日、通年なら算出日。
-- 記録しないと後からどの基準で出た点数か解釈できない。
CREATE TABLE score_snapshots (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id         uuid    NOT NULL REFERENCES persons(id),
    season_id         uuid    NOT NULL REFERENCES seasons(id),
    rule_set_id       uuid    NOT NULL REFERENCES scoring_rule_sets(id),
    calculated_on     date    NOT NULL,
    decay_basis_date  date    NOT NULL,
    total_points      integer NOT NULL,
    CONSTRAINT score_snapshots_key UNIQUE (person_id, season_id, calculated_on)
);

CREATE INDEX score_snapshots_season_idx ON score_snapshots (season_id, calculated_on);


-- 内訳。ないと「なぜこの人は何点なのか」を説明できず、現場が数字を信用しない（資料6-2）。
CREATE TABLE score_snapshot_details (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id     uuid    NOT NULL REFERENCES score_snapshots(id) ON DELETE CASCADE,
    scoring_rule_id uuid    NOT NULL REFERENCES scoring_rules(id),
    raw_points      integer NOT NULL,
    decayed_points  integer NOT NULL,
    CONSTRAINT score_snapshot_details_key UNIQUE (snapshot_id, scoring_rule_id)
);


-- =============================================================
-- 導出ビュー
-- 物理保存しないと決めた値はすべてここで計算する（原則1）。
-- =============================================================

-- [1] 人の現在状態。現在ステージとアクティブ判定を1本にまとめる。
-- どちらも touchpoints と applications を同じ結合で参照するため。
-- 休眠の判定日数はアプリケーション側で指定する（値は運用時に決定）。
CREATE VIEW v_person_state AS
SELECT
    p.id AS person_id,
    p.created_at AS joined_at,
    (SELECT max(t.occurred_at) FROM touchpoints t WHERE t.person_id = p.id)
        AS last_touch_at,
    EXISTS (
        SELECT 1 FROM applications a
         WHERE a.person_id = p.id AND a.voided_at IS NULL AND a.deleted_at IS NULL
    ) AS has_applied,
    EXISTS (
        SELECT 1
          FROM applications a
          JOIN status_histories sh ON sh.application_id = a.id
         WHERE a.person_id = p.id
           AND a.voided_at IS NULL AND a.deleted_at IS NULL
           AND sh.transition_type = 'advance'
           AND sh.is_correction = false
           AND sh.selection_step_id = (
               SELECT ss.id FROM selection_steps ss
                WHERE ss.season_id = a.season_id
                ORDER BY ss.sort_order DESC LIMIT 1
           )
    ) AS is_accepted
  FROM persons p
 WHERE p.deleted_at IS NULL;


-- [2] ファネル日次断面。森は含めない（単位が違うため）。
-- 累積で数える。「到達したことがあるか」で判定するため、
-- 差し戻し（revert）が起きても1人は1人として数える。
CREATE VIEW v_funnel_daily AS
SELECT
    s.id AS season_id,
    d.day::date AS as_of,
    (d.day::date - s.application_open_date) AS relative_day,
    (SELECT count(*) FROM persons p
      WHERE p.created_at::date <= d.day::date AND p.deleted_at IS NULL)
        AS grove_cum,              -- 林（累積）
    (SELECT count(*) FROM applications a
      WHERE a.season_id = s.id AND a.submitted_at::date <= d.day::date
        AND a.voided_at IS NULL AND a.deleted_at IS NULL)
        AS applied_cum,            -- 木（累積）
    (SELECT count(DISTINCT sh.application_id)
       FROM status_histories sh
       JOIN applications a ON a.id = sh.application_id
      WHERE a.season_id = s.id AND sh.occurred_at::date <= d.day::date
        AND sh.transition_type = 'reject' AND sh.is_correction = false)
        AS rejected_cum,           -- 不合格（辞退と分ける）
    (SELECT count(DISTINCT sh.application_id)
       FROM status_histories sh
       JOIN applications a ON a.id = sh.application_id
      WHERE a.season_id = s.id AND sh.occurred_at::date <= d.day::date
        AND sh.transition_type = 'withdraw' AND sh.is_correction = false)
        AS withdrawn_cum
  FROM seasons s
 CROSS JOIN LATERAL generate_series(
     s.application_open_date, s.selection_end_date, interval '1 day'
 ) AS d(day);


-- [2] 年度帰属。期間が重複する場合は enrollment_year が最小の Season に寄せる。
-- 該当 Season が存在しない接点は season_id が NULL となり、(4)で「未割当」として表示する。
CREATE VIEW v_touchpoint_season AS
SELECT
    t.id AS touchpoint_id,
    t.person_id,
    t.channel_id,
    t.partner_id,
    t.occurred_at,
    (SELECT s.id FROM seasons s
      WHERE t.occurred_at::date BETWEEN s.outreach_start_date AND s.selection_end_date
      ORDER BY s.enrollment_year ASC LIMIT 1) AS season_id
  FROM touchpoints t;


-- [2] アトリビューション3方式。1本にまとめて分岐させるとクエリプランが劣化するため分ける。
CREATE VIEW v_attribution_first AS
SELECT DISTINCT ON (ts.person_id, ts.season_id)
       ts.person_id, ts.season_id, ts.channel_id, 1.0::numeric AS weight
  FROM v_touchpoint_season ts
 ORDER BY ts.person_id, ts.season_id, ts.occurred_at ASC;

CREATE VIEW v_attribution_last AS
SELECT DISTINCT ON (ts.person_id, ts.season_id)
       ts.person_id, ts.season_id, ts.channel_id, 1.0::numeric AS weight
  FROM v_touchpoint_season ts
 ORDER BY ts.person_id, ts.season_id, ts.occurred_at DESC;

-- 接点数で按分するため、weight の合計が実人数と一致する。
CREATE VIEW v_attribution_linear AS
SELECT ts.person_id,
       ts.season_id,
       ts.channel_id,
       (count(*)::numeric / sum(count(*)) OVER (PARTITION BY ts.person_id, ts.season_id))
           AS weight
  FROM v_touchpoint_season ts
 GROUP BY ts.person_id, ts.season_id, ts.channel_id;


-- [2] 利益相反の検出。
-- 面接官が卒業生スタッフで、かつ応募者の紹介者である場合を洗い出す。
-- (5)に出す。紹介チャネルの合格率が実力かバイアスかの検証に使う。
CREATE VIEW v_conflict_of_interest AS
SELECT e.id AS evaluation_id,
       e.application_id,
       e.interviewer_staff_id,
       a.person_id AS applicant_person_id
  FROM evaluations e
  JOIN applications a ON a.id = e.application_id
  JOIN persons      p ON p.id = a.person_id
  JOIN staffs       s ON s.id = e.interviewer_staff_id
 WHERE s.person_id IS NOT NULL
   AND p.referrer_person_id = s.person_id;

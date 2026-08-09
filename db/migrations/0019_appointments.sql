-- =============================================================
-- 0019 予定（日程）の記録層
--
-- 発見の経緯: 実行⑨でボーダーライン画面の意匠が届き、週表示の
-- 日程カレンダーがあった。**未来の日時という事実は記録層に1つも無かった。**
--
--   touchpoints  … 「接触があった」という**過去**の出来事。予定は持てない
--   evaluations  … 面接官の割り当て。assigned_at はあるが「いつ会うか」ではない
--   approach_events … 「面談調整中」という状態は持てるが、何日の何時かは無い
--
-- 依頼者の判断（実行⑨）は「予定の記録層を作る」。ここで作る。
--
-- ★ 予定と接点を1つの表にしない
--
-- 接点（touchpoints）は「起きたこと」で、集客の集計と流入元の帰属を担う。
-- 予定は「これから起きること」で、起きるとは限らない。
-- 同じ表に入れると、**まだ会っていない予定が接点として集計に混ざる。**
-- 実行③で踏んだ「同じ言葉が2つの定義を持つ」の再演になる。
--
-- 予定が実際に起きたことを接点として残すかどうかは、運用の判断であり
-- ここでは決めない。TODO(MVP): 予定 → 接点の記録は未実装。
--
-- ★ 訂正の型は 0018 に合わせる（0016 とは違う）
--
-- 0016（アプローチ状態）は出来事の追記だけで、現在値を持たない。
-- 0018（プロフィール）は現在値を持ち、変更後のスナップショットを追記する。
-- **予定は 0018 型にする。** カレンダーは「いま何日の何時か」を常に引くので、
-- 毎回チェーンをたどらせると全画面がその再帰を負う。
-- `CLAUDE.md` の「現在値を更新する場合も、変更履歴を追記保存する」に従う。
-- =============================================================

-- -------------------------------------------------------------
-- 1. 予定の種別
-- -------------------------------------------------------------
-- 原則3「集計定義に関わるマスタは更新せず、追加と非活性化で運用する」。
--
-- requires_person は「この種別は候補者が要るか」を宣言する。
-- 社内の打ち合わせに候補者は要らないが、面談に候補者が無いのは記録漏れである。
-- 理由テキストで分岐せず、マスタの真偽値で判定する（原則7）。
CREATE TABLE appointment_kinds (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code            text        NOT NULL,
    label           text        NOT NULL,
    sort_order      integer     NOT NULL,
    requires_person boolean     NOT NULL DEFAULT true,
    is_active       boolean     NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT appointment_kinds_code_key UNIQUE (code),
    CONSTRAINT appointment_kinds_sort_key UNIQUE (sort_order)
);

COMMENT ON TABLE appointment_kinds IS
    '予定の種別。追加と非活性化で運用する（原則3）。';
COMMENT ON COLUMN appointment_kinds.requires_person IS
    'この種別は相手（候補者）が要るか。社内の打ち合わせだけ false。';


-- -------------------------------------------------------------
-- 2. 予定（現在値）
-- -------------------------------------------------------------
CREATE TABLE appointments (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id       uuid        NOT NULL REFERENCES seasons(id),
    person_id       uuid        REFERENCES persons(id),
    kind_id         uuid        NOT NULL REFERENCES appointment_kinds(id),
    title           text        NOT NULL,
    starts_at       timestamptz NOT NULL,
    ends_at         timestamptz NOT NULL,
    owner_staff_id  uuid        NOT NULL REFERENCES staffs(id),
    note            text,
    -- 取り消した予定は消さない。**消すと「その日に何も無かった」ことになり、
    -- 空いていたのか流れたのかが後から区別できない。**
    cancelled_at    timestamptz,
    cancel_reason   text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT appointments_title_not_blank CHECK (btrim(title) <> ''),
    -- 終わりが始まりより前の予定は、週表示で幅が負になる。
    CONSTRAINT appointments_range CHECK (ends_at > starts_at),
    -- 取り消しの理由はフラグと対で縛る。片側だけだとフラグのほうが嘘になる。
    CONSTRAINT appointments_cancel_pair
        CHECK (cancel_reason IS NULL OR cancelled_at IS NOT NULL)
);

COMMENT ON TABLE appointments IS
    '予定（日程）。現在値を持ち、変更履歴は appointment_revisions が追記で残す。';
COMMENT ON COLUMN appointments.cancelled_at IS
    '取り消した予定も行としては残す。消すと「空いていた」と「流れた」が区別できない。';

CREATE INDEX appointments_span_idx ON appointments (season_id, starts_at);
CREATE INDEX appointments_person_idx ON appointments (person_id, starts_at)
    WHERE person_id IS NOT NULL;
CREATE INDEX appointments_owner_idx ON appointments (owner_staff_id, starts_at);


-- 種別が候補者を要るかどうかは、別テーブルの値なので CHECK では書けない。
CREATE FUNCTION appointments_check_person_required()
RETURNS trigger AS $$
DECLARE
    v_requires boolean;
    v_label    text;
BEGIN
    SELECT k.requires_person, k.label INTO v_requires, v_label
      FROM appointment_kinds k WHERE k.id = NEW.kind_id;

    IF v_requires AND NEW.person_id IS NULL THEN
        RAISE EXCEPTION '% には相手（候補者）が要る', v_label
            USING HINT = '相手の要らない予定は requires_person = false の種別を使う。';
    END IF;

    -- 個人情報削除を受けた人の予定は作れない。運用の画面に氏名の窓を残さない。
    IF NEW.person_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM persons p
         WHERE p.id = NEW.person_id AND p.deleted_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION '削除済みの候補者に予定は作れない';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER appointments_person_required
    BEFORE INSERT OR UPDATE ON appointments
    FOR EACH ROW EXECUTE FUNCTION appointments_check_person_required();


-- -------------------------------------------------------------
-- 3. 変更履歴（追記専用）
-- -------------------------------------------------------------
-- 0018 と同じ型。**変更後の全体像**を1行ずつ積む。
-- 差分だけを残すと、ある時点の予定を復元するのに全行をたどることになる。
CREATE TABLE appointment_revisions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id  uuid        NOT NULL REFERENCES appointments(id),
    revision_number integer     NOT NULL,
    season_id       uuid        NOT NULL REFERENCES seasons(id),
    person_id       uuid        REFERENCES persons(id),
    kind_id         uuid        NOT NULL REFERENCES appointment_kinds(id),
    title           text        NOT NULL,
    starts_at       timestamptz NOT NULL,
    ends_at         timestamptz NOT NULL,
    owner_staff_id  uuid        NOT NULL REFERENCES staffs(id),
    note            text,
    cancelled_at    timestamptz,
    cancel_reason   text,
    changed_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT appointment_revisions_number_positive CHECK (revision_number > 0),
    CONSTRAINT appointment_revisions_key UNIQUE (appointment_id, revision_number)
);

CREATE INDEX appointment_revisions_idx
    ON appointment_revisions (appointment_id, revision_number DESC);

CREATE TRIGGER appointment_revisions_append_only
    BEFORE UPDATE OR DELETE ON appointment_revisions
    FOR EACH ROW EXECUTE FUNCTION reject_mutation();

COMMENT ON TABLE appointment_revisions IS
    '予定の変更後スナップショット。追記専用。appointments は現在値を持つ。';


-- -------------------------------------------------------------
-- 4. カレンダーに出す予定
-- -------------------------------------------------------------
-- 「カレンダーに出る」の定義はここ1箇所。画面が絞り直さない。
--
-- 取り消した予定は**出さないが、消してもいない。** 履歴からは引ける。
CREATE VIEW v_appointments AS
SELECT a.id AS appointment_id,
       a.season_id,
       a.person_id,
       a.kind_id,
       k.code  AS kind_code,
       k.label AS kind_label,
       a.title,
       a.starts_at,
       a.ends_at,
       jst_date(a.starts_at) AS starts_on,
       a.owner_staff_id,
       s.display_name AS owner_name,
       a.note
  FROM appointments a
  JOIN appointment_kinds k ON k.id = a.kind_id
  JOIN staffs s ON s.id = a.owner_staff_id
  LEFT JOIN persons p ON p.id = a.person_id
 WHERE a.cancelled_at IS NULL
   AND (a.person_id IS NULL OR (p.deleted_at IS NULL AND p.anonymized_at IS NULL));

COMMENT ON VIEW v_appointments IS
    'カレンダーに出す予定。取り消し済みと個人情報削除済みを外す。定義はここ1箇所。';


-- -------------------------------------------------------------
-- 5. マスタの初期値
-- -------------------------------------------------------------
-- ★ これは推測ではない。**画像のカレンダーに描かれていた予定の名前**を
--   依頼者の指定としてそのまま置く（初回連絡・書類確認・面談調整・
--   カジュアル面談・面談・社内MTG）。
--
-- 社内MTG だけ相手が要らない。
INSERT INTO appointment_kinds (code, label, sort_order, requires_person) VALUES
    ('first_contact',  '初回連絡',       10, true),
    ('document_check', '書類確認',       20, true),
    ('scheduling',     '面談調整',       30, true),
    ('casual',         'カジュアル面談', 40, true),
    ('interview',      '面談',           50, true),
    ('internal',       '社内MTG',        90, false);

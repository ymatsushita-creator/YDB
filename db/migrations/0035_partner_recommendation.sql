-- =============================================================
-- 0035 団体の推薦枠ステイタス（期ごと）
--
-- 依頼者の指示（実行⑬）――「エクセルにある内容でDBにないものはないか」、
-- そして保留していた3つの置き場所を「君が判断して良い」。
--
-- 応募管理表 `011_提携団体` の「2期生推薦枠ステイタス」（41件・4値）。
-- **これだけが既存の記録層に置き場所を持たなかった。** 残る2つは足していない ――
--
--   AWARDへの応募有無      **イベントへの参加は接点（touchpoints）である。**
--                          0028 で同じ問いに答えを出してある ――
--                          「参加という事実を人に貼る場所はすでにある。
--                            新しい属性の列を作ると、同じ事実が2箇所に載る」。
--   関連するアカデミア生    `touchpoints` は `person_id` と `partner_id` の両方を
--                          持つので、**その団体経由で接点のある人**として既に導出できる
--                          （`/approach` の「識別（人）」がそれを数えている）。
--                          氏名の文字列で人を指す列を作らない。
--
-- ★ なぜ団体の列にしないか ―― 「**2期生**推薦枠ステイタス」であって、
--   期ごとに変わる。`partners.recommendation_status` のような現在値を1つ持つと、
--   3期の状態を入れた瞬間に2期の状態が消える。**期をまたげない形にしない。**
--
-- ★ 形は 0016（アプローチ状態）と同じにする ―― マスタ＋追記専用の出来事＋
--   最新から導く現在値。**訂正は打ち消し行**（CLAUDE.md）。
--   同じ性質のものに別の形を与えない（次に触る人が2つの規則を覚えることになる）。
--
-- ★ 値は運営の語をそのまま（未連絡／メール送信済み／アポ実施済み／対象外）。
--   こちらで言い換えない。マスタは追加と非活性化で運用する（原則3）。
-- =============================================================

CREATE TABLE partner_recommendation_states (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code        text        NOT NULL,
    label       text        NOT NULL,
    sort_order  integer     NOT NULL,
    -- これ以上こちらから動かさない状態（対象外）。数える母集団から外すのに使う。
    is_terminal boolean     NOT NULL DEFAULT false,
    is_active   boolean     NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT partner_recommendation_states_code_key UNIQUE (code),
    CONSTRAINT partner_recommendation_states_sort_key UNIQUE (sort_order)
);

COMMENT ON TABLE partner_recommendation_states IS
    '推薦枠ステイタスのマスタ。追加と非活性化で運用する（原則3）。';

INSERT INTO partner_recommendation_states (code, label, sort_order, is_terminal) VALUES
    ('not_contacted', '未連絡',         1, false),
    ('mailed',        'メール送信済み', 2, false),
    ('met',           'アポ実施済み',   3, false),
    ('out_of_scope',  '対象外',         4, true);


CREATE TABLE partner_recommendation_events (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id           uuid        NOT NULL REFERENCES partners(id),
    season_id            uuid        NOT NULL REFERENCES seasons(id),
    state_id             uuid        NOT NULL REFERENCES partner_recommendation_states(id),
    occurred_at          timestamptz NOT NULL,
    recorded_by_staff_id uuid        NOT NULL REFERENCES staffs(id),
    is_correction        boolean     NOT NULL DEFAULT false,
    corrects_event_id    uuid        REFERENCES partner_recommendation_events(id),
    note                 text,
    created_at           timestamptz NOT NULL DEFAULT now(),
    -- 自分で自分を打ち消す行は再帰の始点を持たず、行がまるごと集計から消える。
    CONSTRAINT partner_recommendation_events_no_self_correction
        CHECK (corrects_event_id IS NULL OR corrects_event_id <> id),
    -- フラグと参照を両方向で縛る。片側だけだとフラグのほうが嘘になる。
    CONSTRAINT partner_recommendation_events_correction_pair
        CHECK (is_correction = false OR corrects_event_id IS NOT NULL),
    CONSTRAINT partner_recommendation_events_correction_pair_reverse
        CHECK (corrects_event_id IS NULL OR is_correction = true)
);

COMMENT ON TABLE partner_recommendation_events IS
    '推薦枠の出来事。追記専用。現在の状態は v_partner_recommendation_state が導く。';

CREATE INDEX partner_recommendation_events_partner_idx
    ON partner_recommendation_events (partner_id, season_id, occurred_at);
CREATE INDEX partner_recommendation_events_season_idx
    ON partner_recommendation_events (season_id, occurred_at);

-- 1つの行を打ち消す訂正行は最大1つ。分岐すると有効性が一意に定まらない。
CREATE UNIQUE INDEX partner_recommendation_events_corrects_key
    ON partner_recommendation_events (corrects_event_id)
    WHERE corrects_event_id IS NOT NULL;

-- 追記専用。UPDATE を禁じると訂正チェーンの循環が構造的に作れなくなる。
CREATE TRIGGER partner_recommendation_events_append_only
    BEFORE UPDATE OR DELETE ON partner_recommendation_events
    FOR EACH ROW EXECUTE FUNCTION reject_mutation();


-- 訂正チェーンの解決。深さ偶数が有効（0016 と同じ判定）。
CREATE VIEW v_effective_partner_recommendation_events AS
WITH RECURSIVE chain AS (
    SELECT e.id, e.corrects_event_id, 0 AS depth
      FROM partner_recommendation_events e
     WHERE NOT EXISTS (
               SELECT 1 FROM partner_recommendation_events c
                WHERE c.corrects_event_id = e.id
           )
    UNION ALL
    SELECT t.id, t.corrects_event_id, ch.depth + 1
      FROM chain ch
      JOIN partner_recommendation_events t ON t.id = ch.corrects_event_id
)
SELECT pe.*
  FROM partner_recommendation_events pe
  JOIN chain ON chain.id = pe.id
 WHERE chain.depth % 2 = 0;

COMMENT ON VIEW v_effective_partner_recommendation_events IS
    '訂正チェーンを解決した後に有効な推薦枠の出来事。深さ偶数が有効。';


-- 団体 × 期の現在の推薦枠ステイタス。
-- 同じ瞬間に2件入った場合は created_at、それも同じなら id で決める
-- ―― 順序が決まらないと、同じ問いに画面ごとに違う答えが出る。
CREATE VIEW v_partner_recommendation_state AS
SELECT DISTINCT ON (e.partner_id, e.season_id)
       e.partner_id,
       e.season_id,
       e.state_id,
       s.code                  AS state_code,
       s.label                 AS state_label,
       s.is_terminal,
       e.occurred_at           AS state_since,
       e.recorded_by_staff_id  AS last_recorded_by_staff_id,
       e.note                  AS last_note
  FROM v_effective_partner_recommendation_events e
  JOIN partner_recommendation_states s ON s.id = e.state_id
 ORDER BY e.partner_id, e.season_id, e.occurred_at DESC, e.created_at DESC, e.id DESC;

COMMENT ON VIEW v_partner_recommendation_state IS
    '団体 × 期の現在の推薦枠ステイタス。最新の有効な出来事から導出する。';

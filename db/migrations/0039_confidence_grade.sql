-- =============================================================
-- 0039 確度（S/A/B/C）を、記入するものにする
--
-- 依頼者の指示（実行⑯）――「確度の基準はこちらをもとに設計し、
-- 入力者が記入、加えていつでも編集できるように」。
--
-- ★★ **確度は導出値ではなくなる。** ★★
--
--   これまで確度は `scoring_rules` から計算する値だった（`score_snapshots`）。
--   規則が1件も無いので、画面には「確度の算出規則が未登録」としか出ていなかった。
--   依頼者は**人が判断して記入する**ものとして基準を出した。計算をやめる。
--
--   ★ 0017 の確度（`score_snapshots.confidence_ratio`）は**残す。**
--     適用済みマイグレーションは編集しない（CLAUDE.md）。規則が入れば
--     いまでも動く。ただし**画面が見るのはこちら**になる。
--
-- ★ 期ごとに持つ。「2期はB、3期はS」が同時に成り立つ ――
--   人に1つの現在値を持たせると、期を跨いだ瞬間に前の期の判断が消える
--   （0035 で同じ判断をした）。
--
-- ★ 形は 0016／0035 と同じ ―― マスタ＋追記専用の出来事＋最新から導く現在値。
--   「いつでも編集できる」は**上書きではなく追記**で満たす。
--   書き換えると、いつ誰がどう見立てを変えたのかが残らない。
--
-- ★ 記入者は**手入力の自己申告**である（0027 と同じ。C-146 で共有の合言葉に
--   戻ったので、システムは誰が入ったかを知らない）。名簿と照合しない。
-- =============================================================

CREATE TABLE confidence_grades (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code        text        NOT NULL,
    -- 基準の文。**依頼者の文面をそのまま入れる。** こちらで言い換えない。
    definition  text        NOT NULL,
    sort_order  integer     NOT NULL,
    is_active   boolean     NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT confidence_grades_code_key UNIQUE (code),
    CONSTRAINT confidence_grades_sort_key UNIQUE (sort_order),
    CONSTRAINT confidence_grades_definition_not_blank CHECK (btrim(definition) <> '')
);

COMMENT ON TABLE confidence_grades IS
    '確度の段階（S/A/B/C）。定義は依頼者の文面のまま。追加と非活性化で運用する。';
COMMENT ON COLUMN confidence_grades.definition IS
    '依頼者が示した基準の原文。記入者がこれを見て選ぶ。翻訳・要約しない。';

INSERT INTO confidence_grades (code, definition, sort_order) VALUES
    ('S', 'イベント参加or2期説明会参加/3期応募口頭内諾', 1),
    ('A', '2026年イベント参加', 2),
    ('B', '2025年度イベント参加 / 応募したが落ちたor辞退/懸念事項がある/前回はやりたいことがあり断念', 3),
    ('C', 'まだNEOイベント未参加/NEOに入ると良いと思う人', 4);


CREATE TABLE person_confidence_events (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id         uuid        NOT NULL REFERENCES persons(id),
    season_id         uuid        NOT NULL REFERENCES seasons(id),
    grade_id          uuid        NOT NULL REFERENCES confidence_grades(id),
    occurred_at       timestamptz NOT NULL,
    -- 記入した人。**手入力の自己申告**であって、認証された身元ではない。
    recorded_by       text        NOT NULL,
    is_correction     boolean     NOT NULL DEFAULT false,
    corrects_event_id uuid        REFERENCES person_confidence_events(id),
    note              text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT person_confidence_events_recorded_by_not_blank
        CHECK (btrim(recorded_by) <> ''),
    -- 自分で自分を打ち消す行は再帰の始点を持たず、行がまるごと集計から消える。
    CONSTRAINT person_confidence_events_no_self_correction
        CHECK (corrects_event_id IS NULL OR corrects_event_id <> id),
    -- フラグと参照を両方向で縛る。片側だけだとフラグのほうが嘘になる。
    CONSTRAINT person_confidence_events_correction_pair
        CHECK (is_correction = false OR corrects_event_id IS NOT NULL),
    CONSTRAINT person_confidence_events_correction_pair_reverse
        CHECK (corrects_event_id IS NULL OR is_correction = true)
);

COMMENT ON TABLE person_confidence_events IS
    '確度の記入。追記専用。現在の確度は v_person_confidence が導く。';

CREATE INDEX person_confidence_events_person_idx
    ON person_confidence_events (person_id, season_id, occurred_at DESC);
CREATE INDEX person_confidence_events_season_idx
    ON person_confidence_events (season_id, occurred_at DESC);

-- 1つの行を打ち消す訂正行は最大1つ。分岐すると有効性が一意に定まらない。
CREATE UNIQUE INDEX person_confidence_events_corrects_key
    ON person_confidence_events (corrects_event_id)
    WHERE corrects_event_id IS NOT NULL;

CREATE TRIGGER person_confidence_events_append_only
    BEFORE UPDATE OR DELETE ON person_confidence_events
    FOR EACH ROW EXECUTE FUNCTION reject_mutation();


-- 訂正チェーンの解決。深さ偶数が有効（0016 / 0035 と同じ判定）。
CREATE VIEW v_effective_person_confidence_events AS
WITH RECURSIVE chain AS (
    SELECT e.id, e.corrects_event_id, 0 AS depth
      FROM person_confidence_events e
     WHERE NOT EXISTS (
               SELECT 1 FROM person_confidence_events c WHERE c.corrects_event_id = e.id
           )
    UNION ALL
    SELECT t.id, t.corrects_event_id, ch.depth + 1
      FROM chain ch
      JOIN person_confidence_events t ON t.id = ch.corrects_event_id
)
SELECT pe.*
  FROM person_confidence_events pe
  JOIN chain ON chain.id = pe.id
 WHERE chain.depth % 2 = 0;

COMMENT ON VIEW v_effective_person_confidence_events IS
    '訂正チェーンを解決した後に有効な確度の記入。深さ偶数が有効。';


-- 人 × 期の現在の確度。
-- 同じ瞬間に2件入った場合は created_at、それも同じなら id で決める
-- ―― 順序が決まらないと、同じ問いに画面ごとに違う答えが出る。
CREATE VIEW v_person_confidence AS
SELECT DISTINCT ON (e.person_id, e.season_id)
       e.person_id,
       e.season_id,
       e.grade_id,
       g.code        AS grade_code,
       g.definition  AS grade_definition,
       g.sort_order  AS grade_order,
       e.occurred_at AS graded_at,
       e.recorded_by AS graded_by,
       e.note        AS grade_note
  FROM v_effective_person_confidence_events e
  JOIN confidence_grades g ON g.id = e.grade_id
 ORDER BY e.person_id, e.season_id, e.occurred_at DESC, e.created_at DESC, e.id DESC;

COMMENT ON VIEW v_person_confidence IS
    '人 × 期の現在の確度（S/A/B/C）。最新の有効な記入から導出する。';

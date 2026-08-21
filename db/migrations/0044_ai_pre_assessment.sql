-- =============================================================
-- 0044 AI分析（事前ステータス）を、成績の外に置く
--
-- 依頼者の指示（実行⑯）――「ClaudAPIで叩くのは、エクセル、CSVを入れたら
-- 勝手にDBに反映してくれるシステムと、AI分析と称した事前ステータスだけで良い。
-- **通常の成績としては扱わない**」。
--
-- ★★ **`evaluation_scores` へは絶対に入れない。** ★★
--
--   軸（`evaluation_criteria`）に紐づけると、点数として集計に混ざる。
--   混ざった瞬間、人が付けた点とAIが出した文字が同じ重さで平均される。
--   だから**別の表**に置き、軸への外部キーを**持たせない**。
--   0039（確度）と同じ判断である ―― 人の見立ても、AIの見立ても、
--   成績（`evaluation_scores`）とは別の層にある。
--
-- ★ 追記専用。訂正は打ち消し行（0035／0039 と同じ作法）。
--   再分析しても前の分析は消えない。「AIが前は何と言ったか」が残る。
--
-- ★ 段（`selection_steps`）に紐づける。書類選考の前さばきに使うが、
--   段が増えたときに表を作り直さなくて済む。
--
-- ★ `label` は**自由語ではなく、この表が持つ語**に限る（`ai_pre_labels`）。
--   語を自由にすると、同じ意味の別表記が並んで一覧が数えられなくなる。
--   ただし**成績の段階ではない** ―― 点も順位も持たせない。
-- =============================================================

CREATE TABLE ai_pre_labels (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code        text        NOT NULL,
    -- 何を指す語かの説明。AIへ渡す指示文でもある。
    definition  text        NOT NULL,
    sort_order  integer     NOT NULL,
    is_active   boolean     NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ai_pre_labels_code_key UNIQUE (code),
    CONSTRAINT ai_pre_labels_sort_key UNIQUE (sort_order),
    CONSTRAINT ai_pre_labels_definition_not_blank CHECK (btrim(definition) <> '')
);

COMMENT ON TABLE ai_pre_labels IS
    'AI分析の事前ステータスの語。成績の段階ではない（C-164）。';

CREATE TABLE ai_pre_assessments (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id         uuid NOT NULL REFERENCES persons(id),
    season_id         uuid NOT NULL REFERENCES seasons(id),
    selection_step_id uuid NOT NULL REFERENCES selection_steps(id),
    label_id          uuid NOT NULL REFERENCES ai_pre_labels(id),
    -- AIが書いた理由。**画面に出すのは人が読むためであって、点にはしない。**
    rationale         text        NOT NULL,
    -- どのモデルが、いつ出したか。後から「何で出した結果か」を辿れるようにする。
    model             text        NOT NULL,
    -- 何を読んで出したか（例：'application_answers'）。入力を残さないと再現できない。
    source            text        NOT NULL,
    occurred_at       timestamptz NOT NULL DEFAULT now(),
    is_correction     boolean     NOT NULL DEFAULT false,
    corrects_assessment_id uuid REFERENCES ai_pre_assessments(id),
    created_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ai_pre_assessments_rationale_not_blank CHECK (btrim(rationale) <> ''),
    CONSTRAINT ai_pre_assessments_model_not_blank CHECK (btrim(model) <> ''),
    CONSTRAINT ai_pre_assessments_correction_pairs CHECK (
        (is_correction AND corrects_assessment_id IS NOT NULL)
     OR (NOT is_correction AND corrects_assessment_id IS NULL))
);

COMMENT ON TABLE ai_pre_assessments IS
    'AI分析の事前ステータス。追記専用。evaluation_scores とは無関係（C-164）。';

CREATE INDEX ai_pre_assessments_person_idx
    ON ai_pre_assessments (person_id, season_id, selection_step_id);

-- 追記専用（0004 と同じ引き金）。
CREATE TRIGGER ai_pre_assessments_append_only
    BEFORE UPDATE OR DELETE ON ai_pre_assessments
    FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- 打ち消された行を除いた、有効な分析。
-- ★ 訂正行は**新しい語を載せて元に取って代わる**（0039 と同じ形）。
--   だから「後から自分を訂正した行が無いもの」だけが有効である。
CREATE VIEW v_effective_ai_pre_assessments AS
SELECT a.*
  FROM ai_pre_assessments a
 WHERE NOT EXISTS (
       SELECT 1 FROM ai_pre_assessments later
        WHERE later.corrects_assessment_id = a.id);

-- いまの事前ステータス（人・期・段ごとに1つ）。
CREATE VIEW v_ai_pre_assessment AS
SELECT DISTINCT ON (a.person_id, a.season_id, a.selection_step_id)
       a.person_id, a.season_id, a.selection_step_id,
       l.code AS label, l.definition, a.rationale, a.model, a.source,
       a.occurred_at
  FROM v_effective_ai_pre_assessments a
  JOIN ai_pre_labels l ON l.id = a.label_id
 ORDER BY a.person_id, a.season_id, a.selection_step_id,
          a.occurred_at DESC, a.created_at DESC, a.id DESC;

-- ―― 札 ――
--
-- ★ **これは成績の段階ではない。** 先に読む順番を作るための札である。
--   点も順位も持たない（この表に軸への外部キーが無い）。
--
-- ★ 語は**仮置き**である。依頼者から呼び名が来たら訂正する。
--   ★ 呼び名を待って**機能を止めない** ―― 依頼者の指示（実行⑯）：
--     「呼び名が来るまでじゃねぇよ」。
--
-- ★ AIが読む観点は依頼者の言葉をそのまま使う（`src/ai/pre_assessment.ts`）――
--   「NEOとの相性／質問に論理的に答えられているか／やり遂げた実績はあるか／
--     コミットする意志があるか」。
--   **観点は評価軸（`evaluation_criteria`）へは入れない。**
--   依頼者が「いいわけねぇだろ」と退けたのは、この言い回しを
--   評価軸の正式な呼び名として登録することだった。
INSERT INTO ai_pre_labels (code, definition, sort_order) VALUES
    ('注目', '4つの観点のうち、はっきりと強みが読み取れる回答がある。先に人が読む。', 1),
    ('標準', '引っかかりも際立ちも無い。通常の順で人が読む。', 2),
    ('要確認', '回答が短い・観点に答えていない・矛盾があるなど、人の確認が要る。', 3);

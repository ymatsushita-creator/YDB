-- =============================================================
-- 0045 AI分析を、観点ごとの点数で出す
--
-- 依頼者の指示（実行⑯）――「論理性の観点とかはやってもいいよ」
--                        「AI採点は点数で出せや」。
--
-- ★★ **点は出す。ただし置き場所は成績の層ではない。** ★★
--   `evaluation_scores` は人が付ける成績で、そこには入れない ――
--   依頼者は同じ実行の中で「通常の成績としては扱わない」と決めている。
--   点が出ることと、その点が公式の成績になることは別である。
--   だから点は `ai_pre_viewpoints.score` に持ち、評価軸（`evaluation_criteria`）
--   への外部キーは**持たせない**。集計に混ざる道を作らない。
--
-- ★ 満点は**書類選考の16点に合わせる**（4観点 × 4点）。
--   応募管理表で確かめた実際の配点である。**尺度を創作しない。**
--
-- ★ 合計はここに持たない。**導出値を直接持つと、内訳と合計がずれる**
--   （CLAUDE.md：導出値を直接UPDATEしない）。ビューで足す。
--
-- ★ 観点の呼び名は `evaluation_criteria` へは入れない。
--   依頼者が退けたのは、この言い回しを評価軸の正式な呼び名として
--   登録することだった。ここで持つのは**AIが何を見て点を付けたか**である。
--
-- ★ 親（`ai_pre_assessments`）にぶら下げる。親が打ち消されれば子も効かない。
--   子に独自の訂正の鎖を持たせると「取り消した分析の、生きている観点」ができる。
--
-- ★ 追記専用。親と同じ作法。
-- =============================================================

CREATE TABLE ai_pre_viewpoints (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id uuid NOT NULL REFERENCES ai_pre_assessments(id),
    -- 観点の呼び名。**依頼者の言葉をそのまま置く**（言い換えない）。
    viewpoint     text        NOT NULL,
    -- 点。0〜満点の整数。**評価軸には紐づかない。**
    score         integer     NOT NULL,
    scale_max     integer     NOT NULL DEFAULT 4,
    -- なぜその点か。人が読む。
    finding       text        NOT NULL,
    sort_order    integer     NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ai_pre_viewpoints_viewpoint_not_blank CHECK (btrim(viewpoint) <> ''),
    CONSTRAINT ai_pre_viewpoints_finding_not_blank CHECK (btrim(finding) <> ''),
    CONSTRAINT ai_pre_viewpoints_scale CHECK (scale_max > 0),
    -- 満点を超える点も、負の点も入れない。
    CONSTRAINT ai_pre_viewpoints_score_range CHECK (score >= 0 AND score <= scale_max),
    -- 同じ分析の中で、同じ観点が2度出ない。
    CONSTRAINT ai_pre_viewpoints_once UNIQUE (assessment_id, viewpoint),
    CONSTRAINT ai_pre_viewpoints_order UNIQUE (assessment_id, sort_order)
);

COMMENT ON TABLE ai_pre_viewpoints IS
    'AI分析の観点ごとの点と所見。評価軸ではなく、成績（evaluation_scores）でもない（C-165）。';

CREATE INDEX ai_pre_viewpoints_assessment_idx
    ON ai_pre_viewpoints (assessment_id);

CREATE TRIGGER ai_pre_viewpoints_append_only
    BEFORE UPDATE OR DELETE ON ai_pre_viewpoints
    FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- いま有効な分析の、観点ごとの内訳。
-- ★ 有効判定は**親だけ**を見る（この表に訂正の鎖は無い）。
CREATE VIEW v_ai_pre_viewpoints AS
SELECT a.person_id, a.season_id, a.selection_step_id,
       v.viewpoint, v.score, v.scale_max, v.finding, v.sort_order,
       a.occurred_at
  FROM ai_pre_viewpoints v
  JOIN v_effective_ai_pre_assessments a ON a.id = v.assessment_id;

-- 合計点。**足すのはここだけ**（内訳と別に持たない）。
CREATE VIEW v_ai_pre_total AS
SELECT a.person_id, a.season_id, a.selection_step_id,
       sum(v.score)::integer      AS score,
       sum(v.scale_max)::integer  AS scale_max,
       count(*)::integer          AS viewpoints,
       a.occurred_at
  FROM ai_pre_viewpoints v
  JOIN v_effective_ai_pre_assessments a ON a.id = v.assessment_id
 GROUP BY a.person_id, a.season_id, a.selection_step_id, a.occurred_at;

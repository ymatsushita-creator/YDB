-- =============================================================
-- 0010 書類選考の4軸を登録する
--
-- 依頼者の指示（実行⑰）――「書類選考の４軸を決定する。
--   １はAIが判定した論理力、その順でまずソートする。
--   そのうえで、NEOとの親和性、やり遂げた実績、コミットする意志の３軸は、
--   上から採点者が読んで、採点結果、メモ、採点者、日時を記録する」
--   「４段階の点数で良い。論理力は４点として自動で入れろ」。
--
-- ★ 16点 ＝ 4軸 × 4点。応募管理表で確かめた配点と一致する。**創作していない。**
--
-- ★ 1本目（論理力）はAIが判定し、**点が自動で入る。**
--   これは依頼者の判断である ―― 実行⑯では「AI分析を通常の成績として
--   扱わない」と決めていたが、実行⑰で「論理力は4点として自動で入れろ」と
--   指示された。**新しい指示が上位である。**
--   ★ ただしAIの生の判定（所見つき）は `ai_pre_viewpoints` に残り続ける。
--     成績に入った点と、AIが何を見てそう付けたかを、後から突き合わせられる。
--
-- ★ 2〜4本目は人が付ける。点・メモ・採点者・日時は
--   `evaluation_scores` が元から持っている（0001）。表を増やさない。
--
-- ★ 両方の期（2期・3期）へ入れる。0006 が「2期の形を3期へ渡す」と決めている。
-- ★ 冪等。すでに軸がある書類選考には何もしない。
-- =============================================================

INSERT INTO evaluation_criteria
    (selection_step_id, name, scale_max, sort_order, kind, applies_to, description)
SELECT step.id, v.name, 4, v.sort_order, 'standard', 'all', v.description
  FROM selection_steps step
  JOIN seasons s ON s.id = step.season_id AND NOT s.is_demo
  CROSS JOIN (VALUES
    (1, '論理力',
     'AIが判定する。設問の答えになっているか、主張に根拠が付いているか、'
     || '話が飛んでいないか。文章のうまさ・熱意・実績のすごさは見ない。'
     || 'この点の順に並べ、基準を満たしたものから人が読む。'),
    (2, 'NEOとの親和性', '採点者が読んで付ける。'),
    (3, 'やり遂げた実績', '採点者が読んで付ける。'),
    (4, 'コミットする意志', '採点者が読んで付ける。')
  ) AS v(sort_order, name, description)
 WHERE step.name = '書類選考'
   AND NOT EXISTS (
         SELECT 1 FROM evaluation_criteria ec
          WHERE ec.selection_step_id = step.id)
ON CONFLICT (selection_step_id, sort_order) DO NOTHING;

-- =============================================================
-- 0008 グループ面接（二次選考）の軸を、最終面接と同じにする
--
-- 依頼者の指示（実行⑯）――「二次選考の軸はこれだ」（最終面接の6軸を示して）
-- 「じゃあ、最終と同じでいいから」。
--
-- ★★ **これまで一度も作られていなかった。** ★★
--
--   0002 は理由を書いて空のまま置いていた ――
--   「グループ面接の軸も入れていない。旧データに点が無い
--     （sec2_group は A〜E の組分けで、評価ではない）」。
--   軸の呼び名を受け取っていなかったので作らなかった。**受け取ったので入れる。**
--
-- ★ 名前は**最終面接の軸から読む**（このシートに書き写さない）。
--   同じ語を2箇所に置くと、片方を直したときもう片方が古くなる（0006 と同じ作法）。
--
-- ★ **最終面接の軸は動かさない。** 32件の評価・192点が既にぶら下がっている。
--   付いた点の所属を後から動かすのは、記録としてやってはいけない。
--   同じ6軸を、グループ面接にも**別の行として**持たせる
--   （`evaluation_criteria` は段に属する。段が違えば別の軸である）。
--
--   ★ 旧システムの列名は `sec2_*`（二次）で、依頼者も「二次選考の軸」と言う。
--     **0002 の「最終面接の軸である」という判断は誤っていた可能性がある。**
--     ただし移し替えは過去の記録を動かすので、ここではやらない。
--     直すなら訂正として履歴を残す形で、別途行う。
--
-- ★ 冪等。すでに軸があるグループ面接には何もしない。
-- ★ 両方の期（2期・3期）へ入れる。0006 が「2期の形を3期へ渡す」と決めている。
-- =============================================================

INSERT INTO evaluation_criteria
    (selection_step_id, name, scale_max, sort_order, kind, applies_to, description)
SELECT grp.id, fin.name, fin.scale_max, fin.sort_order, fin.kind, fin.applies_to,
       fin.description
  FROM selection_steps grp
  JOIN seasons s ON s.id = grp.season_id AND NOT s.is_demo
  JOIN selection_steps fin_step
    ON fin_step.season_id = grp.season_id AND fin_step.name = '最終面接'
  JOIN evaluation_criteria fin ON fin.selection_step_id = fin_step.id
 WHERE grp.name = 'グループ面接'
   -- すでに1本でも軸があるグループ面接には触れない（冪等）。
   AND NOT EXISTS (
         SELECT 1 FROM evaluation_criteria ec
          WHERE ec.selection_step_id = grp.id
       )
ON CONFLICT (selection_step_id, sort_order) DO NOTHING;

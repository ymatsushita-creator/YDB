-- =============================================================
-- 0006 3期を2期にそろえる（依頼者の判断。2026-08-13）
--
-- 依頼者の言葉（実行⑬）――
--   「まず2期で完成させて、それを3期に適用していく流れ」。
-- 2期は 0005 で完成した。**その形をこの1枚で3期へ渡す。**
--
-- ★★ そろえる前に3つ確かめた（実行⑭）。**黙って揃えていない。**
--
--   ① 3期の「書類審査」は2期の「書類選考」と同じ関門か
--        → **同じ。「書類選考」に揃える**（依頼者。2026-08-13）
--        C-55 で受け取ったままにしていた語を、確認のうえ動かす。
--        受領した語を勝手に翻訳しないのが規律で、**確認したら直す**のも規律である。
--   ② 3期に「応募受付」の段を足すか（受領したフローは3本だった）
--        → **足す。2期と同じ5段にする**（依頼者。2026-08-13）
--   ③ 2期の軸をどこまで写すか
--        → **特別選考の重み付けも、最終面接の6軸も写す**（依頼者。2026-08-13）
--        C-55 は「3期の軸は未受領だから写さない」としていた。その保留を
--        依頼者が解いた。**保留を解けるのは依頼者だけである。**
--
-- ★ 軸と段の中身は**2期から読む**（このシードに名前を書き写さない）。
--   同じ語を2枚のシードに書けば、片方を直したときにもう片方が古くなる。
--   写す元は 0002（最終面接6軸）と 0005（特別選考9軸）が持っている。
--
-- ★ 3期の特別選考9軸は、実行⑫の取り込み（C-105）が**本番へ直接**入れており、
--   シードには無かった。**本番にあってシードに無い形**を、ここで追いつかせる。
--   すでにある本番では作らず、重み付けだけを合わせる（冪等）。
--
-- ★ 冪等。何度流しても増えない・動かない。
-- ★ 3期に応募が1件でもあれば並べ替えない（C-105 と同じ条件）。
--   段の位置は選考の順序そのもので、応募が乗ってから動かすものではない。
-- =============================================================

DO $$
DECLARE
    v_s2      uuid;
    v_s3      uuid;
    v_unknown text;
BEGIN
    SELECT id INTO v_s2 FROM seasons WHERE enrollment_year = 2026;
    SELECT id INTO v_s3 FROM seasons WHERE enrollment_year = 2027;
    IF v_s2 IS NULL OR v_s3 IS NULL THEN
        RETURN;   -- 本番以外（実年度が入らない環境）。何もしない。
    END IF;

    -- ① 呼び名をそろえる。すでに「書類選考」があるなら二度手を入れない。
    UPDATE selection_steps SET name = '書類選考'
     WHERE season_id = v_s3
       AND name = '書類審査'
       AND NOT EXISTS (
           SELECT 1 FROM selection_steps
            WHERE season_id = v_s3 AND name = '書類選考');

    -- ② 応募が乗っている期の並びは動かさない。
    IF EXISTS (SELECT 1 FROM applications WHERE season_id = v_s3) THEN
        RETURN;
    END IF;

    -- ③ 2期に対応する名前が無い段が3期に残っていたら、置き場所が決まらない。
    --    **推測で並べない。**
    SELECT string_agg(s3.name, '・') INTO v_unknown
      FROM selection_steps s3
     WHERE s3.season_id = v_s3
       AND NOT EXISTS (
           SELECT 1 FROM selection_steps s2
            WHERE s2.season_id = v_s2 AND s2.name = s3.name);
    IF v_unknown IS NOT NULL THEN
        RAISE NOTICE '3期に2期と対応しない段がある（%）。並びを推測しないので何もしない。',
                     v_unknown;
        RETURN;
    END IF;

    -- ④ 位置をいったん大きい値へ逃がす。UNIQUE(season_id, sort_order) は
    --    行ごとに検査されるので、単純な入れ替えは隣と衝突する（0005 と同じ技法）。
    UPDATE selection_steps SET sort_order = sort_order + 100
     WHERE season_id = v_s3;

    -- ⑤ 3期に無い段を、2期の位置と通過基準のまま作る。
    INSERT INTO selection_steps (season_id, sort_order, name, pass_criteria)
    SELECT v_s3, s2.sort_order, s2.name, s2.pass_criteria
      FROM selection_steps s2
     WHERE s2.season_id = v_s2
       AND NOT EXISTS (
           SELECT 1 FROM selection_steps s3
            WHERE s3.season_id = v_s3 AND s3.name = s2.name);

    -- ⑥ すでにある段を、2期と同じ位置へ詰め直す。
    --    名前と位置は2期の側で1対1なので、⑤で入った位置とは衝突しない。
    UPDATE selection_steps s3 SET sort_order = s2.sort_order
      FROM selection_steps s2
     WHERE s3.season_id = v_s3
       AND s3.sort_order > 100
       AND s2.season_id = v_s2
       AND s2.name = s3.name;

    -- ⑦ 軸を写す。段は名前で対応させる（id は期ごとに違う）。
    --    ON CONFLICT は位置の重なりに対する保険で、名前が違えば入らない
    --    ―― **こちらで軸を言い換えて増やさない。**
    INSERT INTO evaluation_criteria (
        selection_step_id, name, scale_max, sort_order, kind, applies_to)
    SELECT s3.id, c2.name, c2.scale_max, c2.sort_order, c2.kind, c2.applies_to
      FROM evaluation_criteria c2
      JOIN selection_steps s2 ON s2.id = c2.selection_step_id AND s2.season_id = v_s2
      JOIN selection_steps s3 ON s3.season_id = v_s3 AND s3.name = s2.name
     WHERE NOT EXISTS (
           SELECT 1 FROM evaluation_criteria c3
            WHERE c3.selection_step_id = s3.id AND c3.name = c2.name)
    ON CONFLICT (selection_step_id, sort_order) DO NOTHING;

    -- ⑧ 重み付けを合わせる。3期の9軸は取り込みが入れたもので kind が
    --    'standard' のままだった（0033 の既定）。**点は動かさない**
    --    ―― kind は表示のための区分で、集計には使わない（0033）。
    UPDATE evaluation_criteria c3 SET kind = c2.kind
      FROM evaluation_criteria c2
      JOIN selection_steps s2 ON s2.id = c2.selection_step_id AND s2.season_id = v_s2
      JOIN selection_steps s3 ON s3.season_id = v_s3 AND s3.name = s2.name
     WHERE c3.selection_step_id = s3.id
       AND c3.name = c2.name
       AND c3.kind <> c2.kind;
END $$;

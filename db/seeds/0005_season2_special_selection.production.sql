-- =============================================================
-- 0005 2期に「特別選考」を足す（応募管理表の選考フローに従う）
--
-- 依頼者の指示（実行⑬の続き）――
--   「まず2期で完成させて、それを3期に適用していく流れ」。
--
-- 応募管理表 `013_選考フロー` の「特別選考フロー」は、通常選考より前に
-- **事前面談（浩江さん・面談シート）**を置く。順序は
--   初期接点 → 事前面談 → エントリー(応募) → グループ面接 → 最終面接。
-- 事前面談は**応募より前の関門**なので、sort_order は先頭に置く
-- （3期で特別選考を先頭に置いた C-105 と同じ扱い。最終面接は最後のまま）。
--
-- ★ 9軸は運営の語をそのまま（面談シート＝「特別選考」シートの並び）。
--   A〜C は必須の前提（kind='required'）、D〜I は加点（kind='strong'）。
--   満点は 4（応募管理表に点の定義が無い。C-105 と同じ）。
--
-- ★ 書類選考・グループ面接の軸は**足していない。** 応募管理表にあるのは
--   結果の数値（一次選考結果・二次選考結果）だけで、**軸の呼び名が無い。**
--   こちらで名付けると運営が使っていない語がマスタとして固定化する
--   （0002 の「書類選考の軸は入れていない」と同じ判断。呼び名を受け取ってから足す）。
--
-- ★ 冪等。特別選考が既にあれば何もしない。0002 が付けた 1〜4 を +1 して
--   2〜5 へずらし、空いた 1 へ特別選考を入れる。sort_order は FK で
--   参照されない（評価は criteria_id を指す）ので、ずらしても評価は動かない。
-- =============================================================

DO $$
DECLARE
    v_season_id uuid;
    v_step_id   uuid;
BEGIN
    SELECT id INTO v_season_id FROM seasons WHERE enrollment_year = 2026;
    IF v_season_id IS NULL THEN
        RETURN;   -- 本番以外（実年度が入らない環境）。何もしない。
    END IF;

    -- 既にあるなら二度手を入れない。
    IF EXISTS (
        SELECT 1 FROM selection_steps
         WHERE season_id = v_season_id AND name = '特別選考'
    ) THEN
        RETURN;
    END IF;

    -- 既存の段を1つ後ろへ。UNIQUE(season_id, sort_order) は行ごとに検査される
    -- ので、単純な +1 は隣と衝突する。いったん大きい値へ逃がしてから詰め直す
    -- （C-105 と同じ技法）。1..4 → 101..104 → 2..5。
    UPDATE selection_steps SET sort_order = sort_order + 100
     WHERE season_id = v_season_id;
    UPDATE selection_steps SET sort_order = sort_order - 99
     WHERE season_id = v_season_id AND sort_order > 100;

    INSERT INTO selection_steps (season_id, sort_order, name, pass_criteria)
    VALUES (
        v_season_id, 1, '特別選考',
        '通常選考では取りこぼしやすい「突出した個」を確実に獲得する枠。'
        || '判断軸は応募管理表の「特別選考」シートから。A〜Cは必須の前提、D〜Iは加点。'
    )
    RETURNING id INTO v_step_id;

    INSERT INTO evaluation_criteria (selection_step_id, name, scale_max, sort_order, kind)
    VALUES
        (v_step_id, 'NEOの環境を“使い倒せる”時間と覚悟', 4, 1, 'required'),
        (v_step_id, 'Be Playfulへの適合',                4, 2, 'required'),
        (v_step_id, '他者と事業を進める前提を持っている', 4, 3, 'required'),
        (v_step_id, 'すでに「小さく踏み出している」',      4, 4, 'strong'),
        (v_step_id, '語るテーマが「自分ごと」',            4, 5, 'strong'),
        (v_step_id, 'フィードバック耐性',                  4, 6, 'strong'),
        (v_step_id, '周囲を巻き込んで“場”を生んだ経験',    4, 7, 'strong'),
        (v_step_id, '未完成だが、伸び代が異常',            4, 8, 'strong'),
        (v_step_id, 'NEO側が“賭けたい”と思える直感',       4, 9, 'strong');
END $$;

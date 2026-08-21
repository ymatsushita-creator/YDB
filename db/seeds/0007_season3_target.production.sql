-- =============================================================
-- 0007 3期の目標応募数を、2期から引き継ぐ（依頼者の指示。実行⑯）
--
-- 依頼者の言葉 ――「エクセルの内容は主に2期のものであるが、選考基準や
-- 募集要項、特別選考の基準等変わらないので引き継げ。勝手に取りこぼしてんじゃねぇよ」。
--
-- ★ 0006 は段と軸を写したが、**目標応募数だけが null のまま残っていた。**
--   `HANDOFF.md` は「3期の目標応募数 未受領」として保留にしていた ――
--   表には最初から書いてあった。応募管理表 `001_使い方` の目標 KR ――
--
--     「NEO ACADEMIA 2期生 100名の応募完了と36名の選出」
--
--   定員36は入っていて、**同じ行に並んでいる100だけが落ちていた。**
--   これが「取りこぼし」である。
--
-- ★ 値は**2期から読む**（このシードに 100 と書き写さない）。
--   同じ数字を2箇所に置くと、片方を直したときにもう片方が古くなる。
--
-- ★ 現在値を更新するので、**変更履歴を残す**（CLAUDE.md）。
--   目標応募数はファネルの達成率の分母になる。動いた事実が残らないと、
--   あとから「なぜ達成率が変わったのか」が読めない。
--
-- ★ 冪等。すでに入っていれば何もしない（履歴も積まない）。
-- =============================================================

-- ★ 変更履歴には**職員が要る**（`changed_by_staff_id` は NOT NULL）。
--   誰が変えたのかを名乗れないなら、この変更は入れない ―― 職員が1人も
--   居ない DB では何もせずに抜ける。**空欄で濁さない**（C-146 と同じ作法）。
DO $$
DECLARE
    v_s2     uuid;
    v_s3     uuid;
    v_target integer;
    v_old    integer;
    v_staff  uuid;
BEGIN
    SELECT id, target_application_count INTO v_s2, v_target
      FROM seasons WHERE enrollment_year = 2026 AND NOT is_demo;
    SELECT id, target_application_count INTO v_s3, v_old
      FROM seasons WHERE enrollment_year = 2027 AND NOT is_demo;

    IF v_s2 IS NULL OR v_s3 IS NULL THEN
        RAISE NOTICE '2期か3期が無い。何もしない。';
        RETURN;
    END IF;

    -- 2期に目標が無ければ、写す元が無い。**こちらで数を決めない。**
    IF v_target IS NULL THEN
        RAISE NOTICE '2期の目標応募数が空。写す元が無いので何もしない。';
        RETURN;
    END IF;

    IF v_old IS NOT DISTINCT FROM v_target THEN
        RETURN;   -- すでに同じ。履歴も積まない。
    END IF;

    -- 取り込みの名義があればそれを使う。無ければ最初に登録された職員。
    SELECT id INTO v_staff FROM staffs
     WHERE display_name = '応募管理表 取り込み' LIMIT 1;
    IF v_staff IS NULL THEN
        SELECT id INTO v_staff FROM staffs ORDER BY created_at, id LIMIT 1;
    END IF;
    IF v_staff IS NULL THEN
        RAISE NOTICE '職員が1人も居ない。変更履歴を名乗れないので何もしない。';
        RETURN;
    END IF;

    UPDATE seasons SET target_application_count = v_target WHERE id = v_s3;

    INSERT INTO season_revisions
        (season_id, changed_field, old_value, new_value, changed_at,
         changed_by_staff_id, reason)
    VALUES (v_s3, 'target_application_count',
            v_old::text, v_target::text, now(), v_staff,
            '2期から引き継ぐ（依頼者の指示。実行⑯）。'
            || '応募管理表 001_使い方 の目標 KR「100名の応募完了と36名の選出」より');
END $$;

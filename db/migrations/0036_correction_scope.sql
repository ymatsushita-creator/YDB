-- =============================================================
-- 0036 打ち消しは、同じ相手の記録に対してのみ行える
--
-- 実行⑮の点検（C-129）。CLAUDE.md は「追記専用テーブルの訂正は
-- 打ち消し行で行う」と定めており、打ち消し列（corrects_*）を持つ記録は
-- **4つ**ある ―― status_histories / approach_events / person_notes /
-- partner_recommendation_events。
--
-- ところが「打ち消せる**相手**」を縛っているのは status_histories だけ
-- だった（0007 `check_correction_scope`）。残る3つは、
--
--   * 乙さんの行から**甲さんのメモ**を打ち消せる
--   * Y大学の行から**X大学の推薦枠**を打ち消せる
--   * 3期の行から**2期の記録**を打ち消せる
--
-- 打ち消された行は有効判定のビュー（v_effective_*）から**黙って落ちる。**
-- 消された側の画面には何も出ない ―― 0007 が status_histories について
-- 書いたのと**まったく同じ壊れ方**が、あとから足した3つで開いていた。
--
-- ★ なぜいま塞ぐか ―― 実行⑮でこの3つに**画面から打ち消す道を通す**
--   （C-131）。SQL でしか書けなかったあいだは運営の手が届かなかったが、
--   道を通した瞬間、取り違えは**普通の操作**として起こりうる。
--   入口を開ける前に、範囲を記録層で閉じる。
--
-- ★ 判定を3回書き写さない（C-126 と同じ理由）。列の名前だけが違う
--   同じ規則なので、**トリガの引数で列を渡す1つの関数**にする。
--   書き写すと、片方だけ直したときに食い違う。
--
-- ★ status_histories は 0007 のまま残す。**動いている見張りを、
--   形をそろえるためだけに繋ぎ替えない**（本番で動作が変わる危険を、
--   見た目の統一と引き換えにしない）。0007 の判定内容はここと同じである。
-- =============================================================

CREATE OR REPLACE FUNCTION check_correction_scope_of()
RETURNS trigger AS $$
DECLARE
    -- TG_ARGV[0] … 打ち消し先を指す列（corrects_note_id など）
    -- TG_ARGV[1:] … 一致していなければならない列（person_id・season_id など）
    v_row     jsonb := to_jsonb(NEW);
    v_target  jsonb;
    v_ref     uuid;
    v_col     text;
BEGIN
    v_ref := (v_row ->> TG_ARGV[0])::uuid;
    IF v_ref IS NULL THEN
        RETURN NEW;
    END IF;

    -- 打ち消す相手は同じ表の行である（自己参照の外部キー）。
    EXECUTE format('SELECT to_jsonb(t) FROM %I t WHERE t.id = $1', TG_TABLE_NAME)
       INTO v_target USING v_ref;

    FOREACH v_col IN ARRAY TG_ARGV[1:array_length(TG_ARGV, 1) - 1] LOOP
        IF (v_target ->> v_col) IS DISTINCT FROM (v_row ->> v_col) THEN
            RAISE EXCEPTION
                'correction crosses %: % cannot correct a row of %',
                v_col, (v_row ->> v_col), (v_target ->> v_col)
                USING HINT = '訂正は同じ相手の記録に対してのみ行う（設計原則5）。';
        END IF;
    END LOOP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION check_correction_scope_of() IS
    '打ち消し行が、別の相手の記録を消していないかを見る。'
    '引数は「打ち消し先を指す列」と「一致していなければならない列」。';


-- メモは人に貼る事実。**期を持たない**ので、揃えるのは person_id だけ。
CREATE TRIGGER person_notes_correction_scope
    BEFORE INSERT ON person_notes
    FOR EACH ROW EXECUTE FUNCTION check_correction_scope_of(
        'corrects_note_id', 'person_id');

-- アプローチ状態は**人 × 期**の事実（0016）。どちらが違っても別の事実である。
CREATE TRIGGER approach_events_correction_scope
    BEFORE INSERT ON approach_events
    FOR EACH ROW EXECUTE FUNCTION check_correction_scope_of(
        'corrects_event_id', 'person_id', 'season_id');

-- 推薦枠ステイタスは**団体 × 期**の事実（0035）。同じ団体でも期が違えば別。
CREATE TRIGGER partner_recommendation_events_correction_scope
    BEFORE INSERT ON partner_recommendation_events
    FOR EACH ROW EXECUTE FUNCTION check_correction_scope_of(
        'corrects_event_id', 'partner_id', 'season_id');

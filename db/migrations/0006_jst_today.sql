-- =============================================================
-- 0006 「今日」の定義
--
-- 滞留日数（(2)の主要指標）は「割り当てから今日まで何日か」で決まる。
-- ここで CURRENT_DATE を使うと、A-1 と同じ問題がアプリ側から再び入り込む。
-- CURRENT_DATE はセッションの TimeZone 依存で、UTC 接続では
-- 日本時間の午前9時までずっと前日を指す。
--
-- 集計に使う「今日」は1箇所で定義しておく。
-- CURRENT_DATE と書きたくなったら、代わりにこれを呼ぶ。
-- =============================================================

CREATE OR REPLACE FUNCTION jst_today()
RETURNS date
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$ SELECT jst_date(now()) $$;

COMMENT ON FUNCTION jst_today() IS
    '運用タイムゾーンでの今日。滞留判定などの基準日。CURRENT_DATE は使わない。';

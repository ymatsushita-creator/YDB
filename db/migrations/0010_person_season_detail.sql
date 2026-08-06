-- =============================================================
-- 0010 個人×年度の状態に、接点の鮮度を持たせる
--
-- 個人を1人引く画面を作るにあたって、既存の定義のままでは
-- 同じ人について画面ごとに違う答えが出ることが分かった。
--
--   v_person_season_state.current_level = 'identified_person'
--     … その年度に応募していない識別済みの人。窓を持たない
--   f_funnel_daily.identified_person_cum（林の KPI）
--     … 基準日から遡って N 日以内に接点がある人
--
-- 前者で「林」と表示された人が、後者に数えられているとは限らない。
-- デモデータの2027年度では、前者が 2573 人、後者が 661 人になる。
-- 個人の画面が前者をそのまま「林」と出すと、年度サマリの林と桁が違う。
-- ①（誰がどんな状態か）の答えが、見る画面で変わってしまう。
--
-- 直し方は3つ考えられた。
--
--   (a) v_person_season_state に窓を持ち込む
--       → 資料2-3「林に期は存在しない」の実装であり、Person に対する
--         期スコープの検索結果という位置づけが崩れる。既存の集計にも波及する
--   (b) 画面側で数え直す
--       → 集計定義がアプリとデータベースの二箇所に散る（C-11 と同じ理由で却下）
--   (c) 段（current_level）と接点の鮮度を、直交する2つの事実として並べる
--
-- (c) を採った。段は「その年度に到達した最高地点」、鮮度は「基準日時点で
-- 生きている接点があるか」で、そもそも別の軸である。木や幹になった人も
-- 接点を持てば林の窓に入る。段ごとに数えて足すと合わないが、
-- 段を問わず窓の内側を数えれば年度サマリの林に一致する。
-- この一致を tests/12 が機械的に固定している。
--
-- 窓は引数にする。90 は集計定義そのものであり、コードに埋めると
-- 変更履歴が残らない（原則4、C-2 と同じ判断）。
-- =============================================================

CREATE FUNCTION f_person_season_state(active_window_days integer)
RETURNS TABLE (
    person_id              uuid,
    season_id              uuid,
    enrollment_year        integer,
    current_level          text,
    is_accepted_in_season  boolean,
    has_applied_in_season  boolean,
    -- 年度内の集計対象応募の件数。取り下げて出し直すと2件になる（A-2）。
    -- 段は最高到達点に畳まれるため、件数はここでしか見えない。
    application_count      bigint,
    -- 基準日。終わった年度は選考終了日、進行中の年度は今日。
    -- 終わった年度で今日を基準にすると、選考終了後に付いた接点で
    -- 過去の林が動く。進行中の年度で選考終了日を基準にすると、
    -- まだ来ていない日の値を出すことになる。
    as_of                  date,
    last_touch_at          timestamptz,
    -- 基準日時点で、年度サマリの林に数えられる条件を満たすか。
    in_active_window       boolean
) AS $$
    SELECT
        ps.person_id,
        ps.season_id,
        ps.enrollment_year,
        ps.current_level,
        ps.is_accepted_in_season,
        ps.has_applied_in_season,
        (SELECT count(*) FROM v_application_state a
          WHERE a.person_id = ps.person_id AND a.season_id = ps.season_id),
        b.as_of,
        (SELECT max(t.occurred_at) FROM touchpoints t
          WHERE t.person_id = ps.person_id
            AND jst_date(t.occurred_at) <= b.as_of),
        -- f_funnel_daily の林と同じ3条件。削除済みの除外は
        -- v_person_season_state が済ませているので、残る2つをここで見る。
        -- 識別日の条件を落とすと、進行中の年度で「基準日より後に
        -- 識別された人」が窓に入り、ファネルの林と食い違う。
        (jst_date(p.created_at) <= b.as_of
         AND EXISTS (
               SELECT 1 FROM touchpoints t
                WHERE t.person_id = ps.person_id
                  AND jst_date(t.occurred_at) <= b.as_of
                  AND jst_date(t.occurred_at) > b.as_of - guard.window_days))
      -- ガードを最外の FROM に置く。行が0件でも必ず評価させるため（A-4）。
      FROM (
             SELECT require_positive(
                        f_person_season_state.active_window_days, 'active_window_days'
                    ) AS window_days
           ) AS guard
     CROSS JOIN v_person_season_state ps
      JOIN persons p ON p.id = ps.person_id
      JOIN seasons se ON se.id = ps.season_id
     CROSS JOIN LATERAL (SELECT least(se.selection_end_date, jst_today())) AS b(as_of);
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION f_person_season_state(integer) IS
    '個人×年度の現在地と接点の鮮度。段と鮮度は直交する軸。段を問わず in_active_window を数えると f_funnel_daily の林に一致する。';

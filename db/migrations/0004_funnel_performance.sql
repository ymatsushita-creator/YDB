-- =============================================================
-- 0004 ファネル日次断面の書き直し（性能）
--
-- 原典の意味論は正しいが、計算量が実用に耐えない。潰すべき構造が2つある。
--
-- 具体的なミリ秒はここに書かない。手元にあるのは作り物のデモデータであり、
-- そこから出た数字を根拠として残すと、追試できない値に権威が付く。
-- 残すべきなのは、データ量に依存しない構造のほう。
--
-- (1) 相関副問い合わせが行ごとに再帰CTEを評価し直す
--     返す行は（年度 × 選考期間の日数）。そのそれぞれが6本の相関副問い合わせを
--     走らせ、うち4本が v_effective_status_histories（訂正チェーンを解く再帰CTE）を
--     先頭から評価する。訂正の解決が「返す行数 × 4」回起きる。
--     行数は日数に比例して増えるので、期間を延ばすだけで線形に悪化する。
--     → 訂正の解決は1回だけ。応募ごとに節目の日を1行へ畳み、
--       日次の増分を出してウィンドウ関数で累積する。
--       訂正の解決回数が返す行数から切り離される。
--
-- (2) 林を日ごとに count(DISTINCT person_id) で数え直す
--     日ごとに窓内の接点を集めて重複排除する。日数 × 窓内の接点数。
--     窓を広げても日数を増やしても効いてくる。
--     → 各 Person の「アクティブでいる期間」を区間として求め、
--       重なる区間を1本にまとめ、開始日に +1 / 終了翌日に -1 を立てて
--       暦日で累積する。日ごとの重複排除がなくなる。
--
--         接点 10/15、窓 30日  →  区間 [10/15, 11/13]
--         接点 10/15 と 11/01  →  区間 [10/15, 11/30]（重なるので1本）
--
--       区間にまとめてから数えるので、同じ人を二度数えることが
--       構造的に起きない。
--
-- 意味論は変えていない。ただし tests/07_funnel_equivalence.test.ts が
-- 突き合わせている相手は 0002 の定義であって、原典そのものではない。
-- 0002 は既に A-1（jst_date）・A-2（v_countable_applications）・
-- C-1（v_final_selection_step）を反映済みだからである。
-- この書き直しが保証しているのは「0004 ≡ 0002」であり、
-- 「0002 ≡ 原典」のほうは A-1 / A-2 / C-1 の各テストが個別に担保している。
-- =============================================================

CREATE OR REPLACE FUNCTION f_funnel_daily(active_window_days integer)
RETURNS TABLE (
    season_id              uuid,
    as_of                  date,
    relative_day           integer,
    identified_person_cum  bigint,
    applicant_cum          bigint,
    accepted_cum           bigint,
    net_accepted_cum       bigint,
    rejected_cum           bigint,
    withdrawn_cum          bigint
) AS $$
WITH guard AS (
    SELECT require_positive(
               f_funnel_daily.active_window_days, 'active_window_days') AS window_days
),

season_days AS (
    SELECT s.id                  AS season_id,
           s.application_open_date,
           s.selection_end_date,
           g.ts::date            AS day
      FROM guard
     CROSS JOIN seasons s
     CROSS JOIN LATERAL generate_series(
             s.application_open_date::timestamp,
             s.selection_end_date::timestamp,
             interval '1 day'
         ) AS g(ts)
),

-- 累積を積み上げる連続した暦日。年度の系列は歯抜けになりうるが、
-- 累積は歯抜けの上では計算できない。
bounds AS (
    SELECT min(sd.application_open_date) AS lo, max(sd.selection_end_date) AS hi
      FROM season_days sd
),
calendar AS (
    SELECT g.ts::date AS day
      FROM bounds b
     CROSS JOIN LATERAL generate_series(b.lo::timestamp, b.hi::timestamp, interval '1 day') AS g(ts)
),

-- -------------------------------------------------------------
-- 林：Person ごとのアクティブ区間
-- -------------------------------------------------------------
-- 1接点 = [接点日, 接点日 + 窓 - 1] の区間。識別より前には遡らない。
touch_spans AS (
    SELECT DISTINCT
           t.person_id,
           greatest(jst_date(t.occurred_at), jst_date(p.created_at))    AS active_from,
           jst_date(t.occurred_at) + guard.window_days - 1              AS active_to
      FROM guard
     CROSS JOIN touchpoints t
      JOIN persons p ON p.id = t.person_id AND p.deleted_at IS NULL
),
-- 重なる区間・隣接する区間を1本にまとめる（gaps and islands）。
-- まとめないと、接点の数だけ同じ人を数えてしまう。
marked AS (
    SELECT ts.person_id, ts.active_from, ts.active_to,
           CASE WHEN ts.active_from <= max(ts.active_to) OVER (
                        PARTITION BY ts.person_id ORDER BY ts.active_from
                        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) + 1
                THEN 0 ELSE 1 END AS starts_new_span
      FROM touch_spans ts
     WHERE ts.active_from <= ts.active_to
),
islands AS (
    SELECT m.person_id, m.active_from, m.active_to,
           sum(m.starts_new_span) OVER (
               PARTITION BY m.person_id ORDER BY m.active_from) AS span_no
      FROM marked m
),
merged_spans AS (
    SELECT i.person_id, min(i.active_from) AS active_from, max(i.active_to) AS active_to
      FROM islands i
     GROUP BY i.person_id, i.span_no
),
-- 暦の開始より前に始まった区間は開始日に寄せる。
-- 暦の開始より前に終わった区間は +1 と -1 が同じ日に立って打ち消し合う。
grove_deltas AS (
    SELECT greatest(ms.active_from, b.lo) AS day,  1 AS delta
      FROM merged_spans ms CROSS JOIN bounds b
    UNION ALL
    SELECT greatest(ms.active_to + 1, b.lo),      -1
      FROM merged_spans ms CROSS JOIN bounds b
),
grove AS (
    SELECT c.day,
           sum(COALESCE(gd.delta, 0)) OVER (
               ORDER BY c.day ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
           )::bigint AS person_count
      FROM calendar c
      LEFT JOIN (SELECT g2.day, sum(g2.delta) AS delta FROM grove_deltas g2 GROUP BY g2.day) gd
             ON gd.day = c.day
),

-- -------------------------------------------------------------
-- 木・幹・不合格・辞退
-- -------------------------------------------------------------
effective AS MATERIALIZED (
    SELECT sh.application_id, sh.transition_type, sh.selection_step_id, sh.occurred_at
      FROM v_effective_status_histories sh
),
milestones AS (
    SELECT
        a.id                          AS application_id,
        a.season_id                   AS season_id,
        jst_date(a.submitted_at)      AS submitted_day,
        min(jst_date(e.occurred_at)) FILTER (
            WHERE e.transition_type = 'advance'
              AND e.selection_step_id = fs.selection_step_id
        )                             AS accepted_day,
        min(jst_date(e.occurred_at)) FILTER (
            WHERE e.transition_type = 'reject'
        )                             AS rejected_day,
        min(jst_date(e.occurred_at)) FILTER (
            WHERE e.transition_type = 'withdraw'
        )                             AS withdrawn_day
      FROM v_countable_applications a
      LEFT JOIN v_final_selection_step fs ON fs.season_id = a.season_id
      LEFT JOIN effective e             ON e.application_id = a.id
     GROUP BY a.id, a.season_id, a.submitted_at
),
season_bounds AS (
    SELECT DISTINCT sd.season_id, sd.application_open_date, sd.selection_end_date
      FROM season_days sd
),
-- 応募開始日より前に起きた出来事は初日に寄せる（累積の定義を保つ）。
--
-- greatest() は NULL を無視して非 NULL の最大値を返す。多くの関数と違い
-- NULL を伝播しない。素直に greatest(m.accepted_day, open_date) と書くと、
-- 「まだ合格していない」を表す NULL が応募開始日に化け、
-- 全応募が初日に合格したことになる。CASE で NULL を守る。
clamped AS (
    SELECT m.season_id,
           sb.selection_end_date AS end_day,
           greatest(m.submitted_day, sb.application_open_date) AS submitted_day,
           CASE WHEN m.accepted_day  IS NOT NULL
                THEN greatest(m.accepted_day,  sb.application_open_date) END AS accepted_day,
           CASE WHEN m.rejected_day  IS NOT NULL
                THEN greatest(m.rejected_day,  sb.application_open_date) END AS rejected_day,
           CASE WHEN m.withdrawn_day IS NOT NULL
                THEN greatest(m.withdrawn_day, sb.application_open_date) END AS withdrawn_day
      FROM milestones m
      JOIN season_bounds sb ON sb.season_id = m.season_id
),
deltas AS (
    SELECT c.season_id, c.submitted_day AS day,
           1 AS d_applicant, 0 AS d_accepted, 0 AS d_net, 0 AS d_rejected, 0 AS d_withdrawn
      FROM clamped c WHERE c.submitted_day <= c.end_day
    UNION ALL
    SELECT c.season_id, c.accepted_day, 0, 1, 0, 0, 0
      FROM clamped c WHERE c.accepted_day IS NOT NULL AND c.accepted_day <= c.end_day
    UNION ALL
    SELECT c.season_id, c.rejected_day, 0, 0, 0, 1, 0
      FROM clamped c WHERE c.rejected_day IS NOT NULL AND c.rejected_day <= c.end_day
    UNION ALL
    SELECT c.season_id, c.withdrawn_day, 0, 0, 0, 0, 1
      FROM clamped c WHERE c.withdrawn_day IS NOT NULL AND c.withdrawn_day <= c.end_day
    UNION ALL
    -- 純幹に乗るのは、合格した日以降・辞退する日より前。
    -- 合格より先に辞退があるなら、純幹には一度も乗らない。
    SELECT c.season_id, c.accepted_day, 0, 0, 1, 0, 0
      FROM clamped c
     WHERE c.accepted_day IS NOT NULL AND c.accepted_day <= c.end_day
       AND (c.withdrawn_day IS NULL OR c.withdrawn_day > c.accepted_day)
    UNION ALL
    SELECT c.season_id, c.withdrawn_day, 0, 0, -1, 0, 0
      FROM clamped c
     WHERE c.accepted_day IS NOT NULL AND c.accepted_day <= c.end_day
       AND c.withdrawn_day IS NOT NULL AND c.withdrawn_day <= c.end_day
       AND c.withdrawn_day > c.accepted_day
),
daily AS (
    SELECT d.season_id, d.day,
           sum(d.d_applicant)::bigint AS d_applicant,
           sum(d.d_accepted)::bigint  AS d_accepted,
           sum(d.d_net)::bigint       AS d_net,
           sum(d.d_rejected)::bigint  AS d_rejected,
           sum(d.d_withdrawn)::bigint AS d_withdrawn
      FROM deltas d
     GROUP BY d.season_id, d.day
)

SELECT
    sd.season_id,
    sd.day,
    (sd.day - sd.application_open_date)::integer,
    COALESCE(g.person_count, 0)::bigint,
    COALESCE(sum(dl.d_applicant) OVER w, 0)::bigint,
    COALESCE(sum(dl.d_accepted)  OVER w, 0)::bigint,
    COALESCE(sum(dl.d_net)       OVER w, 0)::bigint,
    COALESCE(sum(dl.d_rejected)  OVER w, 0)::bigint,
    COALESCE(sum(dl.d_withdrawn) OVER w, 0)::bigint
  FROM season_days sd
  LEFT JOIN grove g  ON g.day = sd.day
  LEFT JOIN daily dl ON dl.season_id = sd.season_id AND dl.day = sd.day
WINDOW w AS (PARTITION BY sd.season_id ORDER BY sd.day
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW);
$$ LANGUAGE sql STABLE;

-- =============================================================
-- 0029 幻のデモ期
--
-- 依頼者の指示（実行⑪）――「幻のデモ期を作って、デモデータも選択できるように」。
--
-- ★★ **架空データを、実データと同じ DB に置く。** ★★
--
--   これまで境界は「環境」だった（C-28）―― デモは使い捨ての DB に入れ、
--   実年度（`*.production.sql`）はそこへ入れない。同じ 2026 が2つあると、
--   **創作の応募が実在の年度にぶら下がる**からである。
--
--   依頼者の指示で、境界を**環境から行へ**移す。同じ DB に置く以上、
--   「どちらの世界の行か」を記録層が知っていなければならない。
--   知らなければ、集計はいつか必ず混ざる。
--
-- ★ 印は2つ要る（期と人）
--
--   期だけに印を付けても、**接点の年度帰属は日付で決まる**ので
--   （`v_touchpoint_season`）、デモ期の日付が実在の期と重なった瞬間に
--   架空の接点が実在の期のファネルへ入る。逆もある。
--   人にも印を付け、**架空の人は架空の期にだけ帰属する**ようにする。
--
-- ★ 「デモ期に実在の候補者をぶら下げる」道も塞ぐ
--
--   画面はデモ期を選んだまま候補者を追加できる。そのとき人に印が付かないと、
--   実在の人が架空の期の一覧に並ぶ。トリガで両側を縛る。
-- =============================================================

ALTER TABLE seasons ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE persons ADD COLUMN is_demo boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN seasons.is_demo IS
    '幻のデモ期。架空データだけが入る期で、実在の記録と混ぜない。';
COMMENT ON COLUMN persons.is_demo IS
    '架空の人。デモ期にだけ帰属する。実在の期の集計には現れない。';

-- 一覧の既定は「実在の期」。画面が毎回書かなくて済むよう索引を1本置く。
CREATE INDEX seasons_real_idx ON seasons (enrollment_year DESC) WHERE NOT is_demo;


-- -------------------------------------------------------------
-- 1. 接点の年度帰属に、世界の境界を入れる
-- -------------------------------------------------------------
-- 変更は1行 ―― `s.is_demo = p.is_demo`。
-- 架空の人の接点は架空の期にだけ、実在の人の接点は実在の期にだけ寄る。
-- 日付が重なっても混ざらない。**日付の付け方に安全性を依存させない。**
--
-- 列の並びと型は原典（0002）のまま。ここに依存するビューは作り直さない。
CREATE OR REPLACE VIEW v_touchpoint_season AS
SELECT
    t.id AS touchpoint_id,
    t.person_id,
    t.channel_id,
    t.partner_id,
    t.occurred_at,
    (SELECT s.id FROM seasons s
      WHERE jst_date(t.occurred_at) BETWEEN s.outreach_start_date AND s.selection_end_date
        AND s.is_demo = p.is_demo
      ORDER BY s.enrollment_year ASC LIMIT 1) AS season_id
  FROM touchpoints t
  JOIN persons p ON p.id = t.person_id;

COMMENT ON VIEW v_touchpoint_season IS
    '接点の年度帰属。期間が重なる年度は enrollment_year の小さいほうへ寄せる。'
    '架空の人は架空の期にだけ帰属する（0029）。';


-- -------------------------------------------------------------
-- 2. 世界をまたぐ行を作らせない
-- -------------------------------------------------------------
-- 応募とアプローチの出来事は「人 × 期」の行である。
-- ここが混ざると、一覧・ファネル・確度のすべてが混ざる。
CREATE FUNCTION demo_boundary_check()
RETURNS trigger AS $$
DECLARE
    v_person boolean;
    v_season boolean;
BEGIN
    SELECT p.is_demo INTO v_person FROM persons p WHERE p.id = NEW.person_id;
    SELECT s.is_demo INTO v_season FROM seasons s WHERE s.id = NEW.season_id;

    IF v_person IS DISTINCT FROM v_season THEN
        RAISE EXCEPTION 'デモ期と実在の期をまたぐ行は作れない'
            USING HINT = 'デモ期には架空の人（persons.is_demo）だけを結び付ける。';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION demo_boundary_check() IS
    '人と期の is_demo が一致しない行を拒否する。境界の定義はここ1箇所。';

CREATE TRIGGER applications_demo_boundary
    BEFORE INSERT OR UPDATE ON applications
    FOR EACH ROW EXECUTE FUNCTION demo_boundary_check();

CREATE TRIGGER approach_events_demo_boundary
    BEFORE INSERT ON approach_events
    FOR EACH ROW EXECUTE FUNCTION demo_boundary_check();

CREATE TRIGGER candidate_numbers_demo_boundary
    BEFORE INSERT OR UPDATE ON candidate_numbers
    FOR EACH ROW EXECUTE FUNCTION demo_boundary_check();


-- -------------------------------------------------------------
-- 3. ファネルの林を、世界ごとに積む
-- -------------------------------------------------------------
-- ★★ ここが**唯一、日付では守れない場所**である。★★
--
--   林（identified_person）は「直近に接点がある人」を数える。0004 の
--   実装は暦日ごとに人数を積むだけで、**年度で絞っていない**
--   （接点は年度に属さない ―― 属するのは帰属ビューの上での話である）。
--   したがってデモ期の日付を実在の期からどれだけ離しても、
--   架空の人は実在の期のファネルの林に足し込まれる。
--
--   0004 の定義を写し、`is_demo` を通して**世界ごとに積む**ようにした。
--   足したのは列と PARTITION だけで、意味論は変えていない
--   （tests/07_funnel_equivalence.test.ts が 0002 との一致を見張っている）。
-- -------------------------------------------------------------

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
           s.is_demo,
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
           p.is_demo,
           greatest(jst_date(t.occurred_at), jst_date(p.created_at))    AS active_from,
           jst_date(t.occurred_at) + guard.window_days - 1              AS active_to
      FROM guard
     CROSS JOIN touchpoints t
      JOIN persons p ON p.id = t.person_id AND p.deleted_at IS NULL
),
-- 重なる区間・隣接する区間を1本にまとめる（gaps and islands）。
-- まとめないと、接点の数だけ同じ人を数えてしまう。
marked AS (
    SELECT ts.person_id, ts.is_demo, ts.active_from, ts.active_to,
           CASE WHEN ts.active_from <= max(ts.active_to) OVER (
                        PARTITION BY ts.person_id ORDER BY ts.active_from
                        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) + 1
                THEN 0 ELSE 1 END AS starts_new_span
      FROM touch_spans ts
     WHERE ts.active_from <= ts.active_to
),
islands AS (
    SELECT m.person_id, m.is_demo, m.active_from, m.active_to,
           sum(m.starts_new_span) OVER (
               PARTITION BY m.person_id ORDER BY m.active_from) AS span_no
      FROM marked m
),
merged_spans AS (
    SELECT i.person_id, i.is_demo,
           min(i.active_from) AS active_from, max(i.active_to) AS active_to
      FROM islands i
     GROUP BY i.person_id, i.is_demo, i.span_no
),
-- 暦の開始より前に始まった区間は開始日に寄せる。
-- 暦の開始より前に終わった区間は +1 と -1 が同じ日に立って打ち消し合う。
grove_deltas AS (
    SELECT greatest(ms.active_from, b.lo) AS day, ms.is_demo,  1 AS delta
      FROM merged_spans ms CROSS JOIN bounds b
    UNION ALL
    SELECT greatest(ms.active_to + 1, b.lo),      ms.is_demo, -1
      FROM merged_spans ms CROSS JOIN bounds b
),
grove AS (
    -- ★ 世界ごとに積む（0029）。1本で積むと、架空の人が
    --   **実在の期の林に混ざる** ―― ここは年度で絞っていないため、
    --   デモ期の日付を実在の期からどれだけ離しても混ざる。
    SELECT c.day, w.is_demo,
           sum(COALESCE(gd.delta, 0)) OVER (
               PARTITION BY w.is_demo
               ORDER BY c.day ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
           )::bigint AS person_count
      FROM calendar c
     CROSS JOIN (VALUES (false), (true)) AS w(is_demo)
      LEFT JOIN (SELECT g2.day, g2.is_demo, sum(g2.delta) AS delta
                   FROM grove_deltas g2 GROUP BY g2.day, g2.is_demo) gd
             ON gd.day = c.day AND gd.is_demo = w.is_demo
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
  LEFT JOIN grove g  ON g.day = sd.day AND g.is_demo = sd.is_demo
  LEFT JOIN daily dl ON dl.season_id = sd.season_id AND dl.day = sd.day
WINDOW w AS (PARTITION BY sd.season_id ORDER BY sd.day
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW);
$$ LANGUAGE sql STABLE;

-- =============================================================
-- 0005 状態ビューの書き直し
--
-- 0004 と同じ構造の問題が v_application_state と v_person_lifetime_summary にも
-- ある。応募1件ごとに EXISTS が3本走り、そのたびに訂正チェーンの再帰CTEが
-- 先頭から評価される。訂正の解決が「応募数 × 3」回起きる。
-- v_person_season_state は v_application_state を引くので、そのまま巻き込まれる。
--
-- 相関副問い合わせを LEFT JOIN + FILTER 付き集約に置き換える。
-- 訂正チェーンの解決は結合の中で1回だけ起きる。
--
-- 意味論は変えない。EXISTS は bool_or と同値で、
-- 行が1つも無いときの false は COALESCE で明示する。
-- この同値性は tests/08_state_equivalence.test.ts で、
-- 原典 basic/ の EXISTS 版を参照実装として突き合わせている。
-- =============================================================

CREATE OR REPLACE VIEW v_application_state AS
SELECT
    a.id                        AS application_id,
    a.person_id,
    a.season_id,
    a.submitted_at,
    a.is_reapplication,
    (a.voided_at IS NOT NULL)   AS is_voided,
    -- 幹：最終ステップへの有効な advance に到達したことがある
    COALESCE(bool_or(
        e.transition_type = 'advance' AND e.selection_step_id = fs.selection_step_id
    ), false)                   AS is_accepted,
    COALESCE(bool_or(e.transition_type = 'reject'),   false) AS is_rejected,
    COALESCE(bool_or(e.transition_type = 'withdraw'), false) AS is_withdrawn
  FROM v_countable_applications a
  LEFT JOIN v_final_selection_step      fs ON fs.season_id = a.season_id
  LEFT JOIN v_effective_status_histories e ON e.application_id = a.id
 GROUP BY a.id, a.person_id, a.season_id, a.submitted_at, a.is_reapplication, a.voided_at;


CREATE OR REPLACE VIEW v_person_lifetime_summary AS
SELECT
    p.id                                   AS person_id,
    p.created_at                           AS identified_at,
    t.last_touch_at,
    COALESCE(s.application_count, 0) > 0   AS has_ever_applied,
    COALESCE(s.accepted_count, 0) > 0      AS has_ever_been_accepted,
    COALESCE(s.application_count, 0)       AS application_count
  FROM persons p
  LEFT JOIN LATERAL (
        SELECT max(tp.occurred_at) AS last_touch_at
          FROM touchpoints tp WHERE tp.person_id = p.id
       ) t ON true
  LEFT JOIN (
        SELECT vas.person_id,
               count(*)                            AS application_count,
               count(*) FILTER (WHERE vas.is_accepted) AS accepted_count
          FROM v_application_state vas
         GROUP BY vas.person_id
       ) s ON s.person_id = p.id
 WHERE p.deleted_at IS NULL;

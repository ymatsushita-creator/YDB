-- =============================================================
-- 0055 候補者数の母集団を1つにする
--
-- 候補者数は、期ごとに番号を持つ全員から、現在のアプローチ状態が
-- 終端の人を除いた人数とする。画面・KPI・AIはこのビューを数える。
-- 確度は対象可否とは別の軸なので、S/A/B/Cのまま併記する。
-- =============================================================

UPDATE approach_states
   SET label = '対象外(F)'
 WHERE code = 'declined';

CREATE VIEW v_candidate_population AS
SELECT n.season_id,
       n.person_id,
       n.number,
       n.assigned_at,
       a.approach_code,
       a.approach_label,
       -- 確度順一覧の第2ソートキー。v_headhunting_list が持っていた列で、
       -- 落とすと ORDER BY h.state_since が壊れる（2026-09-09 に回帰1本で検出）。
       a.state_since,
       c.grade_code
  FROM candidate_numbers n
  JOIN persons p ON p.id = n.person_id
  LEFT JOIN v_person_approach_state a
         ON a.person_id = n.person_id AND a.season_id = n.season_id
  LEFT JOIN v_person_confidence c
         ON c.person_id = n.person_id AND c.season_id = n.season_id
 WHERE COALESCE(a.is_terminal, false) = false
   AND p.deleted_at IS NULL
   AND p.anonymized_at IS NULL;

COMMENT ON VIEW v_candidate_population IS
    '期ごとの候補者母集団。候補者番号の全体から現在の終端状態を除く。';

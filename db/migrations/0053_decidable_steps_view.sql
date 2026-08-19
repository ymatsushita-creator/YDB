-- =============================================================
-- 0053 判定可能ステップの共有ビュー
--
-- getDecidableStep（src/commands/decide.ts）の判定条件を
-- DB ビューとして共有する。統合タスク一覧（decide タスク）と
-- getDecidableStep の両方がこの正典を参照する（Phase 4 契約 #4）。
--
-- 条件（getDecidableStep と同一）:
--   1. 応募が動いている（v_active_applications）
--   2. そのステップの評価がすべて提出済み（pending / held が残っていない）
--   3. そのステップの遷移がまだ記録されていない（二重に判定しない）
--
-- 出力:
--   1 応募あたり複数の判定可能ステップがありうる（先のステップから順に
--   1つずつ判定するため）。呼び出し側が step_order で LIMIT 1 する。
--
-- ★ getDecidableStep は WHERE application_id = $1 で1件引く。
--   統合タスク一覧は WHERE season_id = $1 で全件引く。
--   両方に共通する判定条件だけをここに置き、
--   **絞り込みは呼び出し側の責任とする。**
-- =============================================================

CREATE VIEW v_decidable_steps AS
SELECT a.id            AS application_id,
       a.person_id,
       ss.id           AS selection_step_id,
       ss.name         AS step_name,
       ss.sort_order   AS step_order,
       ss.season_id,
       ss.sla_days,
       nx.id           AS next_step_id,
       nx.name         AS next_step_name,
       count(e.id)::int             AS submitted_evaluations,
       max(e.submitted_at)          AS last_submitted_at
  FROM v_active_applications a
  JOIN evaluations e       ON e.application_id = a.id
  JOIN selection_steps ss  ON ss.id = e.selection_step_id
  LEFT JOIN selection_steps nx
         ON nx.season_id = ss.season_id
        AND nx.sort_order = ss.sort_order + 1
 WHERE -- そのステップに、まだ判断が下りていない評価が無い
       NOT EXISTS (
           SELECT 1 FROM evaluations o
            WHERE o.application_id = a.id
              AND o.selection_step_id = ss.id
              AND o.state <> 'submitted')
       -- そのステップの遷移がまだ無い（打ち消されたものは除く）
   AND NOT EXISTS (
           SELECT 1 FROM v_effective_status_histories sh
            WHERE sh.application_id = a.id
              AND sh.selection_step_id = ss.id)
 GROUP BY a.id, a.person_id,
          ss.id, ss.name, ss.sort_order, ss.season_id, ss.sla_days,
          nx.id, nx.name;

COMMENT ON VIEW v_decidable_steps IS
    'いま判定できるステップ。getDecidableStep と統合タスク一覧の共有正典。'
    '母集団は v_active_applications。1応募に複数行ありうる'
    '（呼び出し側が step_order で絞る）。';

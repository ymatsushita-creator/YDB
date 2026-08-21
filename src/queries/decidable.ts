import { maybeOne, type Db } from '../db/client.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface DecidableStep {
  application_id: string
  selection_step_id: string
  step_name: string
  step_order: number
  /** 次のステップ。無ければ null（最終ステップ = 通過させると合格）。 */
  next_step_id: string | null
  next_step_name: string | null
  /** そのステップに提出済みの評価が何件あるか。 */
  submitted_evaluations: number
}

/**
 * いま判定できるステップ。
 *
 * 成り立つ条件は3つ。**どれも事実の有無で見る。**
 *
 *   1. 応募が動いている（`v_active_applications`）
 *   2. そのステップの評価がすべて提出済み（判断待ち・保留が残っていない）
 *   3. そのステップの遷移がまだ記録されていない（二重に判定しない）
 *
 * 面接官が2人いるステップは、**2人とも提出してから**判定できる。
 *
 * ★ 判定条件は `v_decidable_steps`（0053）に共有ビューとして置いた。
 *   統合タスク一覧の decide タスクも同じビューを参照する。
 *   判定可能ロジックを2箇所に書かない（Phase 4 契約 #4）。
 */
export const getDecidableStep = (db: Db, applicationId: string) => {
  if (!UUID.test(applicationId)) return Promise.resolve(null)
  return maybeOne<DecidableStep>(db, `
    SELECT application_id, selection_step_id, step_name, step_order,
           next_step_id, next_step_name, submitted_evaluations
      FROM v_decidable_steps
     WHERE application_id = $1
     ORDER BY step_order
     LIMIT 1`, [applicationId])
}

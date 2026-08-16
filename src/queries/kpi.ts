import { all, type Db } from '../db/client.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface KpiRecord {
  id: string
  title: string
  variable: string
  value: string
  memo: string | null
  archived_at: Date | null
  revised_at: Date
}

/** 最新の改訂だけを読む。既定ではアーカイブ済みを運用画面へ戻さない。 */
export const listKpis = (db: Db, seasonId: string, includeArchived = false) => {
  if (!UUID.test(seasonId)) return Promise.resolve([])
  return all<KpiRecord>(db, `
    WITH latest AS (
      SELECT DISTINCT ON (r.kpi_id)
             r.kpi_id, r.title, r.variable, r.value, r.memo,
             r.archived_at, r.created_at AS revised_at
        FROM kpi_revisions r
       ORDER BY r.kpi_id, r.revision_no DESC
    )
    SELECT k.id, l.title, l.variable, l.value, l.memo,
           l.archived_at, l.revised_at
      FROM kpis k
      JOIN latest l ON l.kpi_id = k.id
     WHERE k.season_id = $1
       AND ($2::boolean OR l.archived_at IS NULL)
     ORDER BY k.created_at, k.id`, [seasonId, includeArchived])
}

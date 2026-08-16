import { maybeOne, scalar, type Db } from '../db/client.ts'
import { blank } from './text.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)$/
export type KpiFailure = 'bad_season' | 'bad_kpi' | 'blank_title' | 'blank_variable' | 'bad_value' | 'archived' | 'bad_metric'
export type KpiResult = { ok: true; id: string } | { ok: false; reason: KpiFailure }

const fields = (input: {
  title: string; variable: string; value: string; memo: string; metricKey?: string
}) => {
  const title = blank(input.title)
  const variable = blank(input.variable)
  const rawValue = input.value.trim()
  if (!title) return { ok: false as const, reason: 'blank_title' as const }
  if (!variable) return { ok: false as const, reason: 'blank_variable' as const }
  if (!NUMBER.test(rawValue) || !Number.isFinite(Number(rawValue))) {
    return { ok: false as const, reason: 'bad_value' as const }
  }
  return {
    ok: true as const, title, variable, value: rawValue, memo: blank(input.memo),
    // ★ 変数（0049。C-199）。空は「実績を数えないKPI」。
    //   語が正しいかは呼ぶ側でマスタと突き合わせる（`checkMetric`）。
    metricKey: blank(input.metricKey ?? ''),
  }
}

/** 変数はマスタにある語だけ受ける。無い語は弾く（画面に出していない語は入らない）。 */
const checkMetric = async (db: Db, key: string | null): Promise<boolean> => {
  if (!key) return true
  return Boolean(await maybeOne(db,
    `SELECT key FROM kpi_metrics WHERE key = $1 AND is_active`, [key]))
}

export async function addKpi(db: Db, input: {
  seasonId: string; title: string; variable: string; value: string; memo: string
  metricKey?: string
}): Promise<KpiResult> {
  if (!UUID.test(input.seasonId) || !(await maybeOne(db, `SELECT id FROM seasons WHERE id = $1`, [input.seasonId]))) {
    return { ok: false, reason: 'bad_season' }
  }
  const v = fields(input)
  if (!v.ok) return v
  if (!(await checkMetric(db, v.metricKey))) return { ok: false, reason: 'bad_metric' }
  const id = await scalar<string>(db, `INSERT INTO kpis (season_id) VALUES ($1) RETURNING id`, [input.seasonId])
  await db.query(`INSERT INTO kpi_revisions
                    (kpi_id, revision_no, title, variable, value, memo, metric_key)
                  VALUES ($1, 1, $2, $3, $4::numeric, $5, $6)`,
  [id, v.title, v.variable, v.value, v.memo, v.metricKey])
  return { ok: true, id }
}

export async function reviseKpi(db: Db, input: {
  kpiId: string; seasonId: string; title: string; variable: string; value: string; memo: string
  metricKey?: string
}): Promise<KpiResult> {
  if (!UUID.test(input.kpiId) || !UUID.test(input.seasonId)) return { ok: false, reason: 'bad_kpi' }
  const current = await maybeOne<{ archived_at: Date | null }>(db, `
    SELECT r.archived_at FROM kpis k
    JOIN LATERAL (SELECT archived_at FROM kpi_revisions WHERE kpi_id = k.id
                  ORDER BY revision_no DESC LIMIT 1) r ON true
    WHERE k.id = $1 AND k.season_id = $2`, [input.kpiId, input.seasonId])
  if (!current) return { ok: false, reason: 'bad_kpi' }
  if (current.archived_at) return { ok: false, reason: 'archived' }
  const v = fields(input)
  if (!v.ok) return v
  if (!(await checkMetric(db, v.metricKey))) return { ok: false, reason: 'bad_metric' }
  await db.query(`INSERT INTO kpi_revisions
                    (kpi_id, revision_no, title, variable, value, memo, metric_key)
                  SELECT $1, max(revision_no) + 1, $2, $3, $4::numeric, $5, $6
                    FROM kpi_revisions WHERE kpi_id = $1`,
  [input.kpiId, v.title, v.variable, v.value, v.memo, v.metricKey])
  return { ok: true, id: input.kpiId }
}

export async function archiveKpi(db: Db, kpiId: string, seasonId: string): Promise<KpiResult> {
  if (!UUID.test(kpiId) || !UUID.test(seasonId)) return { ok: false, reason: 'bad_kpi' }
  const id = await maybeOne<{ id: string }>(db, `
    INSERT INTO kpi_revisions
      (kpi_id, revision_no, title, variable, value, memo, metric_key, archived_at)
    SELECT k.id, r.revision_no + 1, r.title, r.variable, r.value, r.memo, r.metric_key, now()
      FROM kpis k
      JOIN LATERAL (SELECT * FROM kpi_revisions WHERE kpi_id = k.id
                    ORDER BY revision_no DESC LIMIT 1) r ON true
     WHERE k.id = $1 AND k.season_id = $2 AND r.archived_at IS NULL
    RETURNING id`, [kpiId, seasonId])
  return id ? { ok: true, id: kpiId } : { ok: false, reason: 'bad_kpi' }
}

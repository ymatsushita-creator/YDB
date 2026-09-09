import { all, maybeOne, type Db } from '../db/client.ts'

/**
 * KPIの変数を、記録から数える（0049。C-199。依頼者の指摘）。
 *
 * 依頼者の言葉 ――「変数ってお前何のことか理解してんの？
 *   それを選択したら、グラフにも反映されるんだぞ？」。
 *
 * ★★ **数え方はここ1箇所だけに置く。** ★★
 *   同じ「応募数」を画面とKPIで別々に数えると、**同じ語で違う数**が出る。
 *   選べる語（`kpi_metrics`）と、その数え方（この表）は1対1で対応させる。
 *
 * ★ 数えられない語は**選ばせない。** マスタに無い語は画面に出ない。
 * ★ 単位を持たせてあるのは、**単位の違う値を割らない**ため（CLAUDE.md）。
 *   達成率は「同じ単位の実績 ÷ 目標」だけで出す。
 */

export interface KpiMetric {
  key: string
  label: string
  definition: string
  unit: string
}

export const listKpiMetrics = (db: Db): Promise<KpiMetric[]> =>
  all<KpiMetric>(db, `
    SELECT key, label, definition, unit FROM kpi_metrics
     WHERE is_active ORDER BY sort_order`)

/**
 * 変数ごとの、その期の実績。
 *
 * ★ SQLは**語ごとに固定文**で持つ。変数名からSQLを組み立てない ――
 *   組み立てると、語が増えたときに知らない場所を数えにいく。
 */
const COUNTERS: Record<string, string> = {
  candidates: `
    SELECT count(*)::int AS n FROM v_candidate_population
     WHERE season_id = $1`,
  applicants: `
    SELECT count(*)::int AS n FROM applications
     WHERE season_id = $1 AND voided_at IS NULL AND deleted_at IS NULL`,
  accepted: `
    SELECT count(*)::int AS n
      FROM v_application_outcome o
      JOIN applications a ON a.id = o.application_id
     WHERE a.season_id = $1 AND o.outcome = 'accepted'`,
  touchpoints: `
    SELECT count(*)::int AS n
      FROM touchpoints t
      JOIN seasons s ON s.id = $1
     WHERE jst_date(t.occurred_at)
           BETWEEN s.outreach_start_date AND s.selection_end_date`,
  // ★ 団体は期をまたぐが、**引数の形は揃える** ――
  //   語ごとに引数の数が違うと、呼ぶ側が語を知らないと呼べなくなる。
  partners: `SELECT count(*)::int AS n FROM partners WHERE $1::uuid IS NOT NULL`,
  special: `
    SELECT count(*)::int AS n FROM v_headhunting_list WHERE season_id = $1`,
  // ★ 確度別（0050。依頼者の指示）。**段階の順で数える** ――
  //   記号を列挙すると、段階が増えたとき黙って取りこぼす。
  confidence_s: `
    SELECT count(*)::int AS n
      FROM v_person_confidence v
      JOIN confidence_grades g ON g.code = v.grade_code
     WHERE v.season_id = $1 AND g.sort_order = 1`,
  confidence_a: `
    SELECT count(*)::int AS n
      FROM v_person_confidence v
      JOIN confidence_grades g ON g.code = v.grade_code
     WHERE v.season_id = $1 AND g.sort_order <= 2`,
  confidence_b: `
    SELECT count(*)::int AS n
      FROM v_person_confidence v
      JOIN confidence_grades g ON g.code = v.grade_code
     WHERE v.season_id = $1 AND g.sort_order <= 3`,
  event_attendees: `
    SELECT count(*)::int AS n
      FROM event_attendances ea
      JOIN appointments a ON a.id = ea.appointment_id
     WHERE a.season_id = $1`,
}

/** その変数の実績。数えられない語なら null（**0 と書かない**）。 */
export async function countKpiMetric(
  db: Db, metricKey: string | null, seasonId: string,
): Promise<number | null> {
  if (!metricKey) return null
  const sql = COUNTERS[metricKey]
  if (!sql) return null
  const row = await maybeOne<{ n: number }>(db, sql, [seasonId])
  return row ? Number(row.n) : null
}

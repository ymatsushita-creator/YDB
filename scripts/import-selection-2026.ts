import { intakePath } from './intake-dir.ts'
import { openPostgres } from '../src/db/postgres.ts'
import { Workbook } from '../src/import/xlsx.ts'
import {
  planCriterionDetails, planStepDetails, planRequirements,
} from '../src/import/selection_2026.ts'
import type { Db } from '../src/db/client.ts'

/**
 * 評価軸・選考の段・募集要項の説明を本番へ入れる（依頼者の指示。実行⑯。C-160）。
 *
 *   pnpm import:selection            突き合わせだけ（既定。**書かない**）
 *   pnpm import:selection --apply    実際に入れる
 *
 * ★ 個人情報を一切扱わない取り込みである（軸と条文だけ）。
 * ★ **入っている説明を上書きしない。** 空のところだけ埋める ――
 *   運営が画面から直した文を、表の古い文で潰さない。
 * ★ 軸は**名前で突き合わせる。** 表の記号（A〜I）は DB に無い。
 * ★ 期は両方に入れる ―― 2期と3期は同じ軸・同じ段を持つ（0006）。
 */

const XLSX = intakePath('2期応募管理.xlsx')
const apply = process.argv.includes('--apply')

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL が無い。`.env.local` を読める形で実行する。')
  process.exit(1)
}
console.log(`書き込み先: ${/@([^/:]+)/.exec(url)?.[1] ?? '(不明)'}`
  + `${apply ? '  ★ --apply（実際に書く）' : '  （既定：書かない）'}\n`)

const book = new Workbook(XLSX)
const criteria = planCriterionDetails(book)
const steps = planStepDetails(book)
const requirements = planRequirements(book)

console.log(`評価軸の説明   ${criteria.length} 本`)
for (const c of criteria) {
  console.log(`  ${c.mark}. ${c.name.slice(0, 26).padEnd(26)} ${c.description.split('\n').length} 行`)
}
console.log(`\n段の説明       ${steps.length} 段`)
for (const s of steps) console.log(`  ${s.name.padEnd(10)} ${s.description.split('\n').length} 行`)
console.log(`\n募集要項       ${requirements.length} 条`)
for (const r of requirements) console.log(`  [${r.category}] ${r.body.slice(0, 44)}`)
console.log('')

const db: Db = await openPostgres(url)
const all = async <T>(sql: string, p?: unknown[]) => (await db.query<T>(sql, p)).rows

if (!apply) {
  // 何本が実際に当たるかを、書かずに数える。
  const names = await all<{ name: string; filled: boolean }>(
    `SELECT name, description IS NOT NULL AS filled FROM evaluation_criteria`)
  const hit = criteria.filter((c) => names.some((n) => n.name === c.name))
  console.log(`DB の軸と名前が一致  ${hit.length} / ${criteria.length}`)
  console.log(`  （DB 側の軸は ${names.length} 本、うち説明あり ${names.filter((n) => n.filled).length} 本）`)
  const stepRows = await all<{ name: string }>(`SELECT DISTINCT name FROM selection_steps`)
  console.log(`DB の段と名前が一致  `
    + `${steps.filter((s) => stepRows.some((r) => r.name === s.name)).length} / ${steps.length}`)
  console.log('\n書いていない。入れるなら --apply を付ける。')
  await db.close()
  process.exit(0)
}

await db.exec('BEGIN')

let axes = 0
for (const c of criteria) {
  const r = await db.query(`
    UPDATE evaluation_criteria SET description = $2
     WHERE name = $1 AND description IS NULL RETURNING id`, [c.name, c.description])
  axes += r.rows.length
}

let stepsFilled = 0
for (const s of steps) {
  const r = await db.query(`
    UPDATE selection_steps SET description = $2
     WHERE name = $1 AND description IS NULL RETURNING id`, [s.name, s.description])
  stepsFilled += r.rows.length
}

// 募集要項は**両方の期**へ。2期の要項をそのまま3期の初期値にする
// （依頼者「選考基準や募集要項…変わらないので引き継げ」。C-152 と同じ扱い）。
let reqs = 0
const seasons = await all<{ id: string }>(
  `SELECT id FROM seasons WHERE NOT is_demo ORDER BY enrollment_year`)
for (const s of seasons) {
  for (const r of requirements) {
    const done = await db.query(`
      INSERT INTO season_requirements (season_id, category, body, sort_order)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (season_id, category, body) DO NOTHING
      RETURNING id`, [s.id, r.category, r.body, r.sortOrder])
    reqs += done.rows.length
  }
}

await db.exec('COMMIT')

console.log('入れた ――')
console.log(`  評価軸の説明  ${axes} 本（既に入っている説明は上書きしていない）`)
console.log(`  段の説明      ${stepsFilled} 段`)
console.log(`  募集要項      ${reqs} 条（${seasons.length} 期ぶん）`)

await db.close()

import { intakePath } from './intake-dir.ts'
import { join } from 'node:path'
import { openPostgres } from '../src/db/postgres.ts'
import { Workbook } from '../src/import/xlsx.ts'
import { planPartners } from '../src/import/partners_2026.ts'
import type { Db } from '../src/db/client.ts'

/**
 * 提携団体リストを本番へ取り込む（依頼者の指示。実行⑯。C-153）。
 *
 *   pnpm import:partners            突き合わせだけ（既定。**書かない**）
 *   pnpm import:partners --apply    実際に入れる
 *
 * ★ 既定は書かない（取り込み道具の作法。C-61）。
 * ★ 出力に団体名・担当者名・メールを出さない。**件数と行番号だけ。**
 * ★ 書き込み先を毎回名乗る（C-28 / C-74）。
 * ★ 冪等。団体は名前で重ねない。推薦枠ステイタスは、同じ状態が既に
 *   現在値なら積まない（積むと「同じ状態に何度もなった」ことになる）。
 */

const XLSX = intakePath('2期応募管理.xlsx')
const apply = process.argv.includes('--apply')

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL が無い。`.env.local` を読める形で実行する。')
  process.exit(1)
}
const host = /@([^/:]+)/.exec(url)?.[1] ?? '(不明)'
console.log(`書き込み先: ${host}${apply ? '  ★ --apply（実際に書く）' : '  （既定：書かない）'}\n`)

const plan = planPartners(new Workbook(XLSX))

console.log(`提携団体  ${plan.partners.length} 団体（団体名が空・重複で入れない行 ${plan.skipped}）`)
console.log(`  推薦枠ステイタスあり  ${plan.partners.filter((p) => p.statusCode).length} 件`)
const unmapped = plan.partners.filter((p) => p.unmappedStatus)
if (unmapped.length > 0) {
  console.log(`  ★ 対応させられない状態語  ${unmapped.length} 件`
    + `（行 ${unmapped.slice(0, 8).map((p) => p.row).join(',')}）`)
}
console.log(`  担当者あり ${plan.partners.filter((p) => p.contactName).length}`
  + ` / メールあり ${plan.partners.filter((p) => p.contactEmail).length}`
  + ` / 提携期日あり ${plan.partners.filter((p) => p.firstContactDate).length}`)
console.log('\n★ 表にあって、この製品に置き場所が無い値（入れない）')
for (const u of plan.unplaced) console.log(`  ${u.label.padEnd(22)} ${u.rows} 行`)
console.log('')

const db: Db = await openPostgres(url)
const one = async <T>(sql: string, params?: unknown[]): Promise<T | null> =>
  ((await db.query<T>(sql, params)).rows[0] ?? null)

const existing = new Map((await db.query<{ id: string; name: string }>(
  `SELECT id, name FROM partners`)).rows.map((r) => [r.name, r.id]))
const already = plan.partners.filter((p) => existing.has(p.name)).length

console.log(`本番に既に居る団体  ${existing.size}（うち表と一致 ${already}）`)
console.log(`新しく作る団体      ${plan.partners.length - already}\n`)

if (!apply) {
  console.log('書いていない。入れるなら --apply を付ける。')
  await db.close()
  process.exit(0)
}

// 推薦枠ステイタスは**2期の事実**として入れる。3期へは写さない（C-153）。
const season2 = await one<{ id: string }>(
  `SELECT id FROM seasons WHERE cohort_number = 2 AND NOT is_demo`)
if (!season2) throw new Error('2期が無い')
const staff = await one<{ id: string }>(
  `SELECT id FROM staffs ORDER BY created_at, id LIMIT 1`)
if (!staff) throw new Error('職員が1人も居ない。記録の名乗りが立たないので入れない')
const states = new Map((await db.query<{ code: string; id: string }>(
  `SELECT code, id FROM partner_recommendation_states`)).rows.map((r) => [r.code, r.id]))

await db.exec('BEGIN')
let created = 0
let filled = 0
let statuses = 0

for (const p of plan.partners) {
  let id = existing.get(p.name)
  if (!id) {
    id = (await one<{ id: string }>(`
      INSERT INTO partners (name, category, contact_name, contact_email, first_contact_date)
      VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [p.name, p.category, p.contactName, p.contactEmail, p.firstContactDate]))!.id
    existing.set(p.name, id)
    created++
  } else {
    // 既にある団体は**空いている欄だけ埋める。** 入っている値を上書きしない
    //（本番で運営が直した値を、表の古い値で潰さない）。
    const r = await one<{ n: number }>(`
      UPDATE partners SET
        category           = coalesce(category, $2),
        contact_name       = coalesce(contact_name, $3),
        contact_email      = coalesce(contact_email, $4),
        first_contact_date = coalesce(first_contact_date, $5)
      WHERE id = $1
        AND (category IS NULL OR contact_name IS NULL
             OR contact_email IS NULL OR first_contact_date IS NULL)
      RETURNING 1 AS n`, [id, p.category, p.contactName, p.contactEmail, p.firstContactDate])
    if (r) filled++
  }

  if (!p.statusCode) continue
  const stateId = states.get(p.statusCode)
  if (!stateId) continue
  // 同じ状態が既に現在値なら積まない（冪等）。
  const current = await one<{ state_code: string }>(`
    SELECT state_code FROM v_partner_recommendation_state
     WHERE partner_id = $1 AND season_id = $2`, [id, season2.id])
  if (current?.state_code === p.statusCode) continue
  await db.query(`
    INSERT INTO partner_recommendation_events
      (partner_id, season_id, state_id, occurred_at, recorded_by_staff_id, note)
    VALUES ($1, $2, $3, now(), $4, $5)`,
  [id, season2.id, stateId, staff.id, '提携団体リストから取り込んだ'])
  statuses++
}

await db.exec('COMMIT')

console.log('入れた ――')
console.log(`  団体          ${created} 件（新規）`)
console.log(`  空欄を埋めた   ${filled} 件（入っている値は上書きしていない）`)
console.log(`  推薦枠ステイタス ${statuses} 件（2期の事実として。3期へは写さない）`)
console.log('★ 団体は期を持たない。入れた時点で3期からも同じ団体が見える。')

await db.close()

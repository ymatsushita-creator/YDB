import { join } from 'node:path'
import { openPostgres } from '../src/db/postgres.ts'
import { Workbook } from '../src/import/xlsx.ts'
import { EVENT_SHEET, planEvents } from '../src/import/events_2026.ts'

/**
 * 2期のイベントを `4月イベント一覧` から本番へ入れる。
 * 既定は照合だけ。氏名・イベント名はログへ出さない。
 */
const apply = process.argv.includes('--apply')
const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL が無い')
console.log(`書き込み先: ${/@([^/:]+)/.exec(url)?.[1] ?? '(不明)'}`
  + `${apply ? '  ★ --apply（実際に書く）' : '  （既定：書かない）'}\n`)

const book = new Workbook(join(process.cwd(), '2期応募管理2.xlsx'))
const plan = planEvents(book.rows(EVENT_SHEET), 2026)
const db = await openPostgres(url)
const season = (await db.query<{ id: string }>(
  `SELECT id FROM seasons WHERE cohort_number = 2 AND NOT is_demo`)).rows[0]
if (!season) throw new Error('2期が無い')
const staffs = (await db.query<{ id: string; display_name: string }>(
  `SELECT id, display_name FROM staffs WHERE is_active`)).rows
const ownerOf = (raw: string) => {
  const exact = staffs.find((s) => raw.trim() === s.display_name)
  if (exact) return exact
  const hits = staffs.filter((s) => raw.includes(s.display_name))
  return hits.length === 1 ? hits[0] : null
}

const expanded = plan.ready.flatMap((e) => e.days.map((day) => ({ ...e, day })))
console.log(`原本で日時がそろう    ${expanded.length} 件`)
console.log(`対応者まで一致する    ${expanded.filter((e) => ownerOf(e.owner)).length} 件`)
console.log(`日時が足りず入れない  ${plan.incomplete.length} 行`)
console.log(`対応者が原本にない    ${expanded.filter((e) => !ownerOf(e.owner)).length} 件（未記録で入れる）`)

if (!apply) {
  console.log('\n書いていない。入れるなら --apply を付ける。')
  await db.close()
  process.exit(0)
}

await db.exec('BEGIN')
let inserted = 0
let existing = 0
try {
  const kind = (await db.query<{ id: string }>(
    `SELECT id FROM appointment_kinds WHERE code = 'event' AND is_active`)).rows[0]
  if (!kind) throw new Error('イベント種別が無い')
  for (const e of expanded) {
    const owner = ownerOf(e.owner)
    const starts = `${e.day}T${e.startsAt}:00+09:00`
    const ends = `${e.day}T${e.endsAt}:00+09:00`
    const found = (await db.query(`
      SELECT 1 FROM appointments a
       JOIN appointment_kinds k ON k.id = a.kind_id AND k.code = 'event'
      WHERE a.season_id = $1 AND a.title = $2
        AND a.starts_at = $3::timestamptz AND a.ends_at = $4::timestamptz
        AND a.cancelled_at IS NULL`, [season.id, e.title, starts, ends])).rows[0]
    if (found) { existing++; continue }
    const detail = [e.place ? `場所: ${e.place}` : null,
      e.url ? `URL: ${e.url}` : null, e.note ? `備考: ${e.note}` : null,
      `2期応募管理2.xlsx「${EVENT_SHEET}」${e.row}行から取り込み`]
      .filter(Boolean).join('\n')
    await db.query(`
      INSERT INTO appointments
        (season_id, kind_id, title, starts_at, ends_at, owner_staff_id, note)
      VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7)`,
    [season.id, kind.id, e.title, starts, ends, owner?.id ?? null, detail])
    inserted++
  }
  await db.exec('COMMIT')
} catch (error) {
  await db.exec('ROLLBACK')
  throw error
}

console.log(`\n入れたイベント ${inserted} 件（既にあった ${existing} 件）`)
await db.close()

import { readFileSync } from 'node:fs'
import { basename, extname, resolve } from 'node:path'
import { openPostgres } from '../src/db/postgres.ts'
import { Workbook } from '../src/import/xlsx.ts'
import { parseCsv } from '../src/import/csv.ts'
import { planIngest, type ColumnPlan, type TargetField } from '../src/ai/ingest_plan.ts'
import { addCandidate } from '../src/commands/intake.ts'
import { maybeOne } from '../src/db/client.ts'

/**
 * エクセル／CSV を入れると、DBへ反映する（依頼者の指示。実行⑯。C-164）。
 *
 *   pnpm ingest <ファイル> [シート名] --season 2027 --school <名> --channel <名> --staff <名>
 *                                     突き合わせだけ（既定。**書かない**）
 *   pnpm ingest ... --apply           実際に入れる
 *
 * ★ 既定は書かない（C-61）。まずAIの割り当てを画面に出す。
 * ★ 出力に氏名・メール・電話を出さない。**件数と行番号と見出し語だけ**（C-88）。
 * ★ 期・学校・接点・担当は**人が引数で渡す。** AIには選ばせない ――
 *   取り違えると、その人の記録がまるごと別の期に入る。
 * ★ 書き込み先を毎回名乗る（C-28 / C-74）。
 */

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const opt = (name: string): string | null => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? (args[i + 1] ?? null) : null
}
const positional = args.filter((a, i) =>
  !a.startsWith('--') && !(i > 0 && args[i - 1]!.startsWith('--')))

const file = positional[0]
if (!file) {
  console.error('使い方: pnpm ingest <ファイル> [シート名] --season <年> --school <名> --channel <名> --staff <名> [--apply]')
  process.exit(1)
}

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL が無い。`.env.local` を読める形で実行する。')
  process.exit(1)
}
const host = /@([^/:]+)/.exec(url)?.[1] ?? '(不明)'
console.log(`書き込み先: ${host}${apply ? '  ★ --apply（実際に書く）' : '  （既定：書かない）'}\n`)

/** 表を読む。xlsx と csv のどちらでも、行の配列にして先へ渡す。 */
function rowsOf(path: string, sheet: string | undefined): { label: string; rows: string[][] } {
  const ext = extname(path).toLowerCase()
  if (ext === '.csv') {
    return { label: basename(path), rows: parseCsv(readFileSync(path, 'utf8')) }
  }
  const book = new Workbook(path)
  const name = sheet ?? [...book.sheets.keys()][0]
  if (!name) throw new Error('シートが1枚も無い')
  return { label: `${basename(path)} / ${name}`, rows: book.rows(name) }
}

const { label, rows } = rowsOf(resolve(file), positional[1])
// 見出し行は「空でない最初の行」。位置で決めると、上に説明書きがある表で崩れる。
const headerAt = rows.findIndex((r) => r.some((c) => (c ?? '').trim() !== ''))
if (headerAt < 0) { console.error('中身のある行が無い'); process.exit(1) }
const headers = (rows[headerAt] ?? []).map((h) => (h ?? '').trim())

console.log(`表: ${label}`)
console.log(`見出し行: ${headerAt + 1}行目（${headers.length}列） / データ: ${rows.length - headerAt - 1}行\n`)

const plan: ColumnPlan[] = await planIngest({ label, headers })

console.log('― AIが作った割り当て ―')
for (const c of plan) {
  const to = c.target ?? '（取り込まない）'
  console.log(`  ${String(c.index).padStart(2)}: ${c.header || '(空)'} → ${to}    ${c.reason}`)
}
const mapped = plan.filter((c) => c.target !== null)
console.log(`\n割り当てられた列: ${mapped.length} / ${headers.length}`)

if (!mapped.some((c) => c.target === 'familyName')) {
  console.error('\n姓に当たる列が無い。この表は候補者名簿ではないか、見出しが違う。')
  process.exit(1)
}

if (!apply) {
  console.log('\n（既定：書いていない。この割り当てでよければ --apply を付けて実行する）')
  process.exit(0)
}

// ―― ここから書く ――
const seasonYear = opt('season')
const schoolName = opt('school')
const channelName = opt('channel')
const staffName = opt('staff')
if (!seasonYear || !schoolName || !channelName || !staffName) {
  console.error('--season / --school / --channel / --staff は必須（AIには選ばせない）')
  process.exit(1)
}

const db = await openPostgres(url)
const season = await maybeOne<{ id: string }>(db,
  `SELECT id FROM seasons WHERE enrollment_year = $1 AND NOT is_demo`, [Number(seasonYear)])
const school = await maybeOne<{ id: string }>(db,
  `SELECT id FROM schools WHERE name = $1`, [schoolName])
const channel = await maybeOne<{ id: string }>(db,
  `SELECT id FROM channels WHERE name = $1`, [channelName])
const staff = await maybeOne<{ id: string }>(db,
  `SELECT id FROM staffs WHERE name = $1`, [staffName])
for (const [what, row] of [['期', season], ['学校', school], ['接点', channel], ['担当', staff]] as const) {
  if (!row) { console.error(`${what}が見つからない`); process.exit(1) }
}

const pick = (row: string[], t: TargetField): string => {
  const c = plan.find((p) => p.target === t)
  return c ? (row[c.index] ?? '').trim() : ''
}

let saved = 0
const failures = new Map<string, number[]>()
for (let i = headerAt + 1; i < rows.length; i += 1) {
  const row = rows[i] ?? []
  if (!row.some((c) => (c ?? '').trim() !== '')) continue
  const r = await addCandidate(db, {
    seasonId: season!.id, schoolId: school!.id,
    channelId: channel!.id, staffId: staff!.id,
    familyName: pick(row, 'familyName'), givenName: pick(row, 'givenName'),
    familyNameKana: pick(row, 'familyNameKana'), givenNameKana: pick(row, 'givenNameKana'),
    birthDate: pick(row, 'birthDate'), faculty: pick(row, 'faculty'),
    email: pick(row, 'email'), phone: pick(row, 'phone'),
    lineUserId: pick(row, 'lineUserId'), note: pick(row, 'note'),
    contactedOn: '', formResponseId: '',
  })
  if (r.ok) saved += 1
  else {
    // ★ 氏名は出さない。**行番号だけ**を出す。
    const at = failures.get(r.reason) ?? []
    at.push(i + 1)
    failures.set(r.reason, at)
  }
}

console.log(`\n入れた: ${saved}件`)
for (const [reason, at] of failures) {
  console.log(`  入らなかった（${reason}）: ${at.length}件  行 ${at.slice(0, 20).join(', ')}${at.length > 20 ? ' …' : ''}`)
}
await db.close()

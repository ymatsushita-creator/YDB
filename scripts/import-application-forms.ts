import { intakePath } from './intake-dir.ts'
import { join } from 'node:path'
import { openPostgres } from '../src/db/postgres.ts'
import { Workbook } from '../src/import/xlsx.ts'
import {
  planFormAnswers, composeBodies, involvementFor, FORM_INVOLVEMENT,
} from '../src/import/application_form_2026.ts'
import { nameKey, IMPORT_ACTOR } from '../src/import/approach_2026.ts'
import type { Db } from '../src/db/client.ts'

/**
 * 2期生の応募フォーム回答を本番へ取り込む（依頼者の指示。実行⑯。C-156）。
 *
 *   pnpm import:forms            突き合わせだけ（既定。**書かない**）
 *   pnpm import:forms --apply    実際に入れる
 *
 * ★ 出力に氏名・メール・回答本文を出さない。**件数と行番号だけ。**
 * ★ 書き込み先を毎回名乗る。
 * ★ 冪等。同じ人に同じ札のメモが既にあれば飛ばす。
 * ★ 表に居て新DBに居ない人は**作らない。** 応募フォームは氏名しか鍵が無く、
 *   ここで人を起こすと、アプローチリスト側の同一人物と二重になる
 *   （突き合わせの鍵は C-74 で氏名の完全一致だけと決めてある）。
 *   入らなかった件数を出すので、必要なら人を先に足してから流し直す。
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

const answers = planFormAnswers(new Workbook(XLSX))
const bySheet = new Map<string, number>()
for (const a of answers) bySheet.set(a.sheet, (bySheet.get(a.sheet) ?? 0) + 1)

console.log(`応募フォームの回答  ${answers.length} 件`)
for (const [sheet, n] of bySheet) console.log(`  ${sheet.padEnd(34)} ${n} 件`)
const pages = answers.map((a) => composeBodies(a).length)
console.log(`  メモの枚数  ${pages.reduce((s, n) => s + n, 0)} 枚`
  + `（1件が2枚以上になるもの ${pages.filter((n) => n > 1).length} 件）\n`)

const db: Db = await openPostgres(url)

const people = new Map((await db.query<{ id: string; name: string }>(`
  SELECT id, family_name || given_name AS name FROM persons WHERE deleted_at IS NULL`))
  .rows.map((r) => [nameKey(r.name), r.id]))

// 同じ人に同じ回答が2枚の表から来ることがある（本表とそのコピー）。
// **先に出たほうを採る**（あとから上書きすると、どちらが正か決まらない）。
const seen = new Set<string>()
const matched: typeof answers = []
const unmatched: typeof answers = []
const duplicated: typeof answers = []
for (const a of answers) {
  const key = nameKey(a.fullName)
  if (!people.has(key)) { unmatched.push(a); continue }
  if (seen.has(key)) { duplicated.push(a); continue }
  seen.add(key)
  matched.push(a)
}

console.log(`新DBの人と一致    ${matched.length} 件`)
console.log(`同じ人の2件目     ${duplicated.length} 件（入れない。行 `
  + `${duplicated.slice(0, 10).map((a) => a.row).join(',')}）`)
console.log(`新DBに居ない人    ${unmatched.length} 件（**人は作らない**。行 `
  + `${unmatched.slice(0, 10).map((a) => a.row).join(',')}）\n`)

if (!apply) {
  console.log('書いていない。入れるなら --apply を付ける。')
  await db.close()
  process.exit(0)
}

await db.exec('BEGIN')
let written = 0
let skipped = 0

for (const a of matched) {
  const personId = people.get(nameKey(a.fullName))!
  const bodies = composeBodies(a)
  for (const [i, body] of bodies.entries()) {
    const involvement = involvementFor(i, bodies.length)
    const exists = (await db.query(`
      SELECT 1 FROM person_notes WHERE person_id = $1 AND involvement = $2`,
    [personId, involvement])).rows[0]
    if (exists) { skipped++; continue }
    await db.query(`
      INSERT INTO person_notes (person_id, author_name, noted_at, body, involvement)
      VALUES ($1, $2, now(), $3, $4)`,
    [personId, IMPORT_ACTOR, body, involvement])
    written++
  }
}

await db.exec('COMMIT')

console.log('入れた ――')
console.log(`  メモ  ${written} 枚（既にあって飛ばした ${skipped} 枚）`)
console.log(`★ 人の画面のメモに「${FORM_INVOLVEMENT}」の札で出る。`)

await db.close()

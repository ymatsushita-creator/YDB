import pg from 'pg'
import { saveSnapshot } from './backup-file.ts'
import { actorName } from '../src/db/postgres.ts'
import { countDemoRows, removeDemoRows } from '../src/db/demo_removal.ts'
import type { Db, QueryResult } from '../src/db/client.ts'

/**
 * 幻のデモ期と架空の人を、本番から取り除く（依頼者の指示。実行⑯）。
 *
 *   pnpm demo:remove            数えるだけ（既定。**書かない**）
 *   pnpm demo:remove --apply    実際に消す
 *
 * ★ **既定は書かない**（取り込み道具と同じ作法。C-61）。
 *
 * ★ **書き込み先を毎回名乗る。** 接続文字列そのものは出さない（C-28 / C-74）。
 *
 * ★ **`--apply` は消す前に自分で控えを取る**（`db:migrate:production` と同じ。C-121）。
 *   取れなければ消さない。戻せない操作の前に、戻す道を先に作る。
 *
 * ★ **プールを使わない。** `openPostgres` のプールは接続を3本持つので、
 *   BEGIN と DELETE が別の接続へ散る。取引を1本の接続に閉じるため、
 *   ここでは素の Client を直に開く。
 */

const apply = process.argv.includes('--apply')

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL が無い。`.env.local` を読める形で実行する。')
  process.exit(1)
}

const target = new URL(url)
console.log(`書き込み先 ―― ${target.hostname} / ${target.pathname.slice(1)}`
  + (apply ? '  ★ --apply（実際に消す）' : '  （既定：数えるだけ）'))
console.log('')

const client = new pg.Client({
  connectionString: url,
  ssl: url.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
  options: '-c TimeZone=Asia/Tokyo',
  application_name: actorName(),
})
await client.connect()

const db: Db = {
  async query<T>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const res = await client.query(sql, params)
    return { rows: res.rows as T[] }
  },
  async exec(sql: string): Promise<void> { await client.query(sql) },
  async close(): Promise<void> { await client.end() },
}

const counted = await countDemoRows(db)
const total = counted.reduce((n, r) => n + r.rows, 0)

console.log('デモの印が付いている行')
for (const r of counted) if (r.rows > 0) console.log(`  ${r.table.padEnd(30)} ${r.rows}`)
console.log(`  ${'合計'.padEnd(30)} ${total}`)
console.log('')

if (total === 0) {
  console.log('消すものが無い。デモデータは既に落ちている。')
  await db.close()
  process.exit(0)
}

if (!apply) {
  console.log('消していない。消すなら --apply を付ける。')
  await db.close()
  process.exit(0)
}

// 消す前に控えを取る。取れなければ消さない。
console.log('控えを取る（消す前）…')
const saved = await saveSnapshot(db, target.hostname, target.pathname.slice(1))
console.log(`  表 ${saved.tables} ・ 行 ${saved.rows} → ${saved.dir}/`)
console.log('')

const { deleted, before, after } = await removeDemoRows(db)

console.log('消した行')
for (const r of deleted) if (r.rows > 0) console.log(`  ${r.table.padEnd(30)} ${r.rows}`)
console.log(`  ${'合計'.padEnd(30)} ${deleted.reduce((n, r) => n + r.rows, 0)}`)
console.log('')
console.log('実在の側（消す前 → 消した後。動いていないこと）')
for (const k of Object.keys(before)) console.log(`  ${k.padEnd(30)} ${before[k]} → ${after[k]}`)

await db.close()

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { openPostgres } from '../src/db/postgres.ts'
import { dump } from '../src/db/backup.ts'

/**
 * 本番（マネージド Postgres）の中身を1つ取る。
 *
 * ★ **読むだけ。** 何も書かない・消さない。
 * ★ 置き場所は `db/private/backups/`（gitignore 済み）。
 *   **両リモートは公開である。** 実在の候補者の氏名と評価が入るので、
 *   追跡される場所へは絶対に置かない。
 * ★ 書き込み先ではなく**読み取り先を名乗る**（取り違えを防ぐ。C-28 と同じ作法）。
 *
 *   pnpm db:backup
 */

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL が未設定。取る相手が無い。')
  process.exit(1)
}

const url = new URL(process.env.DATABASE_URL)
// ★ 接続文字列そのものは出力しない。名乗るのは host と db だけ。
console.log(`読み取り先 ―― ${url.hostname} / ${url.pathname.slice(1)}`)

const db = await openPostgres(process.env.DATABASE_URL)
const t0 = performance.now()
const snapshot = await dump(db)
await db.close()

const stamp = snapshot.takenAt.replace(/[:.]/g, '-')
const dir = join(process.cwd(), 'db', 'private', 'backups', stamp)
await mkdir(dir, { recursive: true })
await writeFile(join(dir, 'dump.json'), JSON.stringify(snapshot), 'utf8')

const counts = snapshot.tables
  .map((t) => ({ table: t.table, rows: t.rows.length }))
  .filter((t) => t.rows > 0)
  .sort((a, b) => b.rows - a.rows)

await writeFile(join(dir, 'manifest.json'), `${JSON.stringify({
  takenAt: snapshot.takenAt,
  host: url.hostname,
  database: url.pathname.slice(1),
  tables: snapshot.tables.length,
  rows: counts,
}, null, 2)}\n`, 'utf8')

console.log(`表 ${snapshot.tables.length} ・ 行 ${counts.reduce((n, c) => n + c.rows, 0)}`)
for (const c of counts.slice(0, 12)) console.log(`  ${c.table} ${c.rows}`)
console.log(`db/private/backups/${stamp}/ に置いた（${Math.round(performance.now() - t0)}ms）`)
console.log('★ 取れたことは、戻せることの証明ではない。戻し方は docs/pilot/BACKUP.md。')

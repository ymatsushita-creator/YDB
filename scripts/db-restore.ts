import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import { openPostgres } from '../src/db/postgres.ts'
import { dump, restore, verify, type Dump } from '../src/db/backup.ts'

/**
 * 取ったものを戻す。
 *
 * ★★ **これは全部を置き換える操作である。** 戻すこと自体が事故になりうるので、
 *   3つの装置を付ける ――
 *
 *   1. 相手を名乗る（host と db を出す）
 *   2. `--yes` が無ければ**何もせず終わる**（下見だけ）
 *   3. 戻す前に、**いまの状態を必ず取る**（戻す操作を戻せるようにする）
 *
 *   pnpm db:restore db/private/backups/<いつ>          下見（書かない）
 *   pnpm db:restore db/private/backups/<いつ> --yes    実行
 */

const args = process.argv.slice(2)
const target = args.find((a) => !a.startsWith('--'))
const go = args.includes('--yes')

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL が未設定。戻す相手が無い。')
  process.exit(1)
}
if (!target) {
  console.error('戻すものを指定する ―― pnpm db:restore db/private/backups/<いつ> [--yes]')
  process.exit(1)
}

const dir = isAbsolute(target) ? target : join(process.cwd(), target)
const snapshot = JSON.parse(await readFile(join(dir, 'dump.json'), 'utf8')) as Dump

const url = new URL(process.env.DATABASE_URL)
console.log(`戻す先 ―― ${url.hostname} / ${url.pathname.slice(1)}`)
console.log(`戻すもの ―― ${snapshot.takenAt}（表 ${snapshot.tables.length}）`)

const db = await openPostgres(process.env.DATABASE_URL)

// いま何が入っているか。**置き換わる中身を、置き換える前に見せる。**
const now = await verify(db, snapshot)
console.log('\n  表                        いま →  戻したあと')
for (const v of now) {
  if (v.actual === 0 && v.expected === 0) continue
  console.log(`  ${v.table.padEnd(26)}${String(v.actual).padStart(5)} → ${String(v.expected).padStart(7)}`)
}

if (!go) {
  await db.close()
  console.log('\n下見だけで終わった。実行するなら --yes を付ける。')
  process.exit(0)
}

// ★ 戻す前に、いまの状態を取る。**戻す操作を戻せるようにする。**
console.log('\n戻す前に、いまの状態を取る ――')
const safety = await dump(db)
const stamp = `before-restore-${safety.takenAt.replace(/[:.]/g, '-')}`
const safetyDir = join(process.cwd(), 'db', 'private', 'backups', stamp)
await mkdir(safetyDir, { recursive: true })
await writeFile(join(safetyDir, 'dump.json'), JSON.stringify(safety), 'utf8')
console.log(`  db/private/backups/${stamp}/`)

const t0 = performance.now()
await restore(db, snapshot)
const diffs = (await verify(db, snapshot)).filter((v) => v.expected !== v.actual)
await db.close()

if (diffs.length > 0) {
  console.error('\n★ 戻したのに件数が合わない表がある ――')
  for (const d of diffs) console.error(`  ${d.table} 期待 ${d.expected} / 実際 ${d.actual}`)
  process.exit(1)
}
console.log(`\n戻した。全表で件数が一致（${Math.round(performance.now() - t0)}ms）`)

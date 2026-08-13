import { openPostgres } from '../src/db/postgres.ts'
import { saveSnapshot } from './backup-file.ts'

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
 *
 * 置き場所を作る仕事は scripts/backup-file.ts が持つ。
 * `db:migrate:production` が**書き込む前に自分で控えを取る**ため、
 * 同じ処理を2箇所に書かない（C-121）。
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
const saved = await saveSnapshot(db, url.hostname, url.pathname.slice(1))
await db.close()

console.log(`表 ${saved.tables} ・ 行 ${saved.rows}`)
console.log(`${saved.dir}/ に置いた（${Math.round(performance.now() - t0)}ms）`)
console.log('★ 取れたことは、戻せることの証明ではない。戻し方は docs/pilot/BACKUP.md。')

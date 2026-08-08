import { openPostgres } from '../src/db/postgres.ts'
import { migrate, seed } from '../src/db/migrate.ts'

/**
 * 本番（マネージド Postgres）へマイグレーションと参照データを適用する。
 *
 * db:reset とは違い、**何も消さない。**
 * migrate() は適用済みのマイグレーションをチェックサムで確認してスキップし、
 * seed() は何度でも流し直せる設計（src/db/migrate.ts のコメント）。
 * includeExamples は渡さない（既定 false）―― 本番にサンプルは絶対に入れない（C-28）。
 */

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL が未設定。適用対象の本番接続が無い。')
  process.exit(1)
}

const db = await openPostgres(process.env.DATABASE_URL)
const t0 = performance.now()

const applied = await migrate(db, { verbose: true })
console.log(`migrations applied: ${applied.length}`)

const seeded = await seed(db, { verbose: true })
console.log(`seeds applied: ${seeded.length}`)

console.log(`done in ${Math.round(performance.now() - t0)}ms`)
await db.close()

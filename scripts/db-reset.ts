import { rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { openPglite } from '../src/db/pglite.ts'
import { migrate, seed } from '../src/db/migrate.ts'
import { seedDemo } from '../src/seed/demo.ts'

/**
 * 開発用データベースを作り直す。
 *
 * PGlite の永続ディレクトリ .pgdata/ を消してから作り直すため、
 * 実行するたびに同じ状態になる。デモデータの乱数も固定シード。
 *
 * --no-demo でデモデータを省略できる（参照データのみ）。
 */

const DATA_DIR = fileURLToPath(new URL('../.pgdata/', import.meta.url))
const withDemo = !process.argv.includes('--no-demo')

await rm(DATA_DIR, { recursive: true, force: true })

const t0 = performance.now()
const db = await openPglite(DATA_DIR)

const applied = await migrate(db, { verbose: true })
console.log(`migrations: ${applied.length}`)

await seed(db, { verbose: true })

if (withDemo) {
  const stats = await seedDemo(db)
  console.log('demo data:')
  for (const [k, v] of Object.entries(stats)) console.log(`  ${k.padEnd(13)} ${v}`)
}

// 生成した内容を一目で確かめる。数字がおかしければここで気づける。
const { rows } = await db.query<Record<string, string>>(`
  SELECT se.enrollment_year AS year,
         se.capacity,
         (SELECT count(*) FROM v_application_state a WHERE a.season_id = se.id) AS applicants,
         (SELECT count(*) FROM v_application_state a WHERE a.season_id = se.id AND a.is_accepted) AS accepted,
         (SELECT count(*) FROM v_application_state a WHERE a.season_id = se.id AND a.is_withdrawn) AS withdrawn,
         (SELECT count(*) FROM evaluations e
            JOIN applications ap ON ap.id = e.application_id
           WHERE ap.season_id = se.id AND e.state = 'pending') AS pending_evals
    FROM seasons se ORDER BY se.enrollment_year`)

console.log('\n year  capacity  applicants  accepted  withdrawn  pending')
for (const r of rows) {
  console.log(
    `  ${r.year}  ${String(r.capacity).padStart(8)}  ${String(r.applicants).padStart(10)}` +
    `  ${String(r.accepted).padStart(8)}  ${String(r.withdrawn).padStart(9)}  ${String(r.pending_evals).padStart(7)}`,
  )
}

console.log(`\nready in ${Math.round(performance.now() - t0)}ms -> .pgdata/`)
await db.close()

import { openPglite } from '../src/db/pglite.ts'
import { migrate, seed } from '../src/db/migrate.ts'

const db = await openPglite()

console.log('migrating...')
const applied = await migrate(db, { verbose: true })
console.log(`  ${applied.length} migration(s) applied`)

console.log('seeding...')
const seeded = await seed(db, { verbose: true })
console.log(`  ${seeded.length} seed file(s) applied`)

const { rows } = await db.query<{ kind: string; name: string }>(`
  SELECT CASE c.relkind WHEN 'r' THEN 'table' WHEN 'v' THEN 'view' ELSE c.relkind::text END AS kind,
         c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r','v')
   ORDER BY c.relkind DESC, c.relname
`)

console.log(`\n${rows.filter((r) => r.kind === 'table').length} tables, ${rows.filter((r) => r.kind === 'view').length} views`)
for (const r of rows) console.log(`  ${r.kind.padEnd(5)} ${r.name}`)

await db.close()

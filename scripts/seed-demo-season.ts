import { openPostgres } from '../src/db/postgres.ts'
import { openPglite } from '../src/db/pglite.ts'
import { migrate } from '../src/db/migrate.ts'
import { seedDemoSeason } from '../src/seed/demo_season.ts'
import { isPortOpen } from './guard.ts'

/**
 * 幻のデモ期を入れる（依頼者の指示。実行⑪）。
 *
 *   pnpm seed:demo-season            手元の .pgdata に入れる
 *   pnpm seed:demo-season --remote   DATABASE_URL の接続先に入れる
 *
 * ★★ **`--remote` が無ければ、DATABASE_URL があっても手元へ入れる。** ★★
 *
 *   最初の版は「DATABASE_URL があればそちら」にしていた。`.env.local` に
 *   本番の接続文字列が入っている環境で素直に走らせると、**架空の候補者が
 *   本番へ入った**（実際に起きた。C-87）。
 *
 *   `db:reset` は DATABASE_URL があると実行そのものを拒否する。
 *   同じ規律をここにも置く ―― **架空データを入れる道具は、既定で
 *   手元しか向かない。** 本番へ入れたいときは、そう書いたときだけ。
 *
 * ★ **何も消さない。** すでにデモ期があれば、作らずに終わる。
 *   作り直すと、そのデモ期で試した記録（メモ・参加者・採点）が消える。
 *
 * ★ 実在の期には1行も触らない。境界は 0029 が持つ。
 *
 * ★ 開発サーバを起動したまま .pgdata を開かない。
 *   PGlite の dataDir にはプロセス間ロックが無く、警告もエラーも無く壊れる
 *   （db:reset と同じ理由）。
 */

const remote = process.argv.includes('--remote')
const url = remote ? process.env.DATABASE_URL : undefined

if (remote && !url) {
  console.error('--remote を指定したが DATABASE_URL が無い。接続先が決まらない。')
  process.exit(1)
}

if (!url && await isPortOpen(3111)) {
  console.error(
    'ポート3111で何かが動いている（開発サーバ？）。.pgdata はプロセス間ロックが無く、' +
    '起動したまま開くと警告なく壊れる。開発サーバを止めてから実行すること。',
  )
  process.exit(1)
}

const db = url
  ? await openPostgres(url)
  : await openPglite(new URL('../.pgdata/', import.meta.url).pathname)

console.log(url
  ? '★ DATABASE_URL の接続先（本番かもしれない）へ入れる'
  : '手元の .pgdata へ入れる')

// デモ期は 0029 の上でしか成立しない。**適用済みなら何もしない**（冪等）。
// ここで確かめないと、未適用の DB では「列が無い」で落ちる。
const applied = await migrate(db)
if (applied.length > 0) console.log(`migrations applied: ${applied.length}`)

const stats = await seedDemoSeason(db)

if (!stats.created) {
  console.log('デモ期はすでにある。何も作らなかった。')
} else {
  console.log('デモ期を作った:')
  console.log(`  候補者   ${stats.persons}`)
  console.log(`  接点     ${stats.touchpoints}`)
  console.log(`  応募     ${stats.applications}`)
  console.log(`  予定     ${stats.appointments}`)
  console.log(`  メモ     ${stats.notes}`)
}
console.log(`season_id ${stats.seasonId}`)

await db.close()

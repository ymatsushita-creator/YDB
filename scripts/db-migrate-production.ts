import { confirmDestructive } from './confirm-destructive.ts'
import { openPostgres, actorName } from '../src/db/postgres.ts'
import { migrate, seed, ledgerTail } from '../src/db/migrate.ts'
import { saveSnapshot } from './backup-file.ts'
import type { Db } from '../src/db/client.ts'

/**
 * 本番（マネージド Postgres）へマイグレーションと参照データを適用する。
 *
 * db:reset とは違い、**何も消さない。**
 * migrate() は適用済みのマイグレーションをチェックサムで確認してスキップし、
 * seed() は何度でも流し直せる設計（src/db/migrate.ts のコメント）。
 * includeExamples は渡さない（既定 false）―― 本番にサンプルは絶対に入れない（C-28）。
 *
 * ★★ 実行⑬の穴（C-121）を2つ塞いである。
 *
 *   ① **書き込む前に控えを自分で取る。** 実行⑬は適用した後に db:backup を
 *      打っており、控えは適用前の姿を持っていなかった。順番を人の記憶に
 *      委ねない。seed は冪等でも書き込みであって、読み取りではない。
 *
 *   ② **前後の帳簿を印字する。** 実行⑬は `applied: 0` だけを見て
 *      「まだ当たっていない」と読み、控えの `schema_migrations 35` を
 *      「0032まで」と読み違えた。**行数を数えさせない。**
 *      最後に適用されたものが、いつ、どのプロセスから入ったかをそのまま出す。
 */

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL が未設定。適用対象の本番接続が無い。')
  process.exit(1)
}

const url = new URL(process.env.DATABASE_URL)
// ★ 接続文字列そのものは出力しない。名乗るのは host と db だけ。
console.log(`書き込み先 ―― ${url.hostname} / ${url.pathname.slice(1)}`)

// ★ 名乗ったうえで、人間の承認を取る。本番の帳簿を書き換える操作は不可逆。
if (!(await confirmDestructive('本番へのマイグレーション適用', url.hostname))) {
  process.exit(1)
}

/** 帳簿の末尾を1行で。**行数ではなく名前で言う。** */
async function ledger(db: Db): Promise<string> {
  const tail = await ledgerTail(db)
  if (tail === null) return '帳簿に行が無い（1本も適用されていない、または帳簿そのものが無い）'
  return `最後は ${tail.name}（${tail.at} JST ・ ${tail.by === '' ? '名乗り無し' : tail.by}）`
}

const db = await openPostgres(process.env.DATABASE_URL)

console.log(`適用前 ―― ${await ledger(db)}`)

// ★ 控えは書き込みの前。ここで失敗したら、適用そのものへ進まない。
const saved = await saveSnapshot(db, url.hostname, url.pathname.slice(1))
console.log(`控え ―― ${saved.dir}/（表 ${saved.tables} ・ 行 ${saved.rows}）`)

const t0 = performance.now()

// ★ 名乗りは渡す。接続の application_name はプーラが上書きする（C-145）。
const applied = await migrate(db, { verbose: true, actor: actorName() })
console.log(`migrations applied: ${applied.length}`)

const seeded = await seed(db, { verbose: true })
console.log(`seeds applied: ${seeded.length}`)

console.log(`適用後 ―― ${await ledger(db)}`)
if (applied.length === 0) {
  console.log(
    '★ 適用は0本。**すでに当たっている**ということであって、当たっていないことではない。' +
    '上の「適用後」が自分の名乗りでなければ、別の誰かが流している。',
  )
}

console.log(`done in ${Math.round(performance.now() - t0)}ms`)
await db.close()

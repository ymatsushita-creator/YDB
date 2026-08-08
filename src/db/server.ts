import 'server-only'
import { join } from 'node:path'
import { openPglite } from './pglite.ts'
import { openPostgres } from './postgres.ts'
import { migrate, seed } from './migrate.ts'
import { seedDemo } from '../seed/demo.ts'
import type { Db } from './client.ts'

/**
 * サーバ側で使い回す1つの接続。
 *
 * 開発では PGlite の永続ディレクトリ .pgdata/ を開く。
 * `pnpm db:reset` で作り直せる。
 *
 * 本番で PostgreSQL に繋ぐときは DATABASE_URL を見て node-postgres の
 * アダプタに差し替える。Db インターフェイスは query/exec/close の3つだけなので、
 * 差し替えの影響はこのファイルに閉じる。
 *
 * globalThis に載せるのは、開発時のホットリロードでモジュールが
 * 再評価されるたびに新しい WASM インスタンスが増えるのを防ぐため。
 */

// new URL(..., import.meta.url) は Turbopack がモジュール参照として
// 静的解決しようとして失敗する。実行時のパスとして組み立てる。
const DATA_DIR = join(process.cwd(), '.pgdata')

const cache = globalThis as unknown as { __youthdb?: Promise<Db> }

/**
 * デモモードかどうか。
 *
 * Vercel などのサーバレスでは**書き込めるディスクが無く、.pgdata も配られない**
 * （git 管理外）。永続を諦めて、起動のたびに使い捨ての DB を組み立てる。
 *
 * `YOUTHDB_DEMO` を明示すれば、そちらが常に優先する。指定が無いときだけ
 * Vercel を見て自動で入る（見せるためだけの環境で設定を1つも要らなくする）。
 *
 * **これは Pilot の本番ではない。** 判定は書けるが、インスタンスが入れ替わると
 * 消える。実データも入っていないし、認証も無い。
 * Pilot に必要なもの（バックアップ・認証・DB の分離）は
 * docs/pilot/DEPLOY-READINESS.md にあり、どれも満たしていない。
 */
export const isDemoMode = (): boolean =>
  process.env.YOUTHDB_DEMO !== undefined
    ? process.env.YOUTHDB_DEMO === '1'
    : process.env.VERCEL === '1'

/**
 * 使い捨ての DB を1つ組み立てる。
 *
 * デモの参照データ（*.example.sql）まで入れる。**実年度は入らない**
 * ―― `*.production.sql` はサンプルを入れる環境から外れる（C-28）。
 * 創作の応募が実在の年度にぶら下がるのを防ぐための境界で、ここでも同じに保つ。
 */
async function buildDemoDb(): Promise<Db> {
  const db = await openPglite()          // 引数なし＝インメモリ
  await migrate(db)
  await seed(db, { includeExamples: true })
  await seedDemo(db)
  return db
}

export function getDb(): Promise<Db> {
  if (isDemoMode()) {
    cache.__youthdb ??= buildDemoDb().catch((e: unknown) => {
      delete cache.__youthdb
      throw e
    })
    return cache.__youthdb
  }
  if (process.env.DATABASE_URL) {
    cache.__youthdb ??= openPostgres(process.env.DATABASE_URL).catch((e: unknown) => {
      delete cache.__youthdb
      throw e
    })
    return cache.__youthdb
  }
  // ??= は rejected な Promise を置き換えない。一度でも開けなかったら、
  // 原因が消えてもプロセスを再起動するまで全リクエストが同じエラーを返す。
  // 失敗したらキャッシュから外し、次のリクエストでやり直せるようにする。
  cache.__youthdb ??= openPglite(DATA_DIR).catch((e: unknown) => {
    delete cache.__youthdb
    throw e
  })
  return cache.__youthdb
}

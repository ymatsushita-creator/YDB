import 'server-only'
import { join } from 'node:path'
import { openPglite } from './pglite.ts'
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

export function getDb(): Promise<Db> {
  if (process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL が設定されているが、PostgreSQL アダプタは未実装。' +
      'src/db/server.ts に node-postgres の実装を足すこと。',
    )
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

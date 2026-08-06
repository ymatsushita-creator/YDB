import { PGlite } from '@electric-sql/pglite'
import type { Db, QueryResult } from './client.ts'

/**
 * PGlite（WASM 版 PostgreSQL）を Db として使う。
 *
 * デーモンを必要としないため、テストが1プロセスで完結する。
 * 本番の PostgreSQL とはバージョンが違いうるので、
 * バージョン依存の機能を使う場合は tests/00_environment.test.ts で検出する。
 *
 * タイムゾーンは Asia/Tokyo に固定する。jst_date() は明示指定なので
 * これに依存しないが、日付リテラルの解釈など jst_date() を通らない
 * 経路で本番と挙動を揃えるため。
 */
export async function openPglite(dataDir?: string): Promise<Db> {
  const pg = await PGlite.create(dataDir ? { dataDir } : undefined)
  await pg.exec(`SET TimeZone = 'Asia/Tokyo'`)

  return {
    async query<T>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
      const res = await pg.query<T>(sql, params as never[])
      return { rows: res.rows }
    },
    async exec(sql: string): Promise<void> {
      await pg.exec(sql)
    },
    async close(): Promise<void> {
      await pg.close()
    },
  }
}

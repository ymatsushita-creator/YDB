import { Pool } from 'pg'
import type { Db, QueryResult } from './client.ts'

/**
 * 本番の PostgreSQL（マネージド Postgres）を Db として使う。
 *
 * PGlite と同じ query(sql, params) -> { rows } の形に合わせているため、
 * 呼び出し側（src/queries, src/commands）は一切変えずに済む。
 *
 * `exec` はマイグレーション専用（複数文の SQL をそのまま渡す）。
 * pg はパラメータを渡さない query() を simple query protocol で実行するため、
 * PGlite の exec と同じく `;` 区切りの複数文をそのまま流せる。
 */
export async function openPostgres(connectionString: string): Promise<Db> {
  const pool = new Pool({
    connectionString,
    // マネージド Postgres の証明書チェーンが Node の既定 CA ストアに無いことがある。
    // 接続文字列に sslmode=disable が明示されている場合だけ SSL を切る
    // （ローカルの検証用途）。それ以外は暗号化だけ有効にし、証明書の厳密検証はしない。
    ssl: connectionString.includes('sslmode=disable')
      ? false
      : { rejectUnauthorized: false },
    // タイムゾーンは起動パラメータで揃える（PGlite 側と同じ Asia/Tokyo）。
    // 'connect' イベントで SET を投げる形は、プールがそのクライアントを
    // 次のクエリに使い回すタイミングと競合し、
    // 「client.query() が実行中にまた呼ばれた」エラーになるため避ける。
    options: '-c TimeZone=Asia/Tokyo',
  })

  // 起動時に1回だけ接続確認する。ここで失敗すれば getDb() 側の
  // catch がキャッシュを外し、次のリクエストで再試行できる。
  const probe = await pool.connect()
  probe.release()

  return {
    async query<T>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
      const res = await pool.query(sql, params)
      return { rows: res.rows as T[] }
    },
    async exec(sql: string): Promise<void> {
      await pool.query(sql)
    },
    async close(): Promise<void> {
      await pool.end()
    },
  }
}

/**
 * データベースドライバの薄い抽象。
 *
 * 本番は PostgreSQL 15+、開発とテストは PGlite（WASM 版 PostgreSQL）を使う。
 * 両者は query(sql, params) -> { rows } の形が一致しているため、
 * ORM を挟まずにこの1インターフェイスで足りる。
 *
 * SQL を単一の情報源に保つのが目的。クエリビルダを入れると、
 * 集計定義がスキーマとアプリの二箇所に散る。
 */

export interface QueryResult<T> {
  rows: T[]
}

export interface Db {
  /** パラメータ化クエリ。1文のみ。値の埋め込みは必ず $1 形式で行う。 */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>
  /** 複数文の SQL をそのままサーバへ渡す。マイグレーション専用。 */
  exec(sql: string): Promise<void>
  close(): Promise<void>
}

/** 1行だけ返るはずのクエリ。返らなければ落とす。 */
export async function one<T = Record<string, unknown>>(
  db: Db,
  sql: string,
  params?: unknown[],
): Promise<T> {
  const { rows } = await db.query<T>(sql, params)
  if (rows.length !== 1) {
    throw new Error(`expected exactly 1 row, got ${rows.length}`)
  }
  return rows[0]!
}

/** 0行か1行。見つからなければ null。 */
export async function maybeOne<T = Record<string, unknown>>(
  db: Db,
  sql: string,
  params?: unknown[],
): Promise<T | null> {
  const { rows } = await db.query<T>(sql, params)
  if (rows.length > 1) {
    throw new Error(`expected at most 1 row, got ${rows.length}`)
  }
  return rows[0] ?? null
}

export async function all<T = Record<string, unknown>>(
  db: Db,
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  const { rows } = await db.query<T>(sql, params)
  return rows
}

/** スカラー1個。集計値の取り出しに使う。 */
export async function scalar<T>(db: Db, sql: string, params?: unknown[]): Promise<T> {
  const row = await one<Record<string, T>>(db, sql, params)
  const values = Object.values(row)
  if (values.length !== 1) {
    throw new Error(`expected exactly 1 column, got ${values.length}`)
  }
  return values[0]!
}

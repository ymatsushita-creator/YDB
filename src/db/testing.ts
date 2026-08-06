import { openPglite } from './pglite.ts'
import { migrate, seed } from './migrate.ts'
import type { Db } from './client.ts'

/**
 * マイグレーション済みの空のデータベースを1つ作る。
 *
 * PGlite のインメモリインスタンスはテストごとに独立している。
 * トランザクションでロールバックする方式より遅いが、
 * DDL やトリガの検証が主目的なので分離の確実さを取る。
 */
export async function freshDb(opts: { withSeeds?: boolean } = {}): Promise<Db> {
  const db = await openPglite()
  await migrate(db)
  if (opts.withSeeds !== false) await seed(db)
  return db
}

/** SQL が特定のメッセージで失敗することを確かめる。 */
export async function expectFailure(
  fn: () => Promise<unknown>,
  match: RegExp,
): Promise<Error> {
  let err: Error | undefined
  try {
    await fn()
  } catch (e) {
    err = e as Error
  }
  if (!err) throw new Error(`expected a failure matching ${match}, but it succeeded`)
  if (!match.test(err.message)) {
    throw new Error(`expected failure matching ${match}, got: ${err.message}`)
  }
  return err
}

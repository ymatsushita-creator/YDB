import { openPglite } from './pglite.ts'
import { migrate, seed } from './migrate.ts'
import type { Db } from './client.ts'

/**
 * マイグレーション済みの空のデータベースを1つ作る。
 *
 * PGlite のインメモリインスタンスはテストごとに独立している。
 * トランザクションでロールバックする方式より遅いが、
 * DDL やトリガの検証が主目的なので分離の確実さを取る。
 *
 * 参照データは既定では入れない。テストが数える対象に、そのテストが
 * 作っていない行が混ざると、何を検証しているのか読んで分からなくなる。
 *
 * 参照データそのものを検証したいテストは seeds を渡す。
 *   'production' … db/seeds/*.sql のみ（本番と同じ）
 *   'examples'   … サンプル（*.example.sql）も含める
 * 実際に使っているのは tests/09_definition_fidelity.test.ts。
 */
export async function freshDb(
  opts: { seeds?: 'none' | 'production' | 'examples' } = {},
): Promise<Db> {
  const db = await openPglite()
  await migrate(db)
  if (opts.seeds === 'production') await seed(db)
  if (opts.seeds === 'examples') await seed(db, { includeExamples: true })
  return db
}

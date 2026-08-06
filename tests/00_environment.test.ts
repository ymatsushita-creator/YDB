import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { openPglite } from '../src/db/pglite.ts'
import { scalar } from '../src/db/client.ts'

/**
 * 実行環境が、このスキーマの要求する機能を持っているか。
 *
 * 開発とテストは PGlite（WASM 版 PostgreSQL）、本番は PostgreSQL 15 以上を
 * 想定している。両者はバージョンが違いうるので、バージョン依存の機能を
 * 使っているところをここで検出する。本番へ初めて適用する前に、
 * 同じ検査を本番の接続に対して走らせること。
 */
describe('実行環境', () => {
  test('PostgreSQL 15 以上である', async () => {
    const db = await openPglite()
    const v = await scalar<string>(db, `SHOW server_version`)
    const major = Number.parseInt(v, 10)
    assert.ok(major >= 15, `PostgreSQL 15 以上が要る。実際は ${v}`)
    await db.close()
  })

  test('gen_random_uuid() が拡張なしで使える（13+）', async () => {
    // C-3。pgcrypto への依存を外した根拠。
    const db = await openPglite()
    const id = await scalar<string>(db, `SELECT gen_random_uuid()`)
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-/)
    await db.close()
  })

  test('UNIQUE NULLS NOT DISTINCT が使える（15+）', async () => {
    // evaluations の担当未割当行の重複防止がこれに依存している。
    const db = await openPglite()
    await db.exec(`CREATE TABLE probe (a int, b int, CONSTRAINT k UNIQUE NULLS NOT DISTINCT (a, b))`)
    await db.query(`INSERT INTO probe VALUES (1, NULL)`)
    await assert.rejects(
      () => db.query(`INSERT INTO probe VALUES (1, NULL)`),
      /duplicate key/,
    )
    await db.close()
  })

  test('式インデックスを IMMUTABLE 関数に張れる', async () => {
    // jst_date() の式インデックスが本番でも作れることの確認。
    const db = await openPglite()
    await db.exec(`
      CREATE FUNCTION probe_day(ts timestamptz) RETURNS date
        LANGUAGE sql IMMUTABLE AS $$ SELECT (ts AT TIME ZONE 'Asia/Tokyo')::date $$;
      CREATE TABLE probe (at timestamptz);
      CREATE INDEX probe_day_idx ON probe (probe_day(at));
    `)
    await db.close()
  })

  test('timestamptz::date がセッションのタイムゾーンに依存する', async () => {
    // A-1 の前提。この性質が無い環境なら jst_date() は不要になるが、
    // 標準の PostgreSQL である限り依存する。前提が変わったら気づけるように。
    const db = await openPglite()
    const ts = `'2025-04-01T08:00:00+09:00'::timestamptz`
    await db.exec(`SET TimeZone = 'UTC'`)
    const utc = await scalar<Date>(db, `SELECT (${ts})::date`)
    await db.exec(`SET TimeZone = 'Asia/Tokyo'`)
    const jst = await scalar<Date>(db, `SELECT (${ts})::date`)
    assert.notEqual(
      new Date(utc).toISOString(), new Date(jst).toISOString(),
      'セッション TZ で結果が変わる。これが jst_date() を要る理由',
    )
    await db.close()
  })
})

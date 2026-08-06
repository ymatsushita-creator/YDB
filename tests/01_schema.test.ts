import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { openPglite } from '../src/db/pglite.ts'
import { migrate } from '../src/db/migrate.ts'
import { freshDb } from '../src/db/testing.ts'
import { scalar, all } from '../src/db/client.ts'

describe('マイグレーション', () => {
  test('空のデータベースに適用でき、二度目は何もしない', async () => {
    const db = await openPglite()
    const first = await migrate(db)
    assert.ok(first.length > 0, '初回は1件以上適用される')

    const second = await migrate(db)
    assert.deepEqual(second, [], '二度目は適用対象なし')
    await db.close()
  })

  test('適用済みマイグレーションの改変を検出して止める', async () => {
    const db = await openPglite()
    await migrate(db)
    await db.query(`UPDATE schema_migrations SET checksum = 'tampered' WHERE name = $1`, [
      '0001_schema.sql',
    ])
    await assert.rejects(() => migrate(db), /was modified after it was applied/)
    await db.close()
  })

  test('原典のビューはすべて存在する（改訂で置き換えられたものを除く）', async () => {
    const db = await freshDb()
    const expected = [
      'v_application_state',
      'v_attribution_first',
      'v_attribution_last',
      'v_attribution_linear',
      'v_conflict_of_interest',
      'v_countable_applications',
      'v_effective_status_histories',
      'v_final_selection_step',
      'v_person_lifetime_summary',
      'v_person_season_state',
      'v_touchpoint_season',
    ]
    const rows = await all<{ relname: string }>(
      db,
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'v' ORDER BY 1`,
    )
    assert.deepEqual(rows.map((r) => r.relname), expected)
    await db.close()
  })

  test('原典の v_person_state と v_funnel_daily は残っていない', async () => {
    // 改訂版で分割・関数化されたもの。両方存在すると、どちらが正かが
    // 呼び出し側の記憶に依存する。置き換えたなら消えていなければならない。
    const db = await freshDb()
    for (const name of ['v_person_state', 'v_funnel_daily']) {
      const n = await scalar<string>(
        db,
        `SELECT count(*) FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
          WHERE ns.nspname = 'public' AND c.relname = $1`,
        [name],
      )
      assert.equal(Number(n), 0, `${name} は改訂版で置き換えられているはず`)
    }
    await db.close()
  })
})

describe('集計関数の引数', () => {
  test('active_window_days に NULL を渡すと静かに0件を返さず落ちる', async () => {
    const db = await freshDb()
    await assert.rejects(
      () => db.query(`SELECT * FROM f_funnel_daily(NULL)`),
      /active_window_days must be a positive integer/,
    )
    await db.close()
  })

  test('active_window_days に 0 を渡しても落ちる', async () => {
    const db = await freshDb()
    await assert.rejects(
      () => db.query(`SELECT * FROM f_funnel_daily(0)`),
      /active_window_days must be a positive integer/,
    )
    await db.close()
  })

  test('attribution_window_days に NULL を渡すと落ちる', async () => {
    const db = await freshDb()
    await assert.rejects(
      () => db.query(`SELECT * FROM f_partner_reach_summary(NULL)`),
      /attribution_window_days must be a positive integer/,
    )
    await db.close()
  })
})

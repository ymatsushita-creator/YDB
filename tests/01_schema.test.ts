import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

  test('適用済みなのにファイルが無い状態を検出する', async () => {
    // 誤って消した、あるいは別のブランチを見ている。素通りさせると、
    // そのマイグレーションが入っている前提で以降が進む。
    const db = await openPglite()
    await migrate(db)
    await db.query(
      `INSERT INTO schema_migrations (name, checksum) VALUES ('9999_ghost.sql', 'x')`)
    await assert.rejects(() => migrate(db), /missing from db\/migrations/)
    await db.close()
  })

  test('適用と記録は同一トランザクションで行われる', async () => {
    // 途中で失敗したとき、スキーマの変更も記録も両方が巻き戻ること。
    // 片方だけ残ると、次回以降 migrate() が同じ位置で永久に失敗する。
    //
    // あわせて、失敗後にコネクションが使える状態で返ること。
    // 明示 BEGIN の中で失敗するとトランザクションは中断状態のまま開くので、
    // ROLLBACK しないと以降のクエリがすべて別のエラーで弾かれ、
    // 本当の失敗理由が見えなくなる。
    const db = await openPglite()
    const dir = await mkdtemp(join(tmpdir(), 'youthdb-mig-'))
    await writeFile(join(dir, '0001_broken.sql'), 'CREATE TABLE half_applied (id int);\nSELECT 1/0;')

    await assert.rejects(
      () => migrate(db, { migrationsDir: dir }), /0001_broken\.sql failed.*division by zero/s)

    // 失敗理由が「トランザクションが中断している」に化けていないこと
    assert.equal(
      Number(await scalar(db, `SELECT 1`)), 1, '失敗後もコネクションが使える')

    const leftovers = await scalar<string>(db, `
      SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'half_applied'`)
    assert.equal(Number(leftovers), 0, 'テーブルは残らない')
    assert.equal(
      Number(await scalar(db, `SELECT count(*) FROM schema_migrations`)), 0,
      '記録も残らない')

    await rm(dir, { recursive: true, force: true })
    await db.close()
  })

  test('原典のビューはすべて存在する（改訂で置き換えられたものを除く）', async () => {
    const db = await freshDb()
    const fromOriginal = [
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
    // 実装で足したもの。原典と混ぜて並べると、どれが正典由来かが
    // 読んで分からなくなる。足すたびにここに理由ごと1行増える。
    const added = [
      // 0011: 応募の結末。数えるかどうかとは別の軸（A-14）
      'v_application_outcome',
      // 0011: いま動いている応募。判断待ち・保留・担当未割当・利益相反の母集団
      'v_active_applications',
      // 0012: 団体 → その団体が属する森。林に付いた接点を森へ畳む経路
      'v_partner_forest',
      // 0012: 森（親を持たない団体）と林（親を持つ団体）
      'v_forests',
      'v_communities',
      // 0012: いまやること。既存の事実からの導出で、Task の記録層ではない
      'v_open_tasks',
      // 0012: 森の活動（年度を問わない）と、森×年度（応募・合格・やること）
      'v_forest_activity',
      'v_forest_season_activity',
    ]
    const expected = [...fromOriginal, ...added].sort()
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

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { scalar, type Db } from '../src/db/client.ts'
import { dump, restore, verify, tableOrder } from '../src/db/backup.ts'
import { seedDemo } from '../src/seed/demo.ts'

/**
 * 取って、戻す（C-83）。
 *
 * Pilot の成功条件は「**障害や誤操作が起きてもデータを復旧できること**」。
 * ★★ **取れることは、戻せることの証明ではない。**
 *   だからこのテストは、取ったあとに**わざと壊してから**戻す。
 *   壊さずに「戻した」と言うテストは、何も確かめていない。
 */

describe('取って、戻す', () => {
  let db: Db
  let snapshot: Awaited<ReturnType<typeof dump>>

  before(async () => {
    db = await freshDb({ seeds: 'examples' })
    await seedDemo(db)
    snapshot = await dump(db)
  })

  after(async () => { await db.close() })

  test('表を1つも取り落としていない', async () => {
    const all = await tableOrder(db)
    assert.deepEqual(
      snapshot.tables.map((t) => t.table).sort(),
      [...all].sort(),
      '記録層の表と、取った表が食い違っている',
    )
    assert.ok(all.length >= 20, `表が ${all.length} 個しか見えない（走査が壊れている）`)
  })

  test('★ 参照される側が先に並んでいる', async () => {
    // この並びが崩れると、戻すときに「参照先が居ない」で落ちる。
    const order = snapshot.tables.map((t) => t.table)
    assert.ok(order.indexOf('schools') < order.indexOf('persons'),
      'persons は schools を参照するので、schools が先')
    assert.ok(order.indexOf('persons') < order.indexOf('applications'))
    assert.ok(order.indexOf('applications') < order.indexOf('status_histories'))
  })

  test('空でない ―― 取ったものに中身がある', () => {
    const persons = snapshot.tables.find((t) => t.table === 'persons')
    assert.ok((persons?.rows.length ?? 0) > 0, 'persons が空のまま「取れた」と言っている')
    assert.ok(snapshot.takenAt.endsWith('Z'), 'いつ取ったかが残っていない')
  })

  test('★★ 全部消してから戻すと、件数が全表で一致する', async () => {
    const before = await scalar<number>(db, 'SELECT count(*)::int FROM persons')

    // わざと壊す。**追記専用の表も含めて全部消す**（TRUNCATE は行トリガを通らない）。
    const names = snapshot.tables.map((t) => `"${t.table}"`).join(', ')
    await db.exec(`TRUNCATE ${names} CASCADE`)
    assert.equal(await scalar<number>(db, 'SELECT count(*)::int FROM persons'), 0,
      '壊れていない。この先の「戻った」は意味を持たない')

    await restore(db, snapshot)

    const diffs = (await verify(db, snapshot)).filter((v) => v.expected !== v.actual)
    assert.deepEqual(diffs, [], '戻したのに件数が違う表がある')
    assert.equal(await scalar<number>(db, 'SELECT count(*)::int FROM persons'), before)
  })

  test('★ 戻したあとも、集計が同じ値を返す', async () => {
    // 件数が合っても、値がずれていれば復旧ではない。
    // 導出値を1つ選んで、取る前と同じかを見る。
    const funnel = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM v_active_applications`)
    const again = await restore(db, snapshot).then(() =>
      db.query<{ n: number }>(`SELECT count(*)::int AS n FROM v_active_applications`))
    assert.equal(again.rows[0]?.n, funnel.rows[0]?.n)
  })

  test('★ 途中で落ちたら、消えたまま終わらない', async () => {
    // 戻す途中の失敗で「消えたが戻っていない」を作らない（1トランザクション）。
    const persons = await scalar<number>(db, 'SELECT count(*)::int FROM persons')
    const broken = {
      ...snapshot,
      tables: snapshot.tables.map((t) => (t.table === 'persons'
        ? { ...t, columns: [...t.columns, 'そんな列は無い'], types: [...t.types, 'text'] }
        : t)),
    }
    await assert.rejects(() => restore(db, broken), '壊れた雪形を黙って受け入れている')
    assert.equal(await scalar<number>(db, 'SELECT count(*)::int FROM persons'), persons,
      '戻せずに終わったのに、元の行が消えている')
  })

  test('JSON を通しても同じものが戻る（保存経路と同じ形で確かめる）', async () => {
    // 実際の保存は JSON なので、**JSON を通した後**で戻せることを見る。
    const through = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot
    await restore(db, through)
    const diffs = (await verify(db, through)).filter((v) => v.expected !== v.actual)
    assert.deepEqual(diffs, [])
  })
})

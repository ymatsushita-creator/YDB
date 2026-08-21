import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { scalar, maybeOne, type Db } from '../src/db/client.ts'
import {
  baseFixture, makeSeason, makePerson, makeChannel, makeTouchpoint, jst,
} from './support/fixtures.ts'
import { seedDemoSeason } from '../src/seed/demo_season.ts'
import { countDemoRows, removeDemoRows, readRealCounts } from '../src/db/demo_removal.ts'

/**
 * デモデータの撤去（C-148。依頼者の指示）。
 *
 * ★ **戻せない操作なので、確かめるのは「消えたこと」ではなく
 *   「実在の側が1行も動かなかったこと」である。**
 *
 * 固定したいのは4つ ――
 *   ① 架空の人・デモ期・その下の行が消える
 *   ② **実在の人・期・応募・記録・接点は1行も減らない**
 *   ③ 追記専用トリガが**元に戻っている**（撤去のあとに実在の記録を消せない）
 *   ④ 2回流しても落ちない（2回目は消すものが無い）
 */

describe('デモデータの撤去（C-148）', () => {
  let db: Db
  let realSeasonId: string
  let realPerson: string

  before(async () => {
    db = await freshDb()
    const base = await baseFixture(db)
    const channelId = await makeChannel(db, 'イベント')

    // 実在の期とデモ期の窓をわざと重ねる（0029 と同じ条件）。
    realSeasonId = (await makeSeason(db, {
      year: 2026,
      outreachStart: '2026-01-01', applicationOpen: '2026-02-01',
      applicationClose: '2026-03-01', selectionEnd: '2026-12-31',
    })).id
    realPerson = await makePerson(db, base.schoolId,
      { familyName: '実在', givenName: '太郎' })
    await makeTouchpoint(db, realPerson, channelId, jst('2026-02-10 10:00:00'))
    await db.query(
      `INSERT INTO person_notes (person_id, author_name, body, noted_at)
       VALUES ($1, '運営 太郎', '実在の記録', $2)`,
      [realPerson, jst('2026-02-11 10:00:00')],
    )

    await seedDemoSeason(db)
  })

  test('撤去の前は、架空の行がある', async () => {
    const counted = await countDemoRows(db)
    const total = counted.reduce((n, r) => n + r.rows, 0)
    assert.ok(total > 0, 'デモデータが入っていない。前提が崩れている')
    assert.ok(
      counted.find((c) => c.table === 'persons')!.rows > 0,
      '架空の人が居ない',
    )
  })

  test('★ 実在の側は1行も動かない', async () => {
    const before = await readRealCounts(db)
    const { after } = await removeDemoRows(db)
    assert.deepEqual(after, before, '実在の行が動いた')
  })

  test('架空の人とデモ期は残らない', async () => {
    assert.equal(Number(await scalar(db, `SELECT count(*) FROM persons WHERE is_demo`)), 0)
    assert.equal(Number(await scalar(db, `SELECT count(*) FROM seasons WHERE is_demo`)), 0)
    const rest = await countDemoRows(db)
    assert.equal(rest.reduce((n, r) => n + r.rows, 0), 0)
  })

  test('実在の人・期・記録はそのまま読める', async () => {
    const p = await maybeOne(db, `SELECT id FROM persons WHERE id = $1`, [realPerson])
    assert.ok(p, '実在の人が消えている')
    const s = await maybeOne(db, `SELECT id FROM seasons WHERE id = $1`, [realSeasonId])
    assert.ok(s, '実在の期が消えている')
    assert.equal(Number(await scalar(db, `SELECT count(*) FROM person_notes`)), 1)
    assert.equal(Number(await scalar(db, `SELECT count(*) FROM touchpoints`)), 1)
  })

  test('★ 追記専用トリガが元に戻っている ―― 実在の記録は消せない', async () => {
    await assert.rejects(
      () => db.query(`DELETE FROM person_notes WHERE person_id = $1`, [realPerson]),
      /追記専用|append|拒否|reject/i,
      '撤去のあとに実在の記録が消せてしまう',
    )
    assert.equal(Number(await scalar(db, `SELECT count(*) FROM person_notes`)), 1)
  })

  test('2回流しても落ちない（2回目は消すものが無い）', async () => {
    const { deleted } = await removeDemoRows(db)
    assert.equal(deleted.reduce((n, r) => n + r.rows, 0), 0)
  })
})

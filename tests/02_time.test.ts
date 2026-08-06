import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { scalar } from '../src/db/client.ts'
import { baseFixture, makeSeason, makePerson, makeApplication, funnelOn, jst } from './support/fixtures.ts'

const asDate = (d: unknown) => (d as Date).toISOString().slice(0, 10)

describe('日付境界は運用タイムゾーンで決まる', () => {
  test('jst_date はセッションのタイムゾーンに影響されない', async () => {
    const db = await freshDb()
    // JST の朝8時。UTC では前日23時にあたる。
    const ts = `'2025-04-01T08:00:00+09:00'::timestamptz`

    for (const tz of ['Asia/Tokyo', 'UTC', 'America/New_York']) {
      await db.exec(`SET TimeZone = '${tz}'`)
      const d = await scalar<Date>(db, `SELECT jst_date(${ts})`)
      assert.equal(asDate(d), '2025-04-01', `session TZ=${tz} でも同じ日付になる`)
    }
    await db.close()
  })

  test('素の ::date はセッションのタイムゾーンでずれる（jst_date が必要な理由）', async () => {
    const db = await freshDb()
    const ts = `'2025-04-01T08:00:00+09:00'::timestamptz`

    await db.exec(`SET TimeZone = 'Asia/Tokyo'`)
    assert.equal(asDate(await scalar(db, `SELECT (${ts})::date`)), '2025-04-01')

    await db.exec(`SET TimeZone = 'UTC'`)
    assert.equal(
      asDate(await scalar(db, `SELECT (${ts})::date`)),
      '2025-03-31',
      'UTC セッションでは前日に寄る。これがファネルに混ざると初日がずれる',
    )
    await db.close()
  })

  test('接続が UTC でもファネルの日次集計は JST の暦日で数える', async () => {
    const db = await freshDb()
    const { schoolId } = await baseFixture(db)
    const season = await makeSeason(db, {
      year: 2026,
      applicationOpen: '2025-11-01',
      applicationClose: '2025-12-15',
      selectionEnd: '2026-02-28',
    })
    const person = await makePerson(db, schoolId)
    // 応募開始日の朝8時。UTC に落とすと 10/31 になる時刻。
    await makeApplication(db, person, season.id, jst('2025-11-01T08:00:00'))

    await db.exec(`SET TimeZone = 'UTC'`)
    const openDay = await funnelOn(db, season.id, '2025-11-01')
    assert.equal(openDay.applicant_cum, 1, '応募開始日にすでに1件計上されている')

    const dayBefore = await db.query(
      `SELECT applicant_cum FROM f_funnel_daily(90)
        WHERE season_id = $1 AND as_of = '2025-10-31'::date`,
      [season.id],
    )
    assert.equal(dayBefore.rows.length, 0, '応募開始前の行はそもそも存在しない')
    await db.close()
  })
})

import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { scalar, type Db } from '../src/db/client.ts'
import { listMonthAppointments } from '../src/queries/calendar.ts'
import {
  baseFixture, jst, makePerson, makeSeason, type Season,
} from './support/fixtures.ts'

describe('月カレンダー', () => {
  let db: Db
  let season: Season
  let otherSeason: Season
  let schoolId: string
  let staffId: string

  before(async () => {
    db = await freshDb()
    const base = await baseFixture(db)
    schoolId = base.schoolId
    staffId = base.staffId
    season = await makeSeason(db, { year: 2026 })
    otherSeason = await makeSeason(db, { year: 2027 })
  })

  after(async () => { await db.close() })

  const add = async (args: {
    seasonId?: string
    code: 'event' | 'internal' | 'interview'
    title: string
    starts: string
    ends: string
    personId?: string | null
    cancelled?: boolean
  }) => scalar<string>(db, `
    INSERT INTO appointments
      (season_id, person_id, kind_id, title, starts_at, ends_at, owner_staff_id,
       cancelled_at, cancel_reason)
    SELECT $1, $2, k.id, $3, $4::timestamptz, $5::timestamptz, $6,
           CASE WHEN $7 THEN now() END,
           CASE WHEN $7 THEN '取消' END
      FROM appointment_kinds k
     WHERE k.code = $8
    RETURNING id`, [
    args.seasonId ?? season.id,
    args.personId ?? null,
    args.title,
    jst(args.starts),
    jst(args.ends),
    staffId,
    args.cancelled ?? false,
    args.code,
  ])

  test('イベントと既存種別を同じ月に出し、開始日の升だけに置く', async () => {
    const event = await add({
      code: 'event', title: '公開イベント',
      starts: '2026-05-10T19:00:00', ends: '2026-05-10T21:00:00',
    })
    const internal = await add({
      code: 'internal', title: '運営打合せ',
      starts: '2026-05-20T23:00:00', ends: '2026-05-21T01:00:00',
    })

    const rows = await listMonthAppointments(db, season.id, '2026-05-01', '2026-06-01')
    assert.deepEqual(rows.map((row) => row.appointment_id), [event, internal])
    assert.deepEqual(rows.map((row) => row.kind_code), ['event', 'internal'])
    assert.equal(rows[1]?.starts_on.toISOString().slice(0, 10), '2026-05-20')
  })

  test('期と月の境界で絞る', async () => {
    const first = await add({
      code: 'event', title: '月初',
      starts: '2026-05-01T00:00:00', ends: '2026-05-01T01:00:00',
    })
    const last = await add({
      code: 'event', title: '月末',
      starts: '2026-05-31T23:00:00', ends: '2026-06-01T01:00:00',
    })
    const nextMonth = await add({
      code: 'event', title: '翌月',
      starts: '2026-06-01T00:00:00', ends: '2026-06-01T01:00:00',
    })
    const anotherSeason = await add({
      seasonId: otherSeason.id, code: 'event', title: '別期',
      starts: '2026-05-15T10:00:00', ends: '2026-05-15T11:00:00',
    })

    const ids = (await listMonthAppointments(
      db, season.id, '2026-05-01', '2026-06-01',
    )).map((row) => row.appointment_id)
    assert.ok(ids.includes(first))
    assert.ok(ids.includes(last))
    assert.equal(ids.includes(nextMonth), false)
    assert.equal(ids.includes(anotherSeason), false)
  })

  test('取消済みと匿名化済み人物の予定は出ない', async () => {
    const personId = await makePerson(db, schoolId)
    const cancelled = await add({
      code: 'event', title: '取消済み', cancelled: true,
      starts: '2026-05-22T10:00:00', ends: '2026-05-22T11:00:00',
    })
    const anonymized = await add({
      code: 'interview', title: '匿名化済み', personId,
      starts: '2026-05-23T10:00:00', ends: '2026-05-23T11:00:00',
    })
    await db.query(`UPDATE persons SET anonymized_at = now() WHERE id = $1`, [personId])

    const ids = (await listMonthAppointments(
      db, season.id, '2026-05-01', '2026-06-01',
    )).map((row) => row.appointment_id)
    assert.equal(ids.includes(cancelled), false)
    assert.equal(ids.includes(anonymized), false)
  })
})

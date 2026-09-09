import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { all, scalar, type Db } from '../src/db/client.ts'
import { listCalendarAttendees } from '../src/queries/calendar.ts'
import {
  baseFixture, jst, makeChannel, makePerson, makeSeason, makeTouchpoint, type Season,
} from './support/fixtures.ts'

describe('月カレンダーの参加履歴', () => {
  let db: Db
  let season: Season
  let otherSeason: Season
  let schoolId: string
  let staffId: string
  let channelId: string
  let appointmentId: string
  let otherAppointmentId: string
  let firstPersonId: string
  let outsidePersonId: string
  let otherPersonId: string

  before(async () => {
    db = await freshDb()
    const base = await baseFixture(db)
    schoolId = base.schoolId
    staffId = base.staffId
    season = await makeSeason(db, { year: 2026 })
    otherSeason = await makeSeason(db, { year: 2027 })
    channelId = await makeChannel(db, 'イベント参加')
    firstPersonId = await makePerson(db, schoolId)
    outsidePersonId = await makePerson(db, schoolId)
    otherPersonId = await makePerson(db, schoolId)

    const addAppointment = (title: string) => scalar<string>(db, `
      INSERT INTO appointments
        (season_id, kind_id, title, starts_at, ends_at, owner_staff_id)
      SELECT $1, k.id, $2, $3::timestamptz, $4::timestamptz, $5
        FROM appointment_kinds k WHERE k.code = 'event'
      RETURNING id`, [
      season.id, title, jst('2026-05-10T10:00:00'),
      jst('2026-05-10T12:00:00'), staffId,
    ])
    appointmentId = await addAppointment('対象予定')
    otherAppointmentId = await addAppointment('別予定')

    const attend = async (targetAppointmentId: string, personId: string) => {
      const touchpointId = await makeTouchpoint(
        db, personId, channelId, jst('2026-05-10T10:00:00'),
      )
      await db.query(`
        INSERT INTO event_attendances (appointment_id, person_id, touchpoint_id)
        VALUES ($1, $2, $3)`, [targetAppointmentId, personId, touchpointId])
    }
    await attend(appointmentId, firstPersonId)
    await attend(appointmentId, outsidePersonId)
    await attend(otherAppointmentId, otherPersonId)

    const gradeId = async (code: string) => scalar<string>(
      db, `SELECT id FROM confidence_grades WHERE code = $1`, [code],
    )
    await db.query(`
      INSERT INTO person_confidence_events
        (person_id, season_id, grade_id, occurred_at, recorded_by)
      VALUES ($1, $2, $3, $4, 'テスト記録者')`, [
      firstPersonId, season.id, await gradeId('S'), jst('2026-05-11T10:00:00'),
    ])
    await db.query(`
      INSERT INTO person_confidence_events
        (person_id, season_id, grade_id, occurred_at, recorded_by)
      VALUES ($1, $2, $3, $4, 'テスト記録者'),
             ($1, $5, $6, $4, 'テスト記録者')`, [
      outsidePersonId, season.id, await gradeId('B'), jst('2026-05-11T10:00:00'),
      otherSeason.id, await gradeId('A'),
    ])
  })

  after(async () => { await db.close() })

  test('予定単位で参加者の氏名とその期の確度を返す', async () => {
    const expectedNames = await all<{ id: string; person_name: string }>(db, `
      SELECT id, family_name || ' ' || given_name AS person_name
        FROM persons WHERE id = ANY($1::uuid[])`, [[firstPersonId, outsidePersonId]])
    const nameById = new Map(expectedNames.map((row) => [row.id, row.person_name]))

    const rows = await listCalendarAttendees(db, appointmentId, season.id)
    assert.deepEqual(new Set(rows.map((row) => row.person_id)),
      new Set([firstPersonId, outsidePersonId]))
    assert.equal(rows.find((row) => row.person_id === firstPersonId)?.person_name,
      nameById.get(firstPersonId))
    assert.equal(rows.find((row) => row.person_id === firstPersonId)?.grade_code, 'S')
    assert.equal(rows.find((row) => row.person_id === outsidePersonId)?.person_name,
      nameById.get(outsidePersonId))
    assert.equal(rows.find((row) => row.person_id === outsidePersonId)?.grade_code, 'B')
  })

  test('母集団から外れた参加者も履歴として返す', async () => {
    assert.equal(await scalar<number>(db, `
      SELECT count(*)::int FROM v_candidate_population
       WHERE season_id = $1 AND person_id = $2`, [season.id, outsidePersonId]), 0)

    const rows = await listCalendarAttendees(db, appointmentId, season.id)
    assert.ok(rows.some((row) => row.person_id === outsidePersonId))
  })

  test('別の予定の参加者を混ぜない', async () => {
    const rows = await listCalendarAttendees(db, appointmentId, season.id)
    assert.equal(rows.some((row) => row.person_id === otherPersonId), false)
    assert.equal(rows.every((row) => row.person_id !== otherPersonId), true)
  })
})

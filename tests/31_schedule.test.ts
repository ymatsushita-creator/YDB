import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { all, maybeOne, scalar, type Db } from '../src/db/client.ts'
import { baseFixture, makeSeason, makePerson, deletePerson, jst, type Season } from './support/fixtures.ts'

/**
 * 予定（0019）と、手で作るやること（0020）の検証。
 *
 * どちらも**画面の見た目ではなく、記録層と集計定義**を固定する。
 */

const kindId = (db: Db, code: string) =>
  scalar<string>(db, `SELECT id FROM appointment_kinds WHERE code = $1`, [code])

describe('予定（0019）', () => {
  let db: Db
  let staffId: string
  let schoolId: string
  let season: Season
  let personId: string

  before(async () => {
    db = await freshDb()
    const base = await baseFixture(db)
    staffId = base.staffId
    schoolId = base.schoolId
    season = await makeSeason(db, { year: 2026 })
    personId = await makePerson(db, schoolId)
  })

  after(async () => { await db.close() })

  async function add(args: {
    personId?: string | null; code?: string; title?: string
    from?: string; to?: string
  }): Promise<string> {
    return scalar<string>(db, `
      INSERT INTO appointments
        (season_id, person_id, kind_id, title, starts_at, ends_at, owner_staff_id)
      VALUES ($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,$7) RETURNING id`,
    [season.id, args.personId === undefined ? personId : args.personId,
      await kindId(db, args.code ?? 'interview'), args.title ?? '面談',
      args.from ?? jst('2026-05-20T10:00:00'), args.to ?? jst('2026-05-20T11:00:00'), staffId])
  }

  test('終わりが始まりより前の予定は作れない', async () => {
    await assert.rejects(
      () => add({ from: jst('2026-05-20T11:00:00'), to: jst('2026-05-20T10:00:00') }),
      /appointments_range/)
  })

  test('相手の要る種別は、相手なしで作れない', async () => {
    await assert.rejects(
      () => add({ personId: null, code: 'interview' }), /相手/)
  })

  test('相手の要らない種別は、相手なしで作れる', async () => {
    const id = await add({ personId: null, code: 'internal', title: '社内MTG' })
    assert.ok(id)
  })

  test('取り消した予定はカレンダーに出ないが、行としては残る', async () => {
    const id = await add({ title: '流れる面談' })
    const before = await scalar<number>(db,
      `SELECT count(*)::int FROM v_appointments WHERE appointment_id = $1`, [id])
    assert.equal(before, 1)

    await db.query(
      `UPDATE appointments SET cancelled_at = now(), cancel_reason = '先方都合' WHERE id = $1`, [id])

    assert.equal(await scalar<number>(db,
      `SELECT count(*)::int FROM v_appointments WHERE appointment_id = $1`, [id]), 0)
    // 消していない。「空いていた」と「流れた」を区別できる。
    assert.equal(await scalar<number>(db,
      `SELECT count(*)::int FROM appointments WHERE id = $1`, [id]), 1)
  })

  test('取り消しの理由だけを持つ行は作れない', async () => {
    const id = await add({})
    await assert.rejects(
      () => db.query(`UPDATE appointments SET cancel_reason = 'x' WHERE id = $1`, [id]),
      /appointments_cancel_pair/)
  })

  test('個人情報の削除依頼を受けた人の予定は、作れず、既存も出なくなる', async () => {
    const gone = await makePerson(db, schoolId)
    const id = await add({ personId: gone })
    assert.equal(await scalar<number>(db,
      `SELECT count(*)::int FROM v_appointments WHERE appointment_id = $1`, [id]), 1)

    await deletePerson(db, gone, jst('2026-06-01T10:00:00'))

    // 既存の予定はカレンダーから外れる（記録は残る）。
    assert.equal(await scalar<number>(db,
      `SELECT count(*)::int FROM v_appointments WHERE appointment_id = $1`, [id]), 0)
    // 新しくも作れない。
    await assert.rejects(() => add({ personId: gone }), /削除済み/)
  })

  test('変更履歴は更新も削除もできない（追記専用）', async () => {
    const id = await add({})
    await db.query(`
      INSERT INTO appointment_revisions
        (appointment_id, revision_number, season_id, person_id, kind_id, title,
         starts_at, ends_at, owner_staff_id)
      SELECT id, 1, season_id, person_id, kind_id, title, starts_at, ends_at, owner_staff_id
        FROM appointments WHERE id = $1`, [id])
    await assert.rejects(
      () => db.query(`UPDATE appointment_revisions SET title = 'x' WHERE appointment_id = $1`, [id]),
      /append-only/)
    await assert.rejects(
      () => db.query(`DELETE FROM appointment_revisions WHERE appointment_id = $1`, [id]),
      /append-only/)
  })

  test('同じ予定に同じ版番号は2つ置けない', async () => {
    const id = await add({})
    const ins = () => db.query(`
      INSERT INTO appointment_revisions
        (appointment_id, revision_number, season_id, person_id, kind_id, title,
         starts_at, ends_at, owner_staff_id)
      SELECT id, 1, season_id, person_id, kind_id, title, starts_at, ends_at, owner_staff_id
        FROM appointments WHERE id = $1`, [id])
    await ins()
    await assert.rejects(ins, /appointment_revisions_key/)
  })
})

describe('手で作るやること（0020）', () => {
  let db: Db
  let staffId: string
  let schoolId: string
  let season: Season

  before(async () => {
    db = await freshDb()
    const base = await baseFixture(db)
    staffId = base.staffId
    schoolId = base.schoolId
    season = await makeSeason(db, { year: 2026 })
  })

  after(async () => { await db.close() })

  const add = (args: {
    title?: string; dueOffset?: number; dueTime?: string | null
    personId?: string | null; started?: boolean; completed?: boolean
  }) => scalar<string>(db, `
    INSERT INTO manual_tasks
      (season_id, person_id, title, due_on, due_time, owner_staff_id,
       created_by_staff_id, started_at, completed_at)
    VALUES ($1,$2,$3, jst_today() + $4::int, $5::time, $6, $6,
            CASE WHEN $7 THEN now() END, CASE WHEN $8 THEN now() END)
    RETURNING id`,
  [season.id, args.personId ?? null, args.title ?? 'やること',
    args.dueOffset ?? 0, args.dueTime ?? null, staffId,
    args.started ?? false, args.completed ?? false])

  const urgencyOf = (id: string) =>
    maybeOne<{ urgency: string; is_overdue: boolean; is_started: boolean }>(db, `
      SELECT urgency, is_overdue, is_started FROM v_manual_tasks WHERE manual_task_id = $1`, [id])

  test('題名が空白だけの行は作れない', async () => {
    await assert.rejects(() => add({ title: '   ' }), /title_not_blank/)
  })

  test('期限の遠近と着手から、状態を導く（状態カラムを持たない）', async () => {
    const later = await add({ title: '先のこと', dueOffset: 5 })
    const dueToday = await add({ title: '今日のこと', dueOffset: 0 })
    const overdue = await add({ title: '過ぎたこと', dueOffset: -2 })
    const started = await add({ title: '着手したこと', dueOffset: 3, started: true })

    assert.equal((await urgencyOf(later))?.urgency, 'later')
    assert.equal((await urgencyOf(dueToday))?.urgency, 'due')
    assert.equal((await urgencyOf(overdue))?.urgency, 'due')
    assert.equal((await urgencyOf(overdue))?.is_overdue, true)
    assert.equal((await urgencyOf(dueToday))?.is_overdue, false)
    // 着手は期限より優先する。手が動いているものを「まだ」と呼ばない。
    assert.equal((await urgencyOf(started))?.urgency, 'in_progress')
  })

  test('完了したやることは、開いている一覧から外れる（消えはしない）', async () => {
    const id = await add({ title: '終わったこと', started: true, completed: true })
    assert.equal(await scalar<number>(db,
      `SELECT count(*)::int FROM v_manual_tasks WHERE manual_task_id = $1`, [id]), 0)
    assert.equal(await scalar<number>(db,
      `SELECT count(*)::int FROM manual_tasks WHERE id = $1`, [id]), 1)
  })

  test('着手より前に完了した行は作れない', async () => {
    await assert.rejects(() => db.query(`
      INSERT INTO manual_tasks
        (season_id, title, due_on, created_by_staff_id, started_at, completed_at)
      VALUES ($1, 'ねじれ', jst_today(), $2, now(), now() - interval '1 hour')`,
    [season.id, staffId]), /started_before_completed/)
  })

  test('時刻は決まっているときだけ入る（無いことを 00:00 と読み替えない）', async () => {
    const withTime = await add({ title: '時刻あり', dueTime: '14:00' })
    const without = await add({ title: '時刻なし' })
    const rows = await all<{ manual_task_id: string; due_time: string | null }>(db,
      `SELECT manual_task_id, due_time FROM v_manual_tasks WHERE manual_task_id = ANY($1)`,
      [[withTime, without]])
    assert.equal(rows.find((r) => r.manual_task_id === without)?.due_time, null)
    assert.ok(rows.find((r) => r.manual_task_id === withTime)?.due_time)
  })

  test('個人情報の削除依頼を受けた人のやることは、作れず、既存も出なくなる', async () => {
    const gone = await makePerson(db, schoolId)
    const id = await add({ title: '連絡する', personId: gone })
    assert.equal(await scalar<number>(db,
      `SELECT count(*)::int FROM v_manual_tasks WHERE manual_task_id = $1`, [id]), 1)

    await deletePerson(db, gone, jst('2026-06-01T10:00:00'))
    assert.equal(await scalar<number>(db,
      `SELECT count(*)::int FROM v_manual_tasks WHERE manual_task_id = $1`, [id]), 0)
    await assert.rejects(() => add({ title: 'また連絡する', personId: gone }), /削除済み/)
  })

  test('変更履歴は更新も削除もできない（追記専用）', async () => {
    const id = await add({ title: '履歴のもと' })
    await db.query(`
      INSERT INTO manual_task_revisions
        (manual_task_id, revision_number, season_id, title, due_on, changed_by_staff_id)
      VALUES ($1, 1, $2, '履歴のもと', jst_today(), $3)`, [id, season.id, staffId])
    await assert.rejects(
      () => db.query(`UPDATE manual_task_revisions SET title = 'x' WHERE manual_task_id = $1`, [id]),
      /append-only/)
    await assert.rejects(
      () => db.query(`DELETE FROM manual_task_revisions WHERE manual_task_id = $1`, [id]),
      /append-only/)
  })
})

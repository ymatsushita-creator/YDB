import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { one, all, scalar, type Db } from '../src/db/client.ts'
import {
  baseFixture, makeSeason, makePerson, makeApplication, addHistory, accept,
  makeChannel, makeTouchpoint, jst,
} from './support/fixtures.ts'

describe('生涯状態と年度別状態は別物', () => {
  test('前年度に不合格でも、今年度に応募していなければ林に戻る', async () => {
    // 資料2-3「林に期は存在しない。存在するのは、今期の応募母集団として
    // 見たときの林の人数であり、Person に対する期スコープの検索結果である」
    const db = await freshDb()
    const base = await baseFixture(db)
    const s2025 = await makeSeason(db, { year: 2025 })
    const s2026 = await makeSeason(db, { year: 2026 })
    const p = await makePerson(db, base.schoolId, { createdAt: jst('2024-10-01T10:00:00') })

    const app = await makeApplication(db, p, s2025.id, jst('2024-11-10T09:00:00'))
    await addHistory(db, {
      applicationId: app, type: 'reject', staffId: base.staffId,
      occurredAt: jst('2024-12-20T10:00:00'),
    })

    const levels = Object.fromEntries(
      (await all<{ enrollment_year: number; current_level: string }>(
        db,
        `SELECT enrollment_year, current_level FROM v_person_season_state WHERE person_id = $1`,
        [p],
      )).map((r) => [r.enrollment_year, r.current_level]),
    )
    assert.equal(levels[2025], 'applicant', '応募した年度では木')
    assert.equal(levels[2026], 'identified_person', '応募していない年度では林')

    const lifetime = await one<Record<string, unknown>>(
      db, `SELECT * FROM v_person_lifetime_summary WHERE person_id = $1`, [p])
    assert.equal(lifetime.has_ever_applied, true, '生涯では応募経験あり')
    assert.equal(lifetime.has_ever_been_accepted, false)
    assert.equal(Number(lifetime.application_count), 1)
    await db.close()
  })

  test('合格した年度は幹になる', async () => {
    const db = await freshDb()
    const base = await baseFixture(db)
    const s = await makeSeason(db, { year: 2026 })
    const p = await makePerson(db, base.schoolId, { createdAt: jst('2025-10-01T10:00:00') })
    const app = await makeApplication(db, p, s.id, jst('2025-11-10T09:00:00'))
    await accept(db, { applicationId: app, season: s, staffId: base.staffId, occurredAt: jst('2025-12-20T10:00:00') })

    const row = await one<{ current_level: string; is_accepted_in_season: boolean }>(
      db, `SELECT current_level, is_accepted_in_season FROM v_person_season_state
            WHERE person_id = $1 AND season_id = $2`, [p, s.id])
    assert.equal(row.current_level, 'accepted')
    assert.equal(row.is_accepted_in_season, true)
    await db.close()
  })

  test('選考終了後に識別された Person は、その年度には現れない', async () => {
    const db = await freshDb()
    const base = await baseFixture(db)
    const s2025 = await makeSeason(db, { year: 2025 })   // 選考終了 2025-02-28
    const s2026 = await makeSeason(db, { year: 2026 })
    const p = await makePerson(db, base.schoolId, { createdAt: jst('2025-06-01T10:00:00') })

    const years = (await all<{ enrollment_year: number }>(
      db, `SELECT enrollment_year FROM v_person_season_state WHERE person_id = $1`, [p]
    )).map((r) => r.enrollment_year)
    assert.deepEqual(years, [2026], '2025年度の選考は終わっている')
    await db.close()
  })

  test('最終接触日は導出であり、どこにも保存されていない', async () => {
    // 原則1。persons に last_touch_at カラムがないことを構造として確かめる。
    const db = await freshDb()
    const cols = (await all<{ column_name: string }>(
      db,
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'persons' AND table_schema = 'public'`,
    )).map((r) => r.column_name)

    for (const forbidden of ['last_touch_at', 'current_stage', 'origin_partner_id', 'is_accepted']) {
      assert.equal(cols.includes(forbidden), false, `persons.${forbidden} は導出値。物理保存しない`)
    }

    const base = await baseFixture(db)
    const p = await makePerson(db, base.schoolId)
    const ch = await makeChannel(db, 'イベント')
    await makeTouchpoint(db, p, ch, jst('2025-10-01T10:00:00'))
    await makeTouchpoint(db, p, ch, jst('2025-11-15T10:00:00'))

    const last = await scalar<Date>(
      db, `SELECT last_touch_at FROM v_person_lifetime_summary WHERE person_id = $1`, [p])
    assert.equal(new Date(last).toISOString(), new Date(jst('2025-11-15T10:00:00')).toISOString())
    await db.close()
  })
})

describe('利益相反の検出', () => {
  test('紹介者が面接官のとき検出される', async () => {
    const db = await freshDb()
    const base = await baseFixture(db)
    const s = await makeSeason(db, { year: 2026 })

    const alumni = await makePerson(db, base.schoolId, { givenName: '卒業生' })
    const alumniStaff = await scalar<string>(
      db, `INSERT INTO staffs (person_id, display_name, email)
           VALUES ($1, '卒業生 面接官', 'alumni@example.test') RETURNING id`, [alumni])
    const applicant = await makePerson(db, base.schoolId, { referrerPersonId: alumni })
    const app = await makeApplication(db, applicant, s.id, jst('2025-11-10T09:00:00'))
    await db.query(
      `INSERT INTO evaluations (application_id, selection_step_id, interviewer_staff_id)
       VALUES ($1, $2, $3)`, [app, s.stepIds[0], alumniStaff])

    const rows = await all<{ conflict_type: string }>(
      db, `SELECT conflict_type FROM v_conflict_of_interest`)
    assert.deepEqual(rows.map((r) => r.conflict_type), ['referrer'])
    await db.close()
  })

  test('面接官と応募者が同一人物のとき検出される', async () => {
    // 卒業生スタッフが再応募すれば起こりうる。紹介より直接的な相反。
    const db = await freshDb()
    const base = await baseFixture(db)
    const s = await makeSeason(db, { year: 2026 })

    const person = await makePerson(db, base.schoolId)
    const selfStaff = await scalar<string>(
      db, `INSERT INTO staffs (person_id, display_name, email)
           VALUES ($1, '本人', 'self@example.test') RETURNING id`, [person])
    const app = await makeApplication(db, person, s.id, jst('2025-11-10T09:00:00'))
    await db.query(
      `INSERT INTO evaluations (application_id, selection_step_id, interviewer_staff_id)
       VALUES ($1, $2, $3)`, [app, s.stepIds[0], selfStaff])

    const rows = await all<{ conflict_type: string }>(
      db, `SELECT conflict_type FROM v_conflict_of_interest`)
    assert.deepEqual(rows.map((r) => r.conflict_type), ['self'])
    await db.close()
  })
})

describe('アトリビューション', () => {
  test('初回接触・最終接触・線形の3方式が一致した人数を返す', async () => {
    const db = await freshDb()
    const base = await baseFixture(db)
    await makeSeason(db, { year: 2026 })  // outreach 2025-09-01 〜 2026-02-28
    const p = await makePerson(db, base.schoolId, { createdAt: jst('2025-09-05T10:00:00') })
    const a = await makeChannel(db, 'SNS広告')
    const b = await makeChannel(db, '学校訪問')

    await makeTouchpoint(db, p, a, jst('2025-09-10T10:00:00'))
    await makeTouchpoint(db, p, b, jst('2025-10-10T10:00:00'))
    await makeTouchpoint(db, p, b, jst('2025-10-20T10:00:00'))

    assert.equal(await scalar(db, `SELECT channel_id FROM v_attribution_first`), a)
    assert.equal(await scalar(db, `SELECT channel_id FROM v_attribution_last`), b)

    const linear = await all<{ channel_id: string; weight: string }>(
      db, `SELECT channel_id, weight FROM v_attribution_linear ORDER BY weight`)
    const total = linear.reduce((s, r) => s + Number(r.weight), 0)
    assert.equal(total, 1, '線形按分の重みの合計は実人数と一致する')
    assert.equal(Number(linear.find((r) => r.channel_id === b)!.weight), 2 / 3)
    await db.close()
  })

  test('同時刻の接点があっても結果が揺れない', async () => {
    // DISTINCT ON の順序が同値だと、実行のたびに勝つ行が変わりうる。
    const db = await freshDb()
    const base = await baseFixture(db)
    await makeSeason(db, { year: 2026 })
    const p = await makePerson(db, base.schoolId, { createdAt: jst('2025-09-05T10:00:00') })
    const a = await makeChannel(db, 'A')
    const b = await makeChannel(db, 'B')
    const at = jst('2025-09-10T10:00:00')
    await makeTouchpoint(db, p, a, at)
    await makeTouchpoint(db, p, b, at)

    const seen = new Set<string>()
    for (let i = 0; i < 5; i++) {
      seen.add(await scalar<string>(db, `SELECT channel_id FROM v_attribution_first`))
    }
    assert.equal(seen.size, 1, '何度引いても同じチャネルが選ばれる')
    await db.close()
  })

  test('どの年度にも属さない接点は未割当として残る', async () => {
    const db = await freshDb()
    const base = await baseFixture(db)
    await makeSeason(db, { year: 2026 })   // 2025-09-01 〜 2026-02-28
    const p = await makePerson(db, base.schoolId, { createdAt: jst('2025-01-01T10:00:00') })
    const ch = await makeChannel(db, '飛び込み')
    await makeTouchpoint(db, p, ch, jst('2025-03-01T10:00:00'))  // どの Season の範囲外

    const seasonId = await scalar<string | null>(
      db, `SELECT season_id FROM v_touchpoint_season WHERE person_id = $1`, [p])
    assert.equal(seasonId, null, '(4)で「未割当」として表示する対象')
    await db.close()
  })
})

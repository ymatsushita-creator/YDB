import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { all, maybeOne, scalar, type Db } from '../src/db/client.ts'
import { addCandidate } from '../src/commands/intake.ts'
import { addPersonNote, parseJstDateTime } from '../src/commands/note.ts'
import { setEventAttendance } from '../src/commands/attend.ts'
import { listPersonNotes, listAttendanceCandidates } from '../src/queries/borderline.ts'
import { deletePerson } from './support/fixtures.ts'

/**
 * メモと予定の参加者（実行⑪。依頼者の指示）。
 *
 * 固定したいのは6つ ――
 *   ① メモは**書いた人・日時・内容がそろわないと入らない**
 *   ② メモは追記専用。**書き換えられない。**訂正は打ち消し行
 *   ③ 手入力の日時は **JST** として読む（置き場所の時間帯で9時間ずれない）
 *   ④ 参加のチェックは**接点として積まれる**（確度の材料になる）
 *   ⑤ 外すとその接点は消える。**残すと確度が数え続ける**
 *   ⑥ チェックできるのは**一覧に居る人だけ**。一覧から外れた人の記録は
 *      保存で黙って消えない
 */

const EMPTY_CANDIDATE = {
  familyName: '', givenName: '', familyNameKana: '', givenNameKana: '',
  birthDate: '', faculty: '', email: '', phone: '', lineUserId: '',
  note: '', contactedOn: '', formResponseId: '',
}

describe('メモと参加者', () => {
  let db: Db
  let seasonId: string
  let schoolId: string
  let staffId: string
  let channelId: string
  let appointmentId: string

  const addPerson = async (name: string): Promise<string> => {
    const r = await addCandidate(db, {
      ...EMPTY_CANDIDATE,
      seasonId, schoolId, staffId, channelId,
      familyName: name, givenName: '架空',
    })
    assert.equal(r.ok, true, `候補者が作れない: ${name}`)
    if (!r.ok) throw new Error('unreachable')
    return r.personId
  }

  before(async () => {
    db = await freshDb({ seeds: 'production' })
    seasonId = await scalar<string>(db, `SELECT id FROM seasons WHERE cohort_number = 2`)
    schoolId = await scalar<string>(db,
      `INSERT INTO schools (name) VALUES ('架空メモ高校') RETURNING id`)
    staffId = await scalar<string>(db, `
      INSERT INTO staffs (display_name, email)
      VALUES ('架空 運営', 'notes@example.test') RETURNING id`)
    channelId = await scalar<string>(db, `SELECT id FROM channels WHERE name = 'LINE'`)
    // 相手の要らない予定（社内MTG）をイベントとして使う。
    appointmentId = await scalar<string>(db, `
      INSERT INTO appointments (season_id, kind_id, title, starts_at, ends_at, owner_staff_id)
      SELECT $1, k.id, '架空イベント',
             TIMESTAMPTZ '2026-03-10 13:00+09', TIMESTAMPTZ '2026-03-10 15:00+09', $2
        FROM appointment_kinds k WHERE k.code = 'internal'
      RETURNING id`, [seasonId, staffId])
  })

  after(async () => { await db.close() })

  // -----------------------------------------------------------
  // ① 記入必須
  // -----------------------------------------------------------
  test('★ 書いた人・日時・内容がそろえば1件入る', async () => {
    const personId = await addPerson('架空一')
    const r = await addPersonNote(db, {
      personId,
      authorName: '増田',
      notedAt: '2026-03-01T14:30',
      body: '面談。地元で起業したいと話していた。',
    })
    assert.equal(r.ok, true)

    const notes = await listPersonNotes(db, personId)
    assert.equal(notes.length, 1)
    assert.equal(notes[0]!.author_name, '増田')
    assert.equal(notes[0]!.body, '面談。地元で起業したいと話していた。')
  })

  test('★ 空白だけの「必須項目」を通さない', async () => {
    const personId = await addPerson('架空二')
    const base = { personId, authorName: '増田', notedAt: '2026-03-01T14:30', body: '本文' }

    for (const [over, reason] of [
      [{ authorName: '' }, 'author_required'],
      [{ authorName: '   ' }, 'author_required'],
      [{ body: '' }, 'body_required'],
      [{ body: '  \n ' }, 'body_required'],
      [{ notedAt: '' }, 'noted_at_required'],
    ] as const) {
      const r = await addPersonNote(db, { ...base, ...over })
      assert.equal(r.ok, false, JSON.stringify(over))
      if (!r.ok) assert.equal(r.reason, reason)
    }
    assert.equal((await listPersonNotes(db, personId)).length, 0)
  })

  test('日時が読めない・暦に無い日・未来すぎるものは弾く', async () => {
    const personId = await addPerson('架空三')
    const base = { personId, authorName: '増田', body: '本文' }

    for (const [notedAt, reason] of [
      ['きのう', 'noted_at_invalid'],
      ['2026-03-01', 'noted_at_invalid'],
      // 2月31日は Date が3月へ繰り上げる。**黙って別の日にしない。**
      ['2026-02-31T10:00', 'noted_at_invalid'],
      ['2099-01-01T00:00', 'noted_at_future'],
    ] as const) {
      const r = await addPersonNote(db, { ...base, notedAt })
      assert.equal(r.ok, false, notedAt)
      if (!r.ok) assert.equal(r.reason, reason, notedAt)
    }
  })

  test('★ 手入力の日時は JST として読む', () => {
    // 置き場所（Vercel は UTC）の時間帯で読むと9時間ずれる。
    assert.equal(parseJstDateTime('2026-03-01T09:00')?.toISOString(),
      '2026-03-01T00:00:00.000Z')
    assert.equal(parseJstDateTime('2026-03-01T00:00')?.toISOString(),
      '2026-02-28T15:00:00.000Z')
    assert.equal(parseJstDateTime('2026-02-31T10:00'), null)
  })

  test('削除済みの候補者にはメモを足せない', async () => {
    const personId = await addPerson('架空四')
    await deletePerson(db, personId, '2026-03-05T10:00:00+09:00')
    const r = await addPersonNote(db, {
      personId, authorName: '増田', notedAt: '2026-03-01T14:30', body: '本文',
    })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.reason, 'person_deleted')
  })

  // -----------------------------------------------------------
  // ② 追記専用
  // -----------------------------------------------------------
  test('★ メモは書き換えられない（追記専用）', async () => {
    const personId = await addPerson('架空五')
    const r = await addPersonNote(db, {
      personId, authorName: '増田', notedAt: '2026-03-01T14:30', body: '最初の記録',
    })
    assert.equal(r.ok, true)
    if (!r.ok) return

    await assert.rejects(
      db.query(`UPDATE person_notes SET body = '書き換え' WHERE id = $1`, [r.noteId]),
      /append-only/)
    await assert.rejects(
      db.query(`DELETE FROM person_notes WHERE id = $1`, [r.noteId]),
      /append-only/)
  })

  test('★ 訂正は打ち消し行。訂正を訂正すれば元が戻る', async () => {
    const personId = await addPerson('架空六')
    const first = await addPersonNote(db, {
      personId, authorName: '増田', notedAt: '2026-03-01T14:30', body: '人違いの記録',
    })
    assert.equal(first.ok, true)
    if (!first.ok) return
    assert.equal((await listPersonNotes(db, personId)).length, 1)

    // 打ち消す。**打ち消し行が元に取って代わる**（0016 と同じ判定）。
    // 元の行は記録層に残るが、有効なメモからは消える。
    const undo = await addPersonNote(db, {
      personId, authorName: '増田', notedAt: '2026-03-02T09:00',
      body: '人違いだった。取り消す。', correctsNoteId: first.noteId,
    })
    assert.equal(undo.ok, true)
    if (!undo.ok) return
    assert.deepEqual((await listPersonNotes(db, personId)).map((n) => n.body),
      ['人違いだった。取り消す。'], '打ち消された行は有効なメモから消える')
    assert.equal(await scalar<number>(db,
      `SELECT count(*)::int FROM person_notes WHERE person_id = $1`, [personId]), 2,
    '元の行は消えない')

    // 打ち消しを打ち消せば、元が戻る（会計の逆仕訳と同じ）。
    const redo = await addPersonNote(db, {
      personId, authorName: '増田', notedAt: '2026-03-03T09:00',
      body: 'やはり本人だった。', correctsNoteId: undo.noteId,
    })
    assert.equal(redo.ok, true)
    const back = await listPersonNotes(db, personId)
    assert.deepEqual(back.map((n) => n.body).sort(),
      ['やはり本人だった。', '人違いの記録'].sort())
  })

  // -----------------------------------------------------------
  // ④⑤⑥ 参加者
  // -----------------------------------------------------------
  test('★ チェックすると接点が1件積まれる（確度の材料になる）', async () => {
    const a = await addPerson('架空七')
    const b = await addPerson('架空八')

    const before = await scalar<number>(db,
      `SELECT count(*)::int FROM touchpoints WHERE person_id = $1`, [a])

    const r = await setEventAttendance(db, {
      appointmentId, seasonId, personIds: [a, b],
    })
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.equal(r.added, 2)

    const after = await scalar<number>(db,
      `SELECT count(*)::int FROM touchpoints WHERE person_id = $1`, [a])
    assert.equal(after, before + 1, '接点が1件増える')

    // 接点の時刻は**予定の開始時刻**。押した日ではない。
    const tp = await maybeOne<{ occurred_at: Date; attended_at: Date | null }>(db, `
      SELECT t.occurred_at, t.attended_at
        FROM v_event_attendance ea
        JOIN touchpoints t ON t.id = ea.touchpoint_id
       WHERE ea.appointment_id = $1 AND ea.person_id = $2`, [appointmentId, a])
    assert.ok(tp)
    assert.equal(new Date(tp!.occurred_at).toISOString(), '2026-03-10T04:00:00.000Z')
    assert.ok(tp!.attended_at, '参加した事実として attended_at が立つ')

    // ★ 確度が数える接点として見える（`v_scoring_facts` は touchpoints を数える）。
    //   これが**「後でそれを確度にする」の実体**である。語彙は足していない。
    //   期に帰属する接点だけが数えられるので、この予定（3/10）の分が載る。
    const facts = await maybeOne<{ touchpoint_count: string }>(db, `
      SELECT touchpoint_count FROM v_scoring_facts
       WHERE person_id = $1 AND season_id = $2`, [a, seasonId])
    assert.ok(Number(facts?.touchpoint_count) >= 1, '確度の材料に載る')
  })

  test('★ 同じ集合をもう一度保存しても、接点は増えない', async () => {
    const listed = await listAttendanceCandidates(db, appointmentId, seasonId)
    const checked = listed.filter((c) => c.attended).map((c) => c.person_id)
    assert.ok(checked.length > 0)

    const before = await scalar<number>(db, `SELECT count(*)::int FROM touchpoints`)
    const r = await setEventAttendance(db, { appointmentId, seasonId, personIds: checked })
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.deepEqual([r.added, r.removed], [0, 0])
    assert.equal(await scalar<number>(db, `SELECT count(*)::int FROM touchpoints`), before)
  })

  test('★ チェックを外すと、その接点は消える', async () => {
    const person = await addPerson('架空九')
    const on = await setEventAttendance(db, {
      appointmentId, seasonId, personIds: [person],
    })
    assert.equal(on.ok, true)

    const touchpointId = await scalar<string>(db, `
      SELECT touchpoint_id FROM event_attendances
       WHERE appointment_id = $1 AND person_id = $2`, [appointmentId, person])

    // いま入っている人から、この人だけを外す。
    const stillOn = (await listAttendanceCandidates(db, appointmentId, seasonId))
      .filter((c) => c.attended && c.person_id !== person)
      .map((c) => c.person_id)
    const off = await setEventAttendance(db, {
      appointmentId, seasonId, personIds: stillOn,
    })
    assert.equal(off.ok, true)
    if (!off.ok) return
    assert.equal(off.removed, 1)

    assert.equal(await maybeOne(db,
      `SELECT 1 FROM touchpoints WHERE id = $1`, [touchpointId]), null,
    '接点が残ると、確度が数え続ける')
    assert.equal(await maybeOne(db, `
      SELECT 1 FROM event_attendances WHERE appointment_id = $1 AND person_id = $2`,
    [appointmentId, person]), null, '対応づけも消える（ON DELETE CASCADE）')
  })

  test('一覧に無い人・取り消された予定は弾く', async () => {
    const stranger = await scalar<string>(db, `
      INSERT INTO persons (family_name, given_name, birth_date, school_id, email)
      VALUES ('架空', '圏外', DATE '2004-04-01', $1, 'outside@example.test')
      RETURNING id`, [schoolId])

    const r = await setEventAttendance(db, {
      appointmentId, seasonId, personIds: [stranger],
    })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.reason, 'person_not_listed')

    const cancelled = await scalar<string>(db, `
      INSERT INTO appointments
        (season_id, kind_id, title, starts_at, ends_at, owner_staff_id, cancelled_at)
      SELECT $1, k.id, '架空・取り消し済み',
             TIMESTAMPTZ '2026-03-11 13:00+09', TIMESTAMPTZ '2026-03-11 14:00+09',
             $2, now()
        FROM appointment_kinds k WHERE k.code = 'internal'
      RETURNING id`, [seasonId, staffId])
    const c = await setEventAttendance(db, {
      appointmentId: cancelled, seasonId, personIds: [],
    })
    assert.equal(c.ok, false)
    if (!c.ok) assert.equal(c.reason, 'appointment_cancelled')
  })

  test('★ 一覧から外れた人の参加記録は、保存で黙って消えない', async () => {
    // 見送りにすると `v_headhunting_list` から外れ、チェック欄にも並ばない。
    // 並ばない＝送られてこない。ここを「外した」と読むと記録が消える。
    const person = await addPerson('架空十')
    const on = await setEventAttendance(db, {
      appointmentId, seasonId, personIds: [person],
    })
    assert.equal(on.ok, true)

    await db.query(`
      INSERT INTO approach_events
        (person_id, season_id, approach_state_id, occurred_at, recorded_by_staff_id)
      SELECT $1, $2, s.id, now(), $3
        FROM approach_states s WHERE s.is_terminal LIMIT 1`,
    [person, seasonId, staffId])

    const listed = await listAttendanceCandidates(db, appointmentId, seasonId)
    assert.equal(listed.some((c) => c.person_id === person), false,
      '一覧から外れた人はチェック欄に並ばない')

    const keep = listed.filter((c) => c.attended).map((c) => c.person_id)
    const r = await setEventAttendance(db, { appointmentId, seasonId, personIds: keep })
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.equal(r.removed, 0)

    const rows = await all(db, `
      SELECT 1 FROM event_attendances WHERE appointment_id = $1 AND person_id = $2`,
    [appointmentId, person])
    assert.equal(rows.length, 1, '一覧から外れても参加の記録は残る')
  })
})

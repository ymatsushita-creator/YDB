import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { scalar, maybeOne, type Db } from '../src/db/client.ts'
import {
  baseFixture, makeSeason, makePerson, makeApplication, addHistory,
  jst, type Fixture, type Season,
} from './support/fixtures.ts'
import {
  assignInterviewer, listAssignableStaff, ASSIGN_FAILURE_MESSAGE,
} from '../src/commands/assign.ts'

/**
 * 初めての書き込み操作の検証。
 *
 * 読み取りと書き込みで、間違えたときの重さが違う。読み取りは母集団を
 * 間違えても数字がずれるだけだが、書き込みは記録そのものを壊す。
 * だからここで確かめるのは「正しく更新できるか」より
 * **「更新できてはいけないものを弾くか」**である。
 *
 * 弾くべきものは、画面に出ていない評価すべてである。フォームの
 * `evaluation_id` は誰でも書き換えられるので、画面に出ていないものを
 * 触れないことは UI ではなくこの層で担保しなければならない。
 */

let db: Db
let fx: Fixture
let season: Season
let interviewer: string

/** 判断待ち・担当未割当の評価を1件作って返す。 */
async function pendingUnassigned(opts: { voided?: boolean; rejected?: boolean } = {}) {
  const person = await makePerson(db, fx.schoolId)
  const app = await makeApplication(db, person, season.id, jst('2025-11-01T20:00:00'))
  const evaluationId = await scalar<string>(db, `
    INSERT INTO evaluations (application_id, selection_step_id, state, assigned_at)
    VALUES ($1, $2, 'pending', $3) RETURNING id`,
    [app, season.stepIds[0], jst('2025-11-02T10:00:00')])

  if (opts.rejected) {
    await addHistory(db, {
      applicationId: app, type: 'reject', staffId: fx.staffId,
      occurredAt: jst('2025-11-20T19:00:00'),
    })
  }
  if (opts.voided) {
    const reason = await scalar<string>(db, `
      INSERT INTO void_reasons (code, label, counts_as_application)
      VALUES ('withdrawn_17_' || left(md5(random()::text), 6), '選考前の取り下げ', true)
      RETURNING id`)
    await db.query(
      `UPDATE applications SET voided_at = $2, void_reason_id = $3 WHERE id = $1`,
      [app, jst('2025-11-10T10:00:00'), reason])
  }
  return { person, app, evaluationId }
}

const ownerOf = (evaluationId: string) =>
  maybeOne<{ interviewer_staff_id: string | null }>(db,
    `SELECT interviewer_staff_id FROM evaluations WHERE id = $1`, [evaluationId])
    .then((r) => r?.interviewer_staff_id ?? null)

before(async () => {
  db = await freshDb()
  fx = await baseFixture(db)
  season = await makeSeason(db, { year: 2026 })
  interviewer = await scalar<string>(db, `
    INSERT INTO staffs (display_name, email) VALUES ('面接官 一郎', 'i1@example.test')
    RETURNING id`)
})

after(async () => { await db.close() })

describe('担当を決める', () => {
  test('判断待ちで担当未割当の評価に、面接官を1人割り当てられる', async () => {
    const { evaluationId } = await pendingUnassigned()
    assert.equal(await ownerOf(evaluationId), null)

    const result = await assignInterviewer(db, { evaluationId, staffId: interviewer })
    assert.equal(result.ok, true)
    assert.equal(result.ok && result.staffName, '面接官 一郎')
    assert.equal(await ownerOf(evaluationId), interviewer)
  })

  test('割り当てると、やることが「担当を決める」から「評価する」に変わる', async () => {
    // 画面に出るものと、操作の結果が同じ述語で動いていることの確認。
    // ここがずれると、割り当てたのに催促が消えない。
    const { evaluationId } = await pendingUnassigned()
    const kindOf = () => scalar<string>(db,
      `SELECT kind FROM v_open_tasks WHERE source_id = $1`, [evaluationId])

    assert.equal(await kindOf(), 'assign')
    await assignInterviewer(db, { evaluationId, staffId: interviewer })
    assert.equal(await kindOf(), 'evaluate')
  })

  test('担当が決まっている評価は、黙って上書きしない', async () => {
    const { evaluationId } = await pendingUnassigned()
    await assignInterviewer(db, { evaluationId, staffId: interviewer })

    const other = await scalar<string>(db, `
      INSERT INTO staffs (display_name, email) VALUES ('面接官 二郎', 'i2@example.test')
      RETURNING id`)
    const result = await assignInterviewer(db, { evaluationId, staffId: other })

    assert.equal(result.ok, false)
    assert.equal(!result.ok && result.reason, 'already_assigned')
    assert.equal(await ownerOf(evaluationId), interviewer, '先に決まった担当が残る')
  })
})

describe('割り当ててはいけないもの', () => {
  test('取り下げられた応募（数えるが、動いていない）は割り当てられない', async () => {
    // A-14 と同じ母集団の話。画面（v_open_tasks）に出ていないものは
    // 操作もできない。ここを evaluations 直結にすると、id を直打ちすれば
    // 触れてしまう。
    const { evaluationId } = await pendingUnassigned({ voided: true })
    assert.equal(Number(await scalar<string>(db,
      `SELECT count(*) FROM v_open_tasks WHERE source_id = $1`, [evaluationId])), 0,
      '画面に出ていない評価であることを先に確かめる')

    const result = await assignInterviewer(db, { evaluationId, staffId: interviewer })
    assert.equal(!result.ok && result.reason, 'not_active')
    assert.equal(await ownerOf(evaluationId), null)
  })

  test('不合格になった応募は割り当てられない', async () => {
    const { evaluationId } = await pendingUnassigned({ rejected: true })
    const result = await assignInterviewer(db, { evaluationId, staffId: interviewer })
    assert.equal(!result.ok && result.reason, 'not_active')
    assert.equal(await ownerOf(evaluationId), null)
  })

  test('個人情報削除を受けた人の評価は割り当てられない', async () => {
    const { person, evaluationId } = await pendingUnassigned()
    await db.query(`UPDATE persons SET deleted_at = now() WHERE id = $1`, [person])

    const result = await assignInterviewer(db, { evaluationId, staffId: interviewer })
    assert.equal(!result.ok && result.reason, 'not_active')
    assert.equal(await ownerOf(evaluationId), null)
  })

  test('非活性化された職員は担当にできない', async () => {
    const { evaluationId } = await pendingUnassigned()
    const retired = await scalar<string>(db, `
      INSERT INTO staffs (display_name, email, is_active)
      VALUES ('退任 三郎', 'i3@example.test', false) RETURNING id`)

    const result = await assignInterviewer(db, { evaluationId, staffId: retired })
    assert.equal(!result.ok && result.reason, 'staff_not_available')
    assert.equal(await ownerOf(evaluationId), null,
      '誰も見ていない評価を作らない')
  })

  test('提出済みの評価は割り当てられない', async () => {
    const person = await makePerson(db, fx.schoolId)
    const app = await makeApplication(db, person, season.id, jst('2025-11-01T20:00:00'))
    const submitted = await scalar<string>(db, `
      INSERT INTO evaluations (application_id, selection_step_id, state,
                               assigned_at, submitted_at)
      VALUES ($1,$2,'submitted',$3,$4) RETURNING id`,
      [app, season.stepIds[0], jst('2025-11-02T10:00:00'), jst('2025-11-05T10:00:00')])

    const result = await assignInterviewer(db, { evaluationId: submitted, staffId: interviewer })
    assert.equal(!result.ok && result.reason, 'not_active')
  })

  test('壊れた id は 500 にせず、見つからないで返す', async () => {
    // フォームの hidden も URL も、利用者が自由に書ける。UUID でない値を
    // SQL に渡すと invalid input syntax で落ちる（A-13 / getSeason と同じ）。
    for (const bad of ['', 'not-a-uuid', "'; DROP TABLE evaluations; --"]) {
      const result = await assignInterviewer(db, { evaluationId: bad, staffId: interviewer })
      assert.equal(!result.ok && result.reason, 'evaluation_not_found', `id=${bad}`)
    }
    const badStaff = await assignInterviewer(db, {
      evaluationId: '00000000-0000-0000-0000-000000000000', staffId: 'nope',
    })
    assert.equal(!badStaff.ok && badStaff.reason, 'staff_not_available')

    // 表がまだ在ることを確かめる（上の文字列が実行されていないこと）。
    assert.ok(Number(await scalar<string>(db, `SELECT count(*) FROM evaluations`)) > 0)
  })

  test('失敗の理由には、すべて画面に出す言葉がある', async () => {
    // 理由を増やしたのに文言を足し忘れると、画面が undefined を出す。
    const reasons = ['evaluation_not_found', 'already_assigned',
      'not_active', 'staff_not_available'] as const
    for (const r of reasons) {
      assert.equal(typeof ASSIGN_FAILURE_MESSAGE[r], 'string')
      assert.ok(ASSIGN_FAILURE_MESSAGE[r].length > 0, r)
    }
    assert.equal(Object.keys(ASSIGN_FAILURE_MESSAGE).length, reasons.length,
      '文言の数と理由の数が合っていない')
  })
})

describe('担当に選べる面接官', () => {
  test('非活性化された職員は候補に出ない', async () => {
    const staff = await listAssignableStaff(db, season.id)
    const names = staff.map((s) => s.display_name)
    assert.ok(names.includes('面接官 一郎'))
    assert.ok(!names.includes('退任 三郎'), '非活性化した職員を選ばせない')
  })

  test('抱えている判断待ちの件数が付いてくる（少ない順）', async () => {
    // 偏りが見えないと割り当てられない。/operations の面接官別の負荷と
    // 同じ目的だが、こちらは選ぶ場で見せる。
    const staff = await listAssignableStaff(db, season.id)
    const counts = staff.map((s) => Number(s.pending))
    assert.deepEqual(counts, [...counts].sort((a, b) => a - b), '少ない順に並ぶ')

    const ichiro = staff.find((s) => s.display_name === '面接官 一郎')!
    assert.ok(Number(ichiro.pending) >= 1, '割り当てた分が件数に乗る')
  })
})

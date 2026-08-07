import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { scalar, maybeOne, type Db } from '../src/db/client.ts'
import {
  baseFixture, makeSeason, makePerson, makeApplication, addHistory,
  jst, type Fixture, type Season,
} from './support/fixtures.ts'
import {
  unholdEvaluation, UNHOLD_CODE_MESSAGE, parseUnholdCode,
} from '../src/commands/unhold.ts'

/**
 * 保留を解く操作の検証。
 *
 * いちばん確かめたいのは **何も失われないこと**である。
 * `REPORT-6.2.md` では「解くと必須で入っていた理由が消える」と書いたが、
 * 制約は「保留なら理由が要る」であって「保留でなければ持てない」ではない。
 * 解いても `hold_reason` を残せる。そこが崩れると、なぜ止まっていたかが
 * 記録から消えるので、機械で固定する。
 */

let db: Db
let fx: Fixture
let season: Season
let interviewer: string

const HOLD_REASON = '追加提出を依頼して返答待ち'

/** 保留の評価を1件作って返す。 */
async function heldEvaluation(opts: {
  withOwner?: boolean
  voided?: boolean
  rejected?: boolean
} = {}) {
  const person = await makePerson(db, fx.schoolId)
  const app = await makeApplication(db, person, season.id, jst('2025-11-01T20:00:00'))
  const evaluationId = await scalar<string>(db, `
    INSERT INTO evaluations (application_id, selection_step_id, interviewer_staff_id,
                             state, assigned_at, hold_reason)
    VALUES ($1, $2, $3, 'held', $4, $5) RETURNING id`,
    [app, season.stepIds[0], opts.withOwner === false ? null : interviewer,
     jst('2025-11-02T10:00:00'), HOLD_REASON])

  if (opts.rejected) {
    await addHistory(db, {
      applicationId: app, type: 'reject', staffId: fx.staffId,
      occurredAt: jst('2025-11-20T19:00:00'),
    })
  }
  if (opts.voided) {
    const reason = await scalar<string>(db, `
      INSERT INTO void_reasons (code, label, counts_as_application)
      VALUES ('withdrawn_18_' || left(md5(random()::text), 6), '選考前の取り下げ', true)
      RETURNING id`)
    await db.query(
      `UPDATE applications SET voided_at = $2, void_reason_id = $3 WHERE id = $1`,
      [app, jst('2025-11-10T10:00:00'), reason])
  }
  return { person, app, evaluationId }
}

const stateOf = (evaluationId: string) =>
  maybeOne<{ state: string; hold_reason: string | null }>(db,
    `SELECT state, hold_reason FROM evaluations WHERE id = $1`, [evaluationId])

before(async () => {
  db = await freshDb()
  fx = await baseFixture(db)
  season = await makeSeason(db, { year: 2026 })
  interviewer = await scalar<string>(db, `
    INSERT INTO staffs (display_name, email) VALUES ('面接官 一郎', 'u1@example.test')
    RETURNING id`)
})

after(async () => { await db.close() })

describe('保留を解く', () => {
  test('判断待ちに戻り、理由はそのまま残る', async () => {
    // **これがこの機能の要点である。** 消すと「なぜ止まっていたか」が
    // 記録から失われる。原則5（元の記録は残す）と同じ考え方。
    const { evaluationId } = await heldEvaluation()
    const result = await unholdEvaluation(db, { evaluationId })

    assert.equal(result.ok, true)
    const after = await stateOf(evaluationId)
    assert.equal(after?.state, 'pending')
    assert.equal(after?.hold_reason, HOLD_REASON, '解いても理由を消さない')
  })

  test('解くと、やることが「保留を解く」から「評価する」に変わる', async () => {
    const { evaluationId } = await heldEvaluation()
    const kindOf = () => scalar<string>(db,
      `SELECT kind FROM v_open_tasks WHERE source_id = $1`, [evaluationId])

    assert.equal(await kindOf(), 'unhold')
    await unholdEvaluation(db, { evaluationId })
    assert.equal(await kindOf(), 'evaluate')
  })

  test('担当が決まっていない保留を解くと、「担当を決める」になる', async () => {
    // 解いた先が何になるかは state と担当の有無から導かれる。
    // 「解いたら必ず評価待ち」と決め打ちにしない（原則7）。
    const { evaluationId } = await heldEvaluation({ withOwner: false })
    const result = await unholdEvaluation(db, { evaluationId })
    assert.equal(result.ok && result.nextOwner, null)
    assert.equal(await scalar<string>(db,
      `SELECT kind FROM v_open_tasks WHERE source_id = $1`, [evaluationId]), 'assign')
  })

  test('解いた評価をもう一度解こうとしても、黙って通らない', async () => {
    const { evaluationId } = await heldEvaluation()
    await unholdEvaluation(db, { evaluationId })
    const again = await unholdEvaluation(db, { evaluationId })

    assert.equal(again.ok, false)
    assert.equal(!again.ok && again.reason, 'not_held')
    assert.equal((await stateOf(evaluationId))?.state, 'pending')
  })
})

describe('解いてはいけないもの', () => {
  test('取り下げられた応募（数えるが、動いていない）は解けない', async () => {
    const { evaluationId } = await heldEvaluation({ voided: true })
    assert.equal(Number(await scalar<string>(db,
      `SELECT count(*) FROM v_open_tasks WHERE source_id = $1`, [evaluationId])), 0,
      '画面に出ていない評価であることを先に確かめる')

    const result = await unholdEvaluation(db, { evaluationId })
    assert.equal(!result.ok && result.reason, 'not_active')
    assert.equal((await stateOf(evaluationId))?.state, 'held')
  })

  test('不合格になった応募は解けない', async () => {
    const { evaluationId } = await heldEvaluation({ rejected: true })
    const result = await unholdEvaluation(db, { evaluationId })
    assert.equal(!result.ok && result.reason, 'not_active')
    assert.equal((await stateOf(evaluationId))?.state, 'held')
  })

  test('個人情報削除を受けた人の評価は解けない', async () => {
    const { person, evaluationId } = await heldEvaluation()
    await db.query(`UPDATE persons SET deleted_at = now() WHERE id = $1`, [person])

    const result = await unholdEvaluation(db, { evaluationId })
    assert.equal(!result.ok && result.reason, 'not_active')
    assert.equal((await stateOf(evaluationId))?.state, 'held')
  })

  test('提出済みの評価は解けない', async () => {
    const person = await makePerson(db, fx.schoolId)
    const app = await makeApplication(db, person, season.id, jst('2025-11-01T20:00:00'))
    const submitted = await scalar<string>(db, `
      INSERT INTO evaluations (application_id, selection_step_id, interviewer_staff_id,
                               state, assigned_at, submitted_at)
      VALUES ($1,$2,$3,'submitted',$4,$5) RETURNING id`,
      [app, season.stepIds[0], interviewer,
       jst('2025-11-02T10:00:00'), jst('2025-11-05T10:00:00')])

    const result = await unholdEvaluation(db, { evaluationId: submitted })
    assert.equal(!result.ok && result.reason, 'not_held')
  })

  test('壊れた id は 500 にせず、見つからないで返す', async () => {
    for (const bad of ['', 'not-a-uuid', "'; DROP TABLE evaluations; --"]) {
      const result = await unholdEvaluation(db, { evaluationId: bad })
      assert.equal(!result.ok && result.reason, 'evaluation_not_found', `id=${bad}`)
    }
    assert.ok(Number(await scalar<string>(db, `SELECT count(*) FROM evaluations`)) > 0)
  })
})

describe('画面へ返すコード', () => {
  test('すべてのコードに文言がある', async () => {
    const codes = ['unheld', 'evaluation_not_found', 'not_held', 'not_active'] as const
    for (const c of codes) {
      assert.ok(UNHOLD_CODE_MESSAGE[c]?.length > 0, c)
    }
    assert.equal(Object.keys(UNHOLD_CODE_MESSAGE).length, codes.length,
      '文言の数とコードの数が合っていない')
  })

  test('知らないコードは「何も起きていない」として捨てる', async () => {
    // URL は利用者が自由に書ける。知らない値で画面に文言を出さない。
    assert.equal(parseUnholdCode('nope'), null)
    assert.equal(parseUnholdCode(undefined), null)
    assert.equal(parseUnholdCode(['unheld', 'x']), 'unheld')
  })
})

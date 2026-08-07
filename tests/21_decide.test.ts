import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { scalar, all, maybeOne, type Db } from '../src/db/client.ts'
import {
  baseFixture, makeSeason, makePerson, makeApplication, jst,
  type Fixture, type Season,
} from './support/fixtures.ts'
import { saveScore } from '../src/commands/score.ts'
import {
  submitEvaluation, decideStep, getDecidableStep, DECIDE_CODE_MESSAGE,
  getCorrectableDecision, correctDecision,
} from '../src/commands/decide.ts'

/**
 * E3（確定）と D1（判定）の検証。
 *
 * **この2つで採用の1周が閉じる。** だから確かめるのは個々の更新ではなく、
 * **一周まわること**である ―― 担当を決める → 評価する → 確定する →
 * 通過にする → 次のステップが「担当を決める」として現れる → …→ 合格。
 *
 * 途中で止まる形（軸が残っている、面接官の片方が未提出）を弾くことも見る。
 */

let db: Db
let fx: Fixture
let season: Season
let interviewer: string
let criteriaByStep: string[][] = []

before(async () => {
  db = await freshDb()
  fx = await baseFixture(db)
  season = await makeSeason(db, { year: 2026, steps: ['書類選考', '一次面接', '最終面接'] })
  interviewer = await scalar<string>(db, `
    INSERT INTO staffs (display_name, email) VALUES ('面接官 一郎', 'd1@example.test')
    RETURNING id`)

  // 各ステップに2軸ずつ置く。1軸だけだと「残っている軸」の形が作れない。
  criteriaByStep = []
  for (const [i, stepId] of season.stepIds.entries()) {
    const ids: string[] = []
    for (const [j, name] of ['軸A', '軸B'].entries()) {
      ids.push(await scalar<string>(db, `
        INSERT INTO evaluation_criteria (selection_step_id, name, scale_max, sort_order)
        VALUES ($1, $2, 5, $3) RETURNING id`, [stepId, `${name}${i + 1}`, j + 1]))
    }
    criteriaByStep.push(ids)
  }
})

after(async () => { await db.close() })

const RATIONALE = '面談で語られた取り組みに裏づけがあった'

/** 応募と、第1ステップの評価（担当つき）を作る。 */
async function application(opts: { owner?: string | null } = {}) {
  const person = await makePerson(db, fx.schoolId)
  const app = await makeApplication(db, person, season.id, jst('2025-11-01T20:00:00'))
  const evaluationId = await scalar<string>(db, `
    INSERT INTO evaluations (application_id, selection_step_id, interviewer_staff_id,
                             state, assigned_at)
    VALUES ($1,$2,$3,'pending',$4) RETURNING id`,
    [app, season.stepIds[0], opts.owner === undefined ? interviewer : opts.owner,
     jst('2025-11-02T10:00:00')])
  return { person, app, evaluationId }
}

/** その評価の適用軸すべてに点を付ける。 */
async function scoreAll(evaluationId: string, stepIndex: number) {
  for (const criteriaId of criteriaByStep[stepIndex]!) {
    const r = await saveScore(db, { evaluationId, criteriaId, score: 4, rationale: RATIONALE })
    assert.equal(r.ok, true, `軸に点を付けられなかった: ${criteriaId}`)
  }
}

const taskOf = (evaluationId: string) =>
  maybeOne<{ kind: string }>(db,
    `SELECT kind FROM v_open_tasks WHERE source_id = $1`, [evaluationId])
    .then((r) => r?.kind ?? null)

describe('評価を確定する（E3）', () => {
  test('全軸そろえば確定でき、やることから消える', async () => {
    const { evaluationId } = await application()
    await scoreAll(evaluationId, 0)
    assert.equal(await taskOf(evaluationId), 'evaluate')

    const result = await submitEvaluation(db, { evaluationId })
    assert.equal(result.ok, true)

    const row = await maybeOne<{ state: string; submitted_at: Date | null }>(db,
      `SELECT state, submitted_at FROM evaluations WHERE id = $1`, [evaluationId])
    assert.equal(row?.state, 'submitted')
    assert.ok(row?.submitted_at, '提出時刻が入っていない')
    assert.equal(await taskOf(evaluationId), null, '確定した評価はやることに残らない')
  })

  test('点が付いていない軸が残っていると確定できない', async () => {
    // 途中で確定できると「点が1つしか無い評価」が残り、ステップ別の平均が
    // 軸によって母数の違う値になる。
    const { evaluationId } = await application()
    await saveScore(db, {
      evaluationId, criteriaId: criteriaByStep[0]![0]!, score: 4, rationale: RATIONALE,
    })
    const result = await submitEvaluation(db, { evaluationId })
    assert.equal(!result.ok && result.reason, 'criteria_missing')
    assert.equal(await scalar<string>(db,
      `SELECT state FROM evaluations WHERE id = $1`, [evaluationId]), 'pending')
  })

  test('担当が決まっていない評価は確定できない', async () => {
    const { evaluationId } = await application({ owner: null })
    const result = await submitEvaluation(db, { evaluationId })
    assert.equal(!result.ok && result.reason, 'not_evaluatable')
  })

  test('二度は確定できない', async () => {
    const { evaluationId } = await application()
    await scoreAll(evaluationId, 0)
    await submitEvaluation(db, { evaluationId })
    const again = await submitEvaluation(db, { evaluationId })
    assert.equal(!again.ok && again.reason, 'not_evaluatable')
  })

  test('壊れた id は 500 にせず、見つからないで返す', async () => {
    for (const bad of ['', 'nope', "'; DROP TABLE evaluations; --"]) {
      const r = await submitEvaluation(db, { evaluationId: bad })
      assert.equal(!r.ok && r.reason, 'evaluation_not_found', `id=${bad}`)
    }
  })
})

describe('選考を判定する（D1）', () => {
  test('確定するまで判定できない', async () => {
    const { app, evaluationId } = await application()
    assert.equal(await getDecidableStep(db, app), null, '評価が残っているのに判定できる')

    await scoreAll(evaluationId, 0)
    assert.equal(await getDecidableStep(db, app), null, '確定前に判定できてはいけない')

    await submitEvaluation(db, { evaluationId })
    const step = await getDecidableStep(db, app)
    assert.ok(step, '確定したのに判定できない')
    assert.equal(step.step_name, '書類選考')
    assert.equal(step.next_step_name, '一次面接')
  })

  test('面接官が2人いるステップは、2人とも確定してから判定できる', async () => {
    const { app, evaluationId } = await application()
    const second = await scalar<string>(db, `
      INSERT INTO staffs (display_name, email) VALUES ('面接官 二郎', 'd2@example.test')
      RETURNING id`)
    const other = await scalar<string>(db, `
      INSERT INTO evaluations (application_id, selection_step_id, interviewer_staff_id,
                               state, assigned_at)
      VALUES ($1,$2,$3,'pending',$4) RETURNING id`,
      [app, season.stepIds[0], second, jst('2025-11-02T10:00:00')])

    await scoreAll(evaluationId, 0)
    await submitEvaluation(db, { evaluationId })
    assert.equal(await getDecidableStep(db, app), null, '片方だけで判定できてはいけない')

    await scoreAll(other, 0)
    await submitEvaluation(db, { evaluationId: other })
    const step = await getDecidableStep(db, app)
    assert.ok(step)
    assert.equal(Number(step.submitted_evaluations), 2)
  })

  test('通過にすると、次のステップの評価が「担当を決める」として現れる', async () => {
    // **ここが1周の要である。** 判定の結果が、次の一手として運転席に並ぶ。
    const { app, evaluationId } = await application()
    await scoreAll(evaluationId, 0)
    await submitEvaluation(db, { evaluationId })

    const result = await decideStep(db, {
      applicationId: app, decision: 'advance', staffId: fx.staffId,
    })
    assert.equal(result.ok, true)
    assert.equal(result.ok && result.nextStepName, '一次面接')
    assert.equal(result.ok && result.accepted, false)

    const tasks = await all<{ kind: string; step_name: string }>(db,
      `SELECT kind, step_name FROM v_open_tasks WHERE application_id = $1`, [app])
    assert.equal(tasks.length, 1)
    assert.equal(tasks[0]!.kind, 'assign', '次のステップに担当が付いていてはいけない')
    assert.equal(tasks[0]!.step_name, '一次面接')
  })

  test('最終ステップを通過にすると合格になり、やることが空になる', async () => {
    const { app } = await application()
    // 3ステップを順に通す。
    for (const stepIndex of [0, 1, 2]) {
      const evaluationId = await scalar<string>(db, `
        SELECT id FROM evaluations
         WHERE application_id = $1 AND selection_step_id = $2`,
        [app, season.stepIds[stepIndex]])
      // 2ステップ目以降は担当が付いていないので、先に付ける。
      await db.query(
        `UPDATE evaluations SET interviewer_staff_id = coalesce(interviewer_staff_id, $2)
          WHERE id = $1`, [evaluationId, interviewer])
      await scoreAll(evaluationId, stepIndex)
      await submitEvaluation(db, { evaluationId })
      const r = await decideStep(db, {
        applicationId: app, decision: 'advance', staffId: fx.staffId,
      })
      assert.equal(r.ok, true, `${stepIndex} 段目で判定できなかった`)
      assert.equal(r.ok && r.accepted, stepIndex === 2)
    }

    // 合格していること。段の定義は最終ステップへの advance（v_application_state）。
    assert.equal(await scalar<string>(db,
      `SELECT is_accepted::text FROM v_application_state WHERE application_id = $1`,
      [app]), 'true')
    // 結末も合格。
    assert.equal(await scalar<string>(db,
      `SELECT outcome FROM v_application_outcome WHERE application_id = $1`, [app]),
      'accepted')
    // やることは残っていない。**1周が閉じた。**
    assert.equal(Number(await scalar<string>(db,
      `SELECT count(*) FROM v_open_tasks WHERE application_id = $1`, [app])), 0)
  })

  test('不合格にすると、どのステップで落ちたかが記録される', async () => {
    // CLAUDE.md は「必要になったら reject にステップを持たせる」と書いていた。
    // 画面から判定する以上、どのステップかは推測ではなく事実として手元にある。
    const { app, evaluationId } = await application()
    await scoreAll(evaluationId, 0)
    await submitEvaluation(db, { evaluationId })
    const result = await decideStep(db, {
      applicationId: app, decision: 'reject', staffId: fx.staffId,
    })
    assert.equal(result.ok, true)

    const history = await maybeOne<{ transition_type: string; step_name: string | null }>(db, `
      SELECT sh.transition_type, ss.name AS step_name
        FROM status_histories sh
        LEFT JOIN selection_steps ss ON ss.id = sh.selection_step_id
       WHERE sh.application_id = $1`, [app])
    assert.equal(history?.transition_type, 'reject')
    assert.equal(history?.step_name, '書類選考', 'どのステップで落ちたかが記録されていない')

    // 次のステップは作られない。やることも残らない。
    assert.equal(Number(await scalar<string>(db,
      `SELECT count(*) FROM v_open_tasks WHERE application_id = $1`, [app])), 0)
    assert.equal(await scalar<string>(db,
      `SELECT outcome FROM v_application_outcome WHERE application_id = $1`, [app]),
      'rejected')
  })

  test('同じステップを二度は判定できない', async () => {
    const { app, evaluationId } = await application()
    await scoreAll(evaluationId, 0)
    await submitEvaluation(db, { evaluationId })
    await decideStep(db, { applicationId: app, decision: 'advance', staffId: fx.staffId })

    const again = await decideStep(db, {
      applicationId: app, decision: 'reject', staffId: fx.staffId,
    })
    assert.equal(!again.ok && again.reason, 'not_decidable')
    // 遷移は1件のまま。
    assert.equal(Number(await scalar<string>(db,
      `SELECT count(*) FROM status_histories WHERE application_id = $1`, [app])), 1)
  })

  test('判定した人が選ばれていなければ記録しない', async () => {
    const { app, evaluationId } = await application()
    await scoreAll(evaluationId, 0)
    await submitEvaluation(db, { evaluationId })

    const retired = await scalar<string>(db, `
      INSERT INTO staffs (display_name, email, is_active)
      VALUES ('退任 三郎', 'd3@example.test', false) RETURNING id`)
    for (const staffId of ['', 'nope', retired]) {
      const r = await decideStep(db, { applicationId: app, decision: 'advance', staffId })
      assert.equal(!r.ok && r.reason, 'staff_not_available', `staff=${staffId}`)
    }
    assert.equal(Number(await scalar<string>(db,
      `SELECT count(*) FROM status_histories WHERE application_id = $1`, [app])), 0)
  })

  test('動いていない応募は判定できない', async () => {
    const { app, evaluationId } = await application()
    await scoreAll(evaluationId, 0)
    await submitEvaluation(db, { evaluationId })
    const reason = await scalar<string>(db, `
      INSERT INTO void_reasons (code, label, counts_as_application)
      VALUES ('withdrawn_21', '選考前の取り下げ', true) RETURNING id`)
    await db.query(
      `UPDATE applications SET voided_at = now(), void_reason_id = $2 WHERE id = $1`,
      [app, reason])

    assert.equal(await getDecidableStep(db, app), null)
    const r = await decideStep(db, {
      applicationId: app, decision: 'advance', staffId: fx.staffId,
    })
    assert.equal(!r.ok && r.reason, 'not_decidable')
  })

  test('すべてのコードに文言がある', () => {
    const codes = ['submitted', 'advanced', 'accepted', 'rejected',
      'evaluation_not_found', 'not_evaluatable', 'criteria_missing',
      'not_decidable', 'staff_not_available', 'bad_decision',
      'corrected_to_advance', 'corrected_to_reject', 'not_correctable'] as const
    for (const c of codes) assert.ok(DECIDE_CODE_MESSAGE[c]?.length > 0, c)
    assert.equal(Object.keys(DECIDE_CODE_MESSAGE).length, codes.length)
  })
})

describe('判定を訂正する（D2）', () => {
  /** 第1ステップを判定済みの応募を作る。 */
  async function decided(decision: 'advance' | 'reject') {
    const { app, evaluationId } = await application()
    await scoreAll(evaluationId, 0)
    await submitEvaluation(db, { evaluationId })
    const r = await decideStep(db, { applicationId: app, decision, staffId: fx.staffId })
    assert.equal(r.ok, true)
    return { app }
  }

  const outcomeOf = (app: string) => scalar<string>(db,
    `SELECT outcome FROM v_application_outcome WHERE application_id = $1`, [app])

  test('不合格を通過に訂正すると、次のステップが立ち上がる', async () => {
    // **これが訂正でいちばん危ない形である。** 直したのに次にやることが
    // 無ければ、運用者の手はそこで止まる。
    const { app } = await decided('reject')
    assert.equal(await outcomeOf(app), 'rejected')

    const target = await getCorrectableDecision(db, app)
    assert.ok(target)
    assert.equal(target.transition_type, 'reject')

    const r = await correctDecision(db, {
      applicationId: app, historyId: target.history_id, staffId: fx.staffId,
      note: '一次面接へ進める判断に直した',
    })
    assert.equal(r.ok, true)
    assert.equal(r.ok && r.decision, 'advance')
    assert.equal(r.ok && r.createdNextStep, '一次面接')

    assert.equal(await outcomeOf(app), 'in_selection', '結末が選考中に戻っていない')
    const tasks = await all<{ kind: string; step_name: string }>(db,
      `SELECT kind, step_name FROM v_open_tasks WHERE application_id = $1`, [app])
    assert.deepEqual(tasks, [{ kind: 'assign', step_name: '一次面接' }])
  })

  test('通過を不合格に訂正すると、やることが消える', async () => {
    const { app } = await decided('advance')
    assert.equal(Number(await scalar<string>(db,
      `SELECT count(*) FROM v_open_tasks WHERE application_id = $1`, [app])), 1)

    const target = await getCorrectableDecision(db, app)
    const r = await correctDecision(db, {
      applicationId: app, historyId: target!.history_id, staffId: fx.staffId,
    })
    assert.equal(r.ok && r.decision, 'reject')
    assert.equal(await outcomeOf(app), 'rejected')
    assert.equal(Number(await scalar<string>(db,
      `SELECT count(*) FROM v_open_tasks WHERE application_id = $1`, [app])), 0,
      '不合格に直したのに、次のステップのやることが残っている')
  })

  test('元の判定は消えず、打ち消し行として残る', async () => {
    // 原則5（訂正は打ち消しの追記で表現し、元の記録は残す）。
    const { app } = await decided('reject')
    const target = await getCorrectableDecision(db, app)
    await correctDecision(db, {
      applicationId: app, historyId: target!.history_id, staffId: fx.staffId,
    })

    const rows = await all<{ transition_type: string; is_correction: boolean }>(db, `
      SELECT transition_type, is_correction FROM status_histories
       WHERE application_id = $1 ORDER BY occurred_at`, [app])
    assert.equal(rows.length, 2, '元の行が消えている')
    assert.deepEqual(rows.map((r) => [r.transition_type, r.is_correction]),
      [['reject', false], ['advance', true]])

    // 有効なのは訂正のほうだけ（深さ偶数＝有効）。
    const effective = await all<{ transition_type: string }>(db,
      `SELECT transition_type FROM v_effective_status_histories
        WHERE application_id = $1`, [app])
    assert.deepEqual(effective.map((r) => r.transition_type), ['advance'])
  })

  test('訂正をさらに訂正できる（往復しても壊れない）', async () => {
    const { app } = await decided('advance')
    for (const expected of ['reject', 'advance', 'reject'] as const) {
      const target = await getCorrectableDecision(db, app)
      assert.ok(target, `訂正できる判定が見つからない（${expected} の手前）`)
      const r = await correctDecision(db, {
        applicationId: app, historyId: target.history_id, staffId: fx.staffId,
      })
      assert.equal(r.ok && r.decision, expected)
      assert.equal(await outcomeOf(app), expected === 'reject' ? 'rejected' : 'in_selection')
    }
    // 往復しても次のステップの評価は1件だけ（二重に作らない）。
    assert.equal(Number(await scalar<string>(db, `
      SELECT count(*) FROM evaluations e
        JOIN selection_steps ss ON ss.id = e.selection_step_id
       WHERE e.application_id = $1 AND ss.sort_order = 2`, [app])), 1)
  })

  test('画面が見ていたのとは違う判定は訂正しない', async () => {
    // 別の誰かが先に訂正していた場合に、見ていたのとは違う行を打ち消さない。
    const { app } = await decided('reject')
    const target = await getCorrectableDecision(db, app)
    await correctDecision(db, {
      applicationId: app, historyId: target!.history_id, staffId: fx.staffId,
    })
    // 同じ history_id でもう一度訂正しようとする（古い画面から押した形）。
    const stale = await correctDecision(db, {
      applicationId: app, historyId: target!.history_id, staffId: fx.staffId,
    })
    assert.equal(!stale.ok && stale.reason, 'not_correctable')
    assert.equal(Number(await scalar<string>(db,
      `SELECT count(*) FROM status_histories WHERE application_id = $1`, [app])), 2)
  })

  test('まだ判定していない応募は訂正できない', async () => {
    const { app } = await application()
    assert.equal(await getCorrectableDecision(db, app), null)
    const r = await correctDecision(db, {
      applicationId: app, historyId: '00000000-0000-0000-0000-000000000000',
      staffId: fx.staffId,
    })
    assert.equal(!r.ok && r.reason, 'not_correctable')
  })

  test('個人情報削除を受けた人の判定は訂正できない', async () => {
    const { app, evaluationId } = await application()
    await scoreAll(evaluationId, 0)
    await submitEvaluation(db, { evaluationId })
    await decideStep(db, { applicationId: app, decision: 'reject', staffId: fx.staffId })
    const personId = await scalar<string>(db,
      `SELECT person_id FROM applications WHERE id = $1`, [app])
    await db.query(`UPDATE persons SET deleted_at = now() WHERE id = $1`, [personId])

    assert.equal(await getCorrectableDecision(db, app), null)
  })

  test('訂正した人が選ばれていなければ記録しない', async () => {
    const { app } = await decided('reject')
    const target = await getCorrectableDecision(db, app)
    for (const staffId of ['', 'nope']) {
      const r = await correctDecision(db, {
        applicationId: app, historyId: target!.history_id, staffId,
      })
      assert.equal(!r.ok && r.reason, 'staff_not_available')
    }
    assert.equal(Number(await scalar<string>(db,
      `SELECT count(*) FROM status_histories WHERE application_id = $1`, [app])), 1)
  })
})

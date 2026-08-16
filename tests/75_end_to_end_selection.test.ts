import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { all, maybeOne, scalar, type Db } from '../src/db/client.ts'
import { baseFixture, makeSeason, makePerson, makeApplication } from './support/fixtures.ts'
import { assignInterviewer } from '../src/commands/assign.ts'
import { saveScore } from '../src/commands/score.ts'
import { submitEvaluation, decideStep, startSelection } from '../src/commands/decide.ts'

/**
 * 書類選考から最終選考まで、**このDBの中だけで完結するか**
 * （依頼者の指示。実行⑰。C-210）。
 *
 * ★ 画面ではなく**コマンド**で通す ―― 画面は入口が変わるが、
 *   記録の道筋は変わらない。道筋が繋がっていることを固定する。
 *
 * ★ 段は本番と同じ5つ（0002）。特別選考・応募受付・書類選考・
 *   グループ面接・最終面接。**軸のある段は点を付けないと確定できない。**
 */

describe('書類選考 → 最終選考が1本で通る（C-210）', () => {
  let db: Db
  let appId: string
  let staffId: string
  let schoolId: string
  let seasonId: string
  let steps: { id: string; name: string; sort_order: number }[]

  before(async () => {
    db = await freshDb({ seeds: 'production' })
    const base = await baseFixture(db)
    schoolId = base.schoolId
    seasonId = await scalar<string>(db,
      `SELECT id FROM seasons WHERE cohort_number = 3 AND NOT is_demo`)
    const personId = await makePerson(db, schoolId,
      { familyName: '架空', givenName: '通し' })
    appId = await makeApplication(db, personId, seasonId, '2026-11-01T10:00:00+09:00')
    staffId = await scalar<string>(db,
      `SELECT id FROM staffs WHERE is_active ORDER BY created_at LIMIT 1`)
    steps = await all(db, `
      SELECT id, name, sort_order FROM selection_steps
       WHERE season_id = $1 ORDER BY sort_order`, [seasonId])
  })

  after(async () => { await db.close() })

  /** その段の評価行。無ければ null。 */
  const evaluationOf = (stepId: string) =>
    maybeOne<{ id: string; state: string }>(db, `
      SELECT id, state FROM evaluations
       WHERE application_id = $1 AND selection_step_id = $2`, [appId, stepId])

  /** その段を、点を付けて確定させる。 */
  const clear = async (stepName: string) => {
    const step = steps.find((s) => s.name === stepName)!
    const ev = await evaluationOf(step.id)
    assert.ok(ev, `${stepName} の評価行が作られていない（道が切れている）`)

    // 担当が要る段は先に決める。
    if (ev.state === 'pending') {
      const a = await assignInterviewer(db, { evaluationId: ev.id, staffId })
      assert.ok(a.ok, `${stepName} の担当を決められない`)
    }
    const criteria = await all<{ id: string; scale_max: number }>(db, `
      SELECT id, scale_max FROM evaluation_criteria
       WHERE selection_step_id = $1 AND applies_to <> 'reapplicant_only'
       ORDER BY sort_order`, [step.id])
    for (const c of criteria) {
      const r = await saveScore(db, {
        evaluationId: ev.id, criteriaId: c.id,
        score: Number(c.scale_max), rationale: '通しの検査で付けた点',
      })
      assert.ok(r.ok, `${stepName} の「${c.id}」に点を付けられない`)
    }
    const s = await submitEvaluation(db, { evaluationId: ev.id })
    assert.ok(s.ok, `${stepName} を提出できない`)
    const d = await decideStep(db, { applicationId: appId, decision: 'advance', staffId })
    assert.ok(d.ok, `${stepName} を確定できない`)
  }

  test('① 応募から選考を始められる（1段目の評価行ができる）', async () => {
    const r = await startSelection(db, appId)
    assert.equal(r.ok, true)
    const first = steps.find((s) => s.name === '応募受付')!
    assert.ok(await evaluationOf(first.id), '応募受付の評価行が無い')
  })

  test('二度始めても、評価行は増えない', async () => {
    await startSelection(db, appId)
    const n = Number(await scalar(db,
      `SELECT count(*) FROM evaluations WHERE application_id = $1`, [appId]))
    assert.equal(n, 1, '二度押しで評価行が増えている')
  })

  test('② 応募受付 → 書類選考 → グループ面接 → 最終面接まで進める', async () => {
    for (const name of ['応募受付', '書類選考', 'グループ面接']) {
      await clear(name)
    }
    const last = steps.find((s) => s.name === '最終面接')!
    assert.ok(await evaluationOf(last.id), '最終面接まで辿り着いていない')
  })

  test('★ 最終面接を通すと、合格として記録される', async () => {
    await clear('最終面接')
    const outcome = await maybeOne<{ outcome: string }>(db, `
      SELECT outcome FROM v_application_outcome WHERE application_id = $1`, [appId])
    assert.equal(outcome?.outcome, 'accepted',
      '最終面接を通したのに合格になっていない（道が最後で切れている）')
  })

  test('★ 通った段の点が、すべて記録に残っている', async () => {
    const scored = Number(await scalar(db, `
      SELECT count(*) FROM evaluation_scores s
        JOIN evaluations e ON e.id = s.evaluation_id
       WHERE e.application_id = $1`, [appId]))
    // 書類選考4 ＋ グループ面接6 ＋ 最終面接6 ＝ 16（応募受付は軸が0本）。
    assert.equal(scored, 16, '付けた点が記録に残っていない')
  })

  test('★ 途中で落とすと、そこで止まり先の段は作られない', async () => {
    const p = await makePerson(db, schoolId, { familyName: '架空', givenName: '不合格' })
    const a = await makeApplication(db, p, seasonId, '2026-11-02T10:00:00+09:00')
    assert.equal((await startSelection(db, a)).ok, true)

    const accept = steps.find((s) => s.name === '応募受付')!
    const ev = await maybeOne<{ id: string }>(db, `
      SELECT id FROM evaluations WHERE application_id = $1 AND selection_step_id = $2`,
    [a, accept.id])
    assert.ok(ev)
    assert.ok((await assignInterviewer(db, { evaluationId: ev.id, staffId })).ok)
    assert.ok((await submitEvaluation(db, { evaluationId: ev.id })).ok)
    assert.ok((await decideStep(db, { applicationId: a, decision: 'reject', staffId })).ok)

    const doc = steps.find((s) => s.name === '書類選考')!
    const next = await maybeOne(db, `
      SELECT id FROM evaluations WHERE application_id = $1 AND selection_step_id = $2`,
    [a, doc.id])
    assert.equal(next, null, '落としたのに次の段が作られている')

    const outcome = await maybeOne<{ outcome: string }>(db, `
      SELECT outcome FROM v_application_outcome WHERE application_id = $1`, [a])
    assert.equal(outcome?.outcome, 'rejected')
  })

  test('★ 軸のある段は、点を付けないと確定できない', async () => {
    const p = await makePerson(db, schoolId, { familyName: '架空', givenName: '未採点' })
    const a = await makeApplication(db, p, seasonId, '2026-11-03T10:00:00+09:00')
    await startSelection(db, a)

    // 応募受付（軸0本）は点なしで通せる。
    const accept = steps.find((s) => s.name === '応募受付')!
    const ev0 = await maybeOne<{ id: string }>(db, `
      SELECT id FROM evaluations WHERE application_id = $1 AND selection_step_id = $2`,
    [a, accept.id])
    await assignInterviewer(db, { evaluationId: ev0!.id, staffId })
    await submitEvaluation(db, { evaluationId: ev0!.id })
    await decideStep(db, { applicationId: a, decision: 'advance', staffId })

    // 書類選考（4軸）は、点が無いと提出できない。
    const doc = steps.find((s) => s.name === '書類選考')!
    const ev1 = await maybeOne<{ id: string }>(db, `
      SELECT id FROM evaluations WHERE application_id = $1 AND selection_step_id = $2`,
    [a, doc.id])
    assert.ok(ev1, '書類選考の評価行が作られていない')
    await assignInterviewer(db, { evaluationId: ev1.id, staffId })
    const s = await submitEvaluation(db, { evaluationId: ev1.id })
    assert.equal(s.ok, false, '点が1つも無いのに提出できてしまう')
  })
})

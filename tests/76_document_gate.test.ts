import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { all, maybeOne, scalar, type Db } from '../src/db/client.ts'
import { baseFixture, makePerson, makeApplication } from './support/fixtures.ts'
import { startSelection, submitEvaluation, decideStep } from '../src/commands/decide.ts'
import { assignInterviewer } from '../src/commands/assign.ts'
import { saveScore } from '../src/commands/score.ts'
import {
  listDocumentScreening, verdictOf, DOCUMENT_SCREENING_MAX, DOCUMENT_SCREENING_PASS,
} from '../src/queries/document_screening.ts'

/**
 * 書類選考は10点満点、7点以上で通す（C-212。依頼者の指示）。
 *
 * 依頼者の言葉 ――「10点満点で、7点以上を通して。それ以外は要注意ラベル」。
 *
 * ★ 固定したいのは4つ ――
 *   ① 満点は10（軸の合計が10）
 *   ② 7点以上は通過
 *   ③ 6点以下は要注意
 *   ④ ★ 点が揃っていない間は**要注意にしない**（読む前に落として見せない）
 */

describe('書類選考の門（C-212）', () => {
  let db: Db
  let seasonId: string
  let schoolId: string
  let staffId: string

  before(async () => {
    db = await freshDb({ seeds: 'production' })
    const base = await baseFixture(db)
    schoolId = base.schoolId
    seasonId = await scalar<string>(db,
      `SELECT id FROM seasons WHERE cohort_number = 3 AND NOT is_demo`)
    staffId = await scalar<string>(db,
      `SELECT id FROM staffs WHERE is_active ORDER BY created_at LIMIT 1`)
  })

  after(async () => { await db.close() })

  test('★ 満点は10（依頼者が16から変えた）', async () => {
    const rows = await all<{ name: string; scale_max: number }>(db, `
      SELECT c.name, c.scale_max
        FROM evaluation_criteria c
        JOIN selection_steps s ON s.id = c.selection_step_id AND s.name = '書類選考'
        JOIN seasons se ON se.id = s.season_id AND se.cohort_number = 3
       ORDER BY c.sort_order`)
    assert.equal(rows.reduce((n, r) => n + Number(r.scale_max), 0),
      DOCUMENT_SCREENING_MAX, '軸の合計が10になっていない')
    assert.equal(Number(rows.find((r) => r.name === '論理力')!.scale_max), 4,
      'AIが付ける軸の配点が変わっている')
  })

  /** 書類選考まで進めて、指定した点を付ける。 */
  const scoreDocument = async (name: string, scores: number[]) => {
    const p = await makePerson(db, schoolId, { familyName: '架空', givenName: name })
    const a = await makeApplication(db, p, seasonId, '2026-11-05T10:00:00+09:00')
    await startSelection(db, a)
    const ev0 = (await maybeOne<{ id: string }>(db, `
      SELECT e.id FROM evaluations e JOIN selection_steps s ON s.id = e.selection_step_id
       WHERE e.application_id = $1 AND s.name = '応募受付'`, [a]))!
    await assignInterviewer(db, { evaluationId: ev0.id, staffId })
    await submitEvaluation(db, { evaluationId: ev0.id })
    await decideStep(db, { applicationId: a, decision: 'advance', staffId })

    const ev1 = (await maybeOne<{ id: string; selection_step_id: string }>(db, `
      SELECT e.id, e.selection_step_id FROM evaluations e
        JOIN selection_steps s ON s.id = e.selection_step_id
       WHERE e.application_id = $1 AND s.name = '書類選考'`, [a]))!
    await assignInterviewer(db, { evaluationId: ev1.id, staffId })
    const criteria = await all<{ id: string }>(db, `
      SELECT id FROM evaluation_criteria
       WHERE selection_step_id = $1 ORDER BY sort_order`, [ev1.selection_step_id])
    for (const [i, c] of criteria.entries()) {
      if (scores[i] === undefined) continue
      await saveScore(db, {
        evaluationId: ev1.id, criteriaId: c.id, score: scores[i]!,
        rationale: '門の検査で付けた点',
      })
    }
    return a
  }

  test('★ 7点以上は通過', async () => {
    // 論理力3 ＋ 2 ＋ 1 ＋ 1 ＝ 7
    const a = await scoreDocument('合格線', [3, 2, 1, 1])
    const row = (await listDocumentScreening(db, seasonId))
      .find((r) => r.application_id === a)!
    assert.equal(row.score, DOCUMENT_SCREENING_PASS)
    assert.equal(verdictOf(row), 'pass')
  })

  test('★ 6点以下は要注意', async () => {
    const a = await scoreDocument('要注意', [2, 2, 1, 1]) // 6点
    const row = (await listDocumentScreening(db, seasonId))
      .find((r) => r.application_id === a)!
    assert.equal(row.score, 6)
    assert.equal(verdictOf(row), 'watch')
  })

  test('★ 点が揃っていない間は「要注意」にしない', async () => {
    const a = await scoreDocument('採点中', [1]) // 論理力だけ
    const row = (await listDocumentScreening(db, seasonId))
      .find((r) => r.application_id === a)!
    assert.equal(verdictOf(row), 'incomplete',
      '読む前に落として見せている')
  })

  test('満点は記録から数えた値と一致する', async () => {
    const a = await scoreDocument('満点確認', [4, 2, 2, 2])
    const row = (await listDocumentScreening(db, seasonId))
      .find((r) => r.application_id === a)!
    assert.equal(row.scale_max, DOCUMENT_SCREENING_MAX)
    assert.equal(row.score, DOCUMENT_SCREENING_MAX)
    assert.equal(verdictOf(row), 'pass')
  })
})

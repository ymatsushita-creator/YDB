import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { scalar, type Db } from '../src/db/client.ts'
import {
  baseFixture, makeSeason, makePerson, makeApplication, makeVoidReason,
  voidApplication, makeChannel, jst, type Season,
} from './support/fixtures.ts'

const setup = async () => {
  const db = await freshDb()
  const base = await baseFixture(db)
  const season = await makeSeason(db, { year: 2026 })
  return { ...base, season }
}

const makeCriteria = (db: Db, stepId: string, name: string, scaleMax: number, appliesTo = 'all') =>
  scalar<string>(
    db,
    `INSERT INTO evaluation_criteria (selection_step_id, name, scale_max, applies_to, sort_order)
     VALUES ($1, $2, $3, $4, (SELECT COALESCE(max(sort_order),0)+1 FROM evaluation_criteria WHERE selection_step_id = $1))
     RETURNING id`,
    [stepId, name, scaleMax, appliesTo],
  )

const makeEvaluation = (db: Db, applicationId: string, stepId: string, staffId?: string) =>
  scalar<string>(
    db,
    `INSERT INTO evaluations (application_id, selection_step_id, interviewer_staff_id)
     VALUES ($1, $2, $3) RETURNING id`,
    [applicationId, stepId, staffId ?? null],
  )

const addScore = (db: Db, evaluationId: string, criteriaId: string, score: number, rationale = '具体的なエピソードあり') =>
  db.query(
    `INSERT INTO evaluation_scores (evaluation_id, criteria_id, score, rationale)
     VALUES ($1, $2, $3, $4)`,
    [evaluationId, criteriaId, score, rationale],
  )

describe('評価スコアの妥当性', () => {
  test('scale_max を超えるスコアは記録できない', async () => {
    // 上限のない5段階評価は、集計時に平均が意味を失う。
    const { db, schoolId, staffId, season } = await setup()
    const app = await makeApplication(db, await makePerson(db, schoolId), season.id, jst('2025-11-10T09:00:00'))
    const step = season.stepIds[0]!
    const crit = await makeCriteria(db, step, '主体性', 5)
    const evaluation = await makeEvaluation(db, app, step, staffId)

    await addScore(db, evaluation, crit, 5)
    await assert.rejects(() => addScore(db, evaluation, crit, 6), /exceeds scale_max/)
    await db.close()
  })

  test('別ステップの評価軸は付けられない', async () => {
    // ステップ別の平均点が別物の混合になるのを防ぐ。
    const { db, schoolId, staffId, season } = await setup()
    const app = await makeApplication(db, await makePerson(db, schoolId), season.id, jst('2025-11-10T09:00:00'))
    const critOnStep2 = await makeCriteria(db, season.stepIds[1]!, '深掘り耐性', 5)
    const evalOnStep1 = await makeEvaluation(db, app, season.stepIds[0]!, staffId)

    await assert.rejects(() => addScore(db, evalOnStep1, critOnStep2, 3), /belongs to step/)
    await db.close()
  })

  test('再応募者限定の評価軸は初回応募者に付けられない', async () => {
    const { db, schoolId, staffId, season } = await setup()
    const step = season.stepIds[0]!
    const crit = await makeCriteria(db, step, '前回からの変化', 5, 'reapplicant_only')

    const firstTime = await makeApplication(
      db, await makePerson(db, schoolId), season.id, jst('2025-11-10T09:00:00'))
    const ev1 = await makeEvaluation(db, firstTime, step, staffId)
    await assert.rejects(() => addScore(db, ev1, crit, 3), /restricted to reapplicants/)

    const again = await makeApplication(
      db, await makePerson(db, schoolId), season.id, jst('2025-11-10T09:00:00'),
      { isReapplication: true })
    const ev2 = await makeEvaluation(db, again, step, staffId)
    await addScore(db, ev2, crit, 3)
    await db.close()
  })

  test('根拠エピソードは空白だけでは通らない', async () => {
    // NOT NULL だけだと空文字が通り、必須にした設計意図が形骸化する（資料5-3）。
    const { db, schoolId, staffId, season } = await setup()
    const app = await makeApplication(db, await makePerson(db, schoolId), season.id, jst('2025-11-10T09:00:00'))
    const step = season.stepIds[0]!
    const crit = await makeCriteria(db, step, '主体性', 5)
    const ev = await makeEvaluation(db, app, step, staffId)

    await assert.rejects(() => addScore(db, ev, crit, 3, '   '), /rationale_not_blank/)
    await db.close()
  })
})

describe('評価の割り当て', () => {
  test('担当未割当の行も重複して作れない（NULLS NOT DISTINCT）', async () => {
    const { db, schoolId, season } = await setup()
    const app = await makeApplication(db, await makePerson(db, schoolId), season.id, jst('2025-11-10T09:00:00'))
    const step = season.stepIds[0]!
    await makeEvaluation(db, app, step)
    await assert.rejects(() => makeEvaluation(db, app, step), /evaluations_assignment_key|duplicate key/)
    await db.close()
  })

  test('提出時刻が割り当て時刻より前の評価は作れない', async () => {
    // 滞留日数が負になるとダッシュボード(2)の平均滞留が壊れる。
    const { db, schoolId, staffId, season } = await setup()
    const app = await makeApplication(db, await makePerson(db, schoolId), season.id, jst('2025-11-10T09:00:00'))
    await assert.rejects(
      () => db.query(
        `INSERT INTO evaluations
           (application_id, selection_step_id, interviewer_staff_id, state, assigned_at, submitted_at)
         VALUES ($1, $2, $3, 'submitted', $4, $5)`,
        [app, season.stepIds[0], staffId, jst('2025-12-05T10:00:00'), jst('2025-12-01T10:00:00')],
      ),
      /submitted_after_assigned/,
    )
    await db.close()
  })

  test('held には理由が要る', async () => {
    const { db, schoolId, staffId, season } = await setup()
    const app = await makeApplication(db, await makePerson(db, schoolId), season.id, jst('2025-11-10T09:00:00'))
    await assert.rejects(
      () => db.query(
        `INSERT INTO evaluations (application_id, selection_step_id, interviewer_staff_id, state)
         VALUES ($1, $2, $3, 'held')`,
        [app, season.stepIds[0], staffId],
      ),
      /hold_reason_required/,
    )
    await db.close()
  })
})

describe('応募の一意性', () => {
  test('同一年度に有効な応募は1件まで', async () => {
    const { db, schoolId, season } = await setup()
    const p = await makePerson(db, schoolId)
    await makeApplication(db, p, season.id, jst('2025-11-10T09:00:00'))
    await assert.rejects(
      () => makeApplication(db, p, season.id, jst('2025-11-11T09:00:00')),
      /applications_person_season_key|duplicate key/,
    )
    await db.close()
  })

  test('無効化すれば同一年度に再度応募できる', async () => {
    const { db, schoolId, season } = await setup()
    const p = await makePerson(db, schoolId)
    const first = await makeApplication(db, p, season.id, jst('2025-11-10T09:00:00'))
    const reason = await makeVoidReason(db, 'duplicate_entry', false)
    await voidApplication(db, first, reason, jst('2025-11-12T10:00:00'))
    await makeApplication(db, p, season.id, jst('2025-11-13T09:00:00'))
    await db.close()
  })

  test('無効化には理由が必須（片方だけ埋めることはできない）', async () => {
    const { db, schoolId, season } = await setup()
    const app = await makeApplication(db, await makePerson(db, schoolId), season.id, jst('2025-11-10T09:00:00'))
    await assert.rejects(
      () => db.query(`UPDATE applications SET voided_at = now() WHERE id = $1`, [app]),
      /applications_void_pair/,
    )
    await db.close()
  })
})

describe('名寄せ判定の一意性', () => {
  test('(A,B) と (B,A) を別々に登録できない', async () => {
    // 「AとBは別人」は「BとAは別人」と同じ判断。順序を固定しないと
    // 片方 confirmed_same、片方 confirmed_different という矛盾が作れる。
    const { db, schoolId } = await setup()
    const ids = [await makePerson(db, schoolId), await makePerson(db, schoolId)].sort()
    const [lo, hi] = ids as [string, string]

    const insert = (a: string, b: string, decision: string) =>
      db.query(
        `INSERT INTO identity_resolutions (person_id, candidate_person_id, decision, matched_keys)
         VALUES ($1, $2, $3, ARRAY['family_name','given_name'])`,
        [a, b, decision],
      )

    await insert(lo, hi, 'confirmed_different')
    await assert.rejects(() => insert(hi, lo, 'confirmed_same'), /canonical_order/)
    await db.close()
  })

  test('自分自身を候補にはできない', async () => {
    const { db, schoolId } = await setup()
    const p = await makePerson(db, schoolId)
    await assert.rejects(
      () => db.query(
        `INSERT INTO identity_resolutions (person_id, candidate_person_id, decision, matched_keys)
         VALUES ($1, $1, 'confirmed_same', ARRAY['x'])`,
        [p],
      ),
      /not_self|canonical_order/,
    )
    await db.close()
  })
})

describe('接点の時系列', () => {
  test('参加時刻が申込時刻より前にはならない', async () => {
    // ドタキャン判定（申込あり・参加なし）が意味を持つ前提（資料3-3）。
    const { db, schoolId } = await setup()
    const p = await makePerson(db, schoolId)
    const ch = await makeChannel(db, 'セミナー')
    await assert.rejects(
      () => db.query(
        `INSERT INTO touchpoints (person_id, channel_id, occurred_at, applied_at, attended_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [p, ch, jst('2025-10-01T10:00:00'), jst('2025-10-05T10:00:00'), jst('2025-10-03T10:00:00')],
      ),
      /attend_after_apply/,
    )
    await db.close()
  })

  test('ドタキャン（申込あり・参加なし）は記録できる', async () => {
    const { db, schoolId } = await setup()
    const p = await makePerson(db, schoolId)
    const ch = await makeChannel(db, 'セミナー')
    await db.query(
      `INSERT INTO touchpoints (person_id, channel_id, occurred_at, applied_at)
       VALUES ($1, $2, $3, $4)`,
      [p, ch, jst('2025-10-01T10:00:00'), jst('2025-10-05T10:00:00')],
    )
    await db.close()
  })
})

describe('紹介の自己参照', () => {
  test('自分で自分を紹介することはできない', async () => {
    const { db, schoolId } = await setup()
    const p = await makePerson(db, schoolId)
    await assert.rejects(
      () => db.query(`UPDATE persons SET referrer_person_id = id WHERE id = $1`, [p]),
      /no_self_referral/,
    )
    await db.close()
  })
})

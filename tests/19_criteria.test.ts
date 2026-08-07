import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { scalar, type Db } from '../src/db/client.ts'
import {
  baseFixture, makeSeason, makePerson, makeApplication, jst,
  type Fixture, type Season,
} from './support/fixtures.ts'
import { getApplicationEvaluations } from '../src/queries/drilldown.ts'
import { getOpenTasks } from '../src/queries/cockpit.ts'

/**
 * E1「評価すべき軸を見せる」の検証。
 *
 * 書き込みは無い。確かめたいのは**何を出すかの規則**である。
 *
 * ★ 適用の規則が2箇所にある。
 *   `evaluation_scores_applicability`（トリガ）は書き込みを拒否し、
 *   `getApplicationEvaluations` の pending_criteria は何を書くべきかを出す。
 *   **食い違うと「画面が出したのに保存できない軸」ができる。**
 *   ここで両者の一致を機械的に固定する（C-11 と同じ理由で、定義が
 *   2箇所にある状態そのものは残っている ―― TODO(MVP)）。
 */

let db: Db
let fx: Fixture
let season: Season
let interviewer: string
/** 再応募者限定の軸の id。 */
let reapplicantOnly: string
/** 全員に適用される軸の名前。 */
const ALL_CRITERIA = ['志望動機の具体性', '行動実績']

before(async () => {
  db = await freshDb()
  fx = await baseFixture(db)
  season = await makeSeason(db, { year: 2026, steps: ['書類選考'] })
  interviewer = await scalar<string>(db, `
    INSERT INTO staffs (display_name, email) VALUES ('面接官 一郎', 'c1@example.test')
    RETURNING id`)

  for (const [i, name] of ALL_CRITERIA.entries()) {
    await db.query(`
      INSERT INTO evaluation_criteria (selection_step_id, name, scale_max, sort_order)
      VALUES ($1, $2, 5, $3)`, [season.stepIds[0], name, i + 1])
  }
  reapplicantOnly = await scalar<string>(db, `
    INSERT INTO evaluation_criteria
      (selection_step_id, name, scale_max, applies_to, sort_order)
    VALUES ($1, '前回からの変化', 5, 'reapplicant_only', 99) RETURNING id`,
    [season.stepIds[0]])
})

after(async () => { await db.close() })

/** 応募と判断待ちの評価を1件作る。 */
async function pending(opts: { reapplication?: boolean } = {}) {
  const person = await makePerson(db, fx.schoolId)
  const app = await makeApplication(db, person, season.id, jst('2025-11-01T20:00:00'),
    { isReapplication: opts.reapplication ?? false })
  const evaluationId = await scalar<string>(db, `
    INSERT INTO evaluations (application_id, selection_step_id, interviewer_staff_id,
                             state, assigned_at)
    VALUES ($1,$2,$3,'pending',$4) RETURNING id`,
    [app, season.stepIds[0], interviewer, jst('2025-11-02T10:00:00')])
  return { person, app, evaluationId }
}

describe('これから付ける軸', () => {
  test('判断待ちの評価に、適用される軸がすべて出る', async () => {
    const { app } = await pending()
    const [evaluation] = await getApplicationEvaluations(db, app)
    assert.ok(evaluation)
    assert.deepEqual(
      evaluation.pending_criteria.map((c) => c.criteria_name), ALL_CRITERIA)
    assert.equal(evaluation.pending_criteria[0]!.scale_max, 5)
  })

  test('再応募でなければ、再応募者限定の軸は出ない', async () => {
    const { app } = await pending({ reapplication: false })
    const [evaluation] = await getApplicationEvaluations(db, app)
    assert.ok(!evaluation!.pending_criteria.some((c) => c.criteria_name === '前回からの変化'),
      '出すと、保存しようとしてトリガに弾かれる')
  })

  test('再応募なら、再応募者限定の軸も出る', async () => {
    const { app } = await pending({ reapplication: true })
    const [evaluation] = await getApplicationEvaluations(db, app)
    const names = evaluation!.pending_criteria.map((c) => c.criteria_name)
    assert.deepEqual(names, [...ALL_CRITERIA, '前回からの変化'])
    const extra = evaluation!.pending_criteria.find((c) => c.criteria_name === '前回からの変化')!
    assert.equal(extra.applies_to, 'reapplicant_only', '画面で呼び分けられる形で返す')
  })

  test('点が付いた軸は、これから付ける軸から消える', async () => {
    const { app, evaluationId } = await pending()
    const criteria = await scalar<string>(db, `
      SELECT id FROM evaluation_criteria
       WHERE selection_step_id = $1 AND name = $2`, [season.stepIds[0], ALL_CRITERIA[0]])
    await db.query(`
      INSERT INTO evaluation_scores (evaluation_id, criteria_id, score, rationale)
      VALUES ($1,$2,4,'具体的な取り組みに裏づけがあった')`, [evaluationId, criteria])

    const [evaluation] = await getApplicationEvaluations(db, app)
    assert.deepEqual(evaluation!.pending_criteria.map((c) => c.criteria_name),
      [ALL_CRITERIA[1]])
    assert.equal(evaluation!.scores.length, 1, '付いた点はそのまま読める')
  })

  test('出した軸は、すべて実際に保存できる（トリガと食い違わない）', async () => {
    // **これがこのテストの本題である。** 適用の規則が
    // トリガ（書き込みの拒否）と問い合わせ（何を書くべきか）の2箇所にある。
    // 食い違うと「画面が出したのに保存できない軸」ができる。
    for (const reapplication of [false, true]) {
      const { app, evaluationId } = await pending({ reapplication })
      const [evaluation] = await getApplicationEvaluations(db, app)

      for (const c of evaluation!.pending_criteria) {
        const criteriaId = await scalar<string>(db, `
          SELECT id FROM evaluation_criteria
           WHERE selection_step_id = $1 AND name = $2`, [season.stepIds[0], c.criteria_name])
        // 落ちなければ一致している。
        await db.query(`
          INSERT INTO evaluation_scores (evaluation_id, criteria_id, score, rationale)
          VALUES ($1,$2,3,'面談で語られた経緯に裏づけがあった')`, [evaluationId, criteriaId])
      }

      const [after] = await getApplicationEvaluations(db, app)
      assert.deepEqual(after!.pending_criteria, [],
        `再応募=${reapplication} で、付け残した軸がある`)
    }
  })

  test('出していない軸を保存しようとすると、トリガが拒否する', async () => {
    // 逆方向の一致。再応募でない応募に再応募者限定の軸は書けない。
    const { evaluationId } = await pending({ reapplication: false })
    await assert.rejects(
      () => db.query(`
        INSERT INTO evaluation_scores (evaluation_id, criteria_id, score, rationale)
        VALUES ($1,$2,3,'書けてはいけない')`, [evaluationId, reapplicantOnly]),
      /reapplicant|applies_to|適用/,
    )
  })
})

describe('運転席に出る入力の進み具合', () => {
  test('未着手と途中が、件数で区別できる', async () => {
    // 「評価する」としか出ていないと、着手前か途中かが分からない。
    // 1件ずつ開かないと分からないのは5秒で読める画面ではない。
    const untouched = await pending()
    const started = await pending()
    const criteria = await scalar<string>(db, `
      SELECT id FROM evaluation_criteria
       WHERE selection_step_id = $1 AND name = $2`, [season.stepIds[0], ALL_CRITERIA[0]])
    await db.query(`
      INSERT INTO evaluation_scores (evaluation_id, criteria_id, score, rationale)
      VALUES ($1,$2,4,'一つ目の軸だけ先に付けた')`, [started.evaluationId, criteria])

    const tasks = await getOpenTasks(db, season.id)
    const a = tasks.find((t) => t.source_id === untouched.evaluationId)!
    const b = tasks.find((t) => t.source_id === started.evaluationId)!

    assert.equal(Number(a.criteria_total), 2)
    assert.equal(Number(a.criteria_scored), 0, '未着手')
    assert.equal(Number(b.criteria_total), 2)
    assert.equal(Number(b.criteria_scored), 1, '途中')
  })

  test('再応募の応募では、軸の総数が1つ増える', async () => {
    const { evaluationId } = await pending({ reapplication: true })
    const tasks = await getOpenTasks(db, season.id)
    const t = tasks.find((x) => x.source_id === evaluationId)!
    assert.equal(Number(t.criteria_total), 3,
      '再応募者限定の軸を数えないと、いつまでも埋まらない分母になる')
  })
})

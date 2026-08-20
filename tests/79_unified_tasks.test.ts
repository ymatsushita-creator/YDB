import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { scalar, type Db } from '../src/db/client.ts'
import {
  baseFixture, makeSeason, makePerson, makeApplication,jst,
  type Fixture, type Season,
} from './support/fixtures.ts'
import { saveScore } from '../src/commands/score.ts'
import { submitEvaluation, getDecidableStep } from '../src/commands/decide.ts'
import {
  getWorkTasks, type UnifiedTask,
} from '../src/queries/tasks.ts'

/**
 * 統合タスク一覧（Phase 4 Step 1）の検証。
 *
 * 見ているのは:
 *   1. 6種が正しく出る
 *   2. 1評価につき競合タスクが複数出ない
 *   3. start_selection と既存4種 / decide が重複しない
 *   4. decide の前後条件（全評価提出前に出ない・提出後に1件・判定後に消える）
 *   5. personal へ特別選考が漏れない
 *   6. owner filter 情報が揃う
 *   7. getDecidableStep が v_decidable_steps 経由でも同じ結果
 */

let db: Db
let fx: Fixture
let season: Season
let interviewer: string
let criteriaByStep: string[][] = []

before(async () => {
  db = await freshDb()
  fx = await baseFixture(db)
  // 4段: 応募受付（0軸）、書類選考、一次面接、最終面接
  season = await makeSeason(db, {
    year: 2027,
    steps: ['応募受付', '書類選考', '一次面接', '最終面接'],
  })

  interviewer = await scalar<string>(db, `
    INSERT INTO staffs (display_name, email)
    VALUES ('面接官 花子', 'hanako@example.test') RETURNING id`)

  // 応募受付には軸を置かない（0軸）。
  // 書類選考・一次面接・最終面接にそれぞれ2軸。
  criteriaByStep = [[]] // step 0 (応募受付) = 0 axes
  for (const stepId of season.stepIds.slice(1)) {
    const ids: string[] = []
    for (const [j, name] of ['軸A', '軸B'].entries()) {
      ids.push(await scalar<string>(db, `
        INSERT INTO evaluation_criteria (selection_step_id, name, scale_max, sort_order)
        VALUES ($1, $2, 5, $3) RETURNING id`, [stepId, name, j + 1]))
    }
    criteriaByStep.push(ids)
  }
})

after(async () => { await db.close() })

const RATIONALE = '検証用の根拠'

/** 応募を作り、応募受付（0軸初段）の評価行を付ける。 */
async function applicationWithIntake() {
  const person = await makePerson(db, fx.schoolId)
  const app = await makeApplication(db, person, season.id, jst('2026-07-01T20:00:00'))
  const evalId = await scalar<string>(db, `
    INSERT INTO evaluations (application_id, selection_step_id, state, assigned_at)
    VALUES ($1, $2, 'pending', now()) RETURNING id`,
    [app, season.stepIds[0]])
  return { person, app, evalId }
}

/** 応募を作るが、評価行は付けない。 */
async function applicationNoEval() {
  const person = await makePerson(db, fx.schoolId)
  const app = await makeApplication(db, person, season.id, jst('2026-07-01T20:00:00'))
  return { person, app }
}

/** 応募を書類選考（step 1、軸あり）まで進めた状態。 */
async function applicationAtStep1(opts: {
  owner?: string | null
  state?: 'pending' | 'held'
} = {}) {
  const person = await makePerson(db, fx.schoolId)
  const app = await makeApplication(db, person, season.id, jst('2026-07-01T20:00:00'))
  const evalId = await scalar<string>(db, `
    INSERT INTO evaluations (application_id, selection_step_id,
                             interviewer_staff_id, state, assigned_at, hold_reason)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [app, season.stepIds[1],
     opts.owner === undefined ? interviewer : opts.owner,
     opts.state ?? 'pending',
     jst('2026-07-05T10:00:00'),
     opts.state === 'held' ? '日程を再調整中' : null])
  return { person, app, evalId }
}

/** 全軸に点を付けて確定する。 */
async function scoreAndSubmit(evaluationId: string, stepIndex: number) {
  for (const criteriaId of criteriaByStep[stepIndex]!) {
    const r = await saveScore(db, { evaluationId, criteriaId, score: 4, rationale: RATIONALE })
    assert.equal(r.ok, true, `scoring failed: ${criteriaId}`)
  }
  const r = await submitEvaluation(db, { evaluationId })
  assert.equal(r.ok, true, 'submit failed')
}

/** scope ごとにタスクを取得する。 */
const tasksAll = () => getWorkTasks(db, { seasonId: season.id, tier: 'all' })
const tasksPersonal = () => getWorkTasks(db, { seasonId: season.id, tier: 'personal' })

/** 応募のタスクだけ抽出する。 */
function tasksFor(tasks: UnifiedTask[], applicationId: string) {
  return tasks.filter((t) => t.application_id === applicationId)
}

// -----------------------------------------------------------------
// start_selection
// -----------------------------------------------------------------

describe('start_selection', () => {
  test('評価行がない応募は start_selection として出る', async () => {
    const { app } = await applicationNoEval()
    const tasks = tasksFor(await tasksAll(), app)
    assert.equal(tasks.length, 1)
    assert.equal(tasks[0]!.kind, 'start_selection')
    assert.equal(tasks[0]!.task_key, `start_selection:${app}`)
    assert.equal(tasks[0]!.owner_scope, 'team')
    assert.equal(tasks[0]!.owner_staff_id, null)
    // 待機起点は応募日時
    assert.ok(tasks[0]!.waiting_days >= 0)
  })

  test('0軸初段の評価がある応募は start_selection として出る', async () => {
    const { app } = await applicationWithIntake()
    const tasks = tasksFor(await tasksAll(), app)
    assert.equal(tasks.length, 1, `${tasks.length} tasks instead of 1`)
    assert.equal(tasks[0]!.kind, 'start_selection')
    // 0軸の評価は既存4種に出ない
    assert.ok(!tasks.some((t) => t.kind === 'evaluate'))
    assert.ok(!tasks.some((t) => t.kind === 'assign'))
  })

  test('0軸初段と既存4種が重複しない', async () => {
    const { app } = await applicationWithIntake()
    const all = await tasksAll()
    const appTasks = tasksFor(all, app)
    const types = appTasks.map((t) => t.kind)
    // start_selection だけ。assign/evaluate は出ない
    assert.deepEqual(types, ['start_selection'])
  })

  test('軸が1件でもある初段は通常の実評価として扱う', async () => {
    // 応募受付に軸を1つ足す別の期を作る
    const s2 = await makeSeason(db, { year: 2028, steps: ['応募受付', '最終面接'] })
    await scalar<string>(db, `
      INSERT INTO evaluation_criteria (selection_step_id, name, scale_max, sort_order)
      VALUES ($1, '入口確認', 5, 1) RETURNING id`, [s2.stepIds[0]])
    const person = await makePerson(db, fx.schoolId)
    const app = await makeApplication(db, person, s2.id, jst('2026-06-01T20:00:00'))
    await scalar<string>(db, `
      INSERT INTO evaluations (application_id, selection_step_id,
                               interviewer_staff_id, state, assigned_at)
      VALUES ($1, $2, $3, 'pending', now()) RETURNING id`,
      [app, s2.stepIds[0], interviewer])
    const tasks = tasksFor(await getWorkTasks(db, { seasonId: s2.id, tier: 'all' }), app)
    assert.equal(tasks.length, 1)
    assert.equal(tasks[0]!.kind, 'evaluate',
      '軸のある応募受付は start_selection ではなく evaluate')
  })

  test('0軸応募受付が held の場合も start_selection 1件で detail に保留理由が入る', async () => {
    const HOLD_REASON = '書類追加提出待ち'
    const person = await makePerson(db, fx.schoolId)
    const app = await makeApplication(db, person, season.id, jst('2026-07-01T20:00:00'))
    await scalar<string>(db, `
      INSERT INTO evaluations (application_id, selection_step_id,
                               state, assigned_at, hold_reason)
      VALUES ($1, $2, 'held', now(), $3) RETURNING id`,
      [app, season.stepIds[0], HOLD_REASON])
    const tasks = tasksFor(await tasksAll(), app)
    assert.equal(tasks.length, 1, 'held な0軸応募受付がstart_selection 1件にならない')
    assert.equal(tasks[0]!.kind, 'start_selection')
    assert.equal(tasks[0]!.detail, HOLD_REASON,
      'detail に保留理由が入っていない')
  })
})

// -----------------------------------------------------------------
// 既存4種
// -----------------------------------------------------------------

describe('既存4種（reassign → unhold → assign → evaluate）', () => {
  test('担当ありで evaluate、担当なしで assign', async () => {
    const withOwner = await applicationAtStep1()
    const noOwner = await applicationAtStep1({ owner: null })
    const tasks = await tasksAll()
    const ev = tasksFor(tasks, withOwner.app)
    const as = tasksFor(tasks, noOwner.app)
    assert.equal(ev.length, 1)
    assert.equal(ev[0]!.kind, 'evaluate')
    assert.equal(ev[0]!.owner_scope, 'staff')
    assert.equal(as.length, 1)
    assert.equal(as[0]!.kind, 'assign')
    assert.equal(as[0]!.owner_scope, 'unassigned')
  })

  test('保留は unhold', async () => {
    const { app } = await applicationAtStep1({ state: 'held' })
    const tasks = tasksFor(await tasksAll(), app)
    assert.equal(tasks.length, 1)
    assert.equal(tasks[0]!.kind, 'unhold')
    assert.equal(tasks[0]!.owner_scope, 'staff')
  })

  test('利益相反は reassign', async () => {
    const mentorPerson = await makePerson(db, fx.schoolId)
    const mentorStaff = await scalar<string>(db, `
      INSERT INTO staffs (person_id, display_name, email)
      VALUES ($1, '紹介者スタッフ', 'ref79@example.test') RETURNING id`,
      [mentorPerson])
    const person = await makePerson(db, fx.schoolId, { referrerPersonId: mentorPerson })
    const app = await makeApplication(db, person, season.id, jst('2026-07-01T20:00:00'))
    await scalar<string>(db, `
      INSERT INTO evaluations (application_id, selection_step_id,
                               interviewer_staff_id, state, assigned_at)
      VALUES ($1, $2, $3, 'pending', $4) RETURNING id`,
      [app, season.stepIds[1], mentorStaff, jst('2026-07-05T10:00:00')])
    const tasks = tasksFor(await tasksAll(), app)
    assert.equal(tasks.length, 1)
    assert.equal(tasks[0]!.kind, 'reassign')
    assert.equal(tasks[0]!.owner_scope, 'staff')
  })

  test('source_id が evaluation ID と一致する', async () => {
    const { app, evalId } = await applicationAtStep1()
    const tasks = tasksFor(await tasksAll(), app)
    assert.equal(tasks.length, 1)
    assert.equal(tasks[0]!.kind, 'evaluate')
    const t = tasks[0] as import('../src/queries/tasks.ts').EvalTask
    assert.equal(t.source_id, evalId)
    assert.equal(t.task_key, `evaluate:${evalId}`)
  })

  test('criteria_total / criteria_scored が正しい', async () => {
    const { app, evalId } = await applicationAtStep1()
    // 1軸だけ採点
    await saveScore(db, {
      evaluationId: evalId,
      criteriaId: criteriaByStep[1]![0]!,
      score: 3, rationale: RATIONALE,
    })
    const tasks = tasksFor(await tasksAll(), app)
    assert.equal(tasks[0]!.criteria_total, 2)
    assert.equal(tasks[0]!.criteria_scored, 1)
  })
})

// -----------------------------------------------------------------
// decide
// -----------------------------------------------------------------

describe('decide', () => {
  test('全評価提出前に decide は出ない', async () => {
    const { app, evalId } = await applicationAtStep1()
    // 点を付けたが確定していない
    for (const criteriaId of criteriaByStep[1]!) {
      await saveScore(db, { evaluationId: evalId, criteriaId, score: 4, rationale: RATIONALE })
    }
    const tasks = tasksFor(await tasksAll(), app)
    assert.ok(!tasks.some((t) => t.kind === 'decide'),
      '確定前に decide が出ている')
  })

  test('全評価提出後に decide が1件出る', async () => {
    const { app, evalId } = await applicationAtStep1()
    await scoreAndSubmit(evalId, 1)
    const tasks = tasksFor(await tasksAll(), app)
    const decides = tasks.filter((t) => t.kind === 'decide')
    assert.equal(decides.length, 1, 'decide は1件だけ')
    assert.equal(decides[0]!.task_key, `decide:${app}:${season.stepIds[1]}`)
    assert.equal(decides[0]!.owner_scope, 'team')
    assert.equal(decides[0]!.step_name, '書類選考')
    const d = decides[0] as import('../src/queries/tasks.ts').DecideTask
    assert.equal(d.submitted_evaluations, 1)
    // 確定済みの evaluate は消えている
    assert.ok(!tasks.some((t) => t.kind === 'evaluate'))
  })

  test('面接官2人の場合、両方提出後にだけ decide が出る', async () => {
    const second = await scalar<string>(db, `
      INSERT INTO staffs (display_name, email)
      VALUES ('面接官 二郎', 'jiro79@example.test') RETURNING id`)
    const { app, evalId } = await applicationAtStep1()
    // 同じステップに2人目の面接官
    const evalId2 = await scalar<string>(db, `
      INSERT INTO evaluations (application_id, selection_step_id,
                               interviewer_staff_id, state, assigned_at)
      VALUES ($1, $2, $3, 'pending', $4) RETURNING id`,
      [app, season.stepIds[1], second, jst('2026-07-05T10:00:00')])

    // 1人目だけ確定
    await scoreAndSubmit(evalId, 1)
    let tasks = tasksFor(await tasksAll(), app)
    assert.ok(!tasks.some((t) => t.kind === 'decide'),
      '片方だけ提出で decide が出ている')

    // 2人目も確定
    await scoreAndSubmit(evalId2, 1)
    tasks = tasksFor(await tasksAll(), app)
    const decides = tasks.filter((t) => t.kind === 'decide')
    assert.equal(decides.length, 1)
    const d = decides[0] as import('../src/queries/tasks.ts').DecideTask
    assert.equal(d.submitted_evaluations, 2)
    assert.equal(d.criteria_total, 4, '2人×2軸で criteria_total=4')
    assert.equal(d.criteria_scored, 4, '全軸採点済みで criteria_scored=4')
  })

  test('判定後に decide は消える', async () => {
    const { app, evalId } = await applicationAtStep1()
    await scoreAndSubmit(evalId, 1)
    // 判定を記録
    await db.query(`
      INSERT INTO status_histories
        (application_id, transition_type, selection_step_id,
         occurred_at, changed_by_staff_id)
      VALUES ($1, 'advance', $2, now(), $3)`,
      [app, season.stepIds[1], fx.staffId])
    const tasks = tasksFor(await tasksAll(), app)
    assert.ok(!tasks.some((t) => t.kind === 'decide'),
      '判定後も decide が残っている')
  })

  test('decide の待機起点は最終 submitted_at', async () => {
    const { app, evalId } = await applicationAtStep1()
    await scoreAndSubmit(evalId, 1)
    const tasks = tasksFor(await tasksAll(), app)
    const d = tasks.find((t) => t.kind === 'decide')
    assert.ok(d)
    // waiting_days >= 0（提出直後）
    assert.ok(d.waiting_days >= 0)
  })
})

// -----------------------------------------------------------------
// 重複防止
// -----------------------------------------------------------------

describe('重複防止', () => {
  test('1評価につき競合タスクは1件だけ', async () => {
    const { app } = await applicationAtStep1()
    const tasks = tasksFor(await tasksAll(), app)
    assert.equal(tasks.length, 1)
  })

  test('start_selection と decide は同時に出ない', async () => {
    // 0軸初段の応募は start_selection だけ
    const { app } = await applicationWithIntake()
    const tasks = tasksFor(await tasksAll(), app)
    assert.ok(!tasks.some((t) => t.kind === 'decide'))
    assert.equal(tasks.length, 1)
    assert.equal(tasks[0]!.kind, 'start_selection')
  })
})

// -----------------------------------------------------------------
// tier フィルタ
// -----------------------------------------------------------------

describe('tier フィルタ', () => {
  test('personal に特別選考のタスクが漏れない', async () => {
    // 特別選考ステップを追加
    const specialStepId = await scalar<string>(db, `
      INSERT INTO selection_steps (season_id, sort_order, name, sla_days)
      VALUES ($1, 99, '特別選考', 7) RETURNING id`, [season.id])
    await scalar<string>(db, `
      INSERT INTO evaluation_criteria (selection_step_id, name, scale_max, sort_order)
      VALUES ($1, '特別軸', 4, 1) RETURNING id`, [specialStepId])
    const person = await makePerson(db, fx.schoolId)
    const app = await makeApplication(db, person, season.id, jst('2026-07-01T20:00:00'))
    await scalar<string>(db, `
      INSERT INTO evaluations (application_id, selection_step_id,
                               interviewer_staff_id, state, assigned_at)
      VALUES ($1, $2, $3, 'pending', now()) RETURNING id`,
      [app, specialStepId, interviewer])

    const personalTasks = tasksFor(await tasksPersonal(), app)
    assert.equal(personalTasks.length, 0, '特別選考が personal に出ている')

    const allTasks = tasksFor(await tasksAll(), app)
    assert.ok(allTasks.length >= 1, '特別選考が all にも出ていない')
  })
})

// -----------------------------------------------------------------
// owner 情報
// -----------------------------------------------------------------

describe('owner 情報', () => {
  test('evaluate は担当の名前と ID を持つ', async () => {
    const { app } = await applicationAtStep1()
    const tasks = tasksFor(await tasksAll(), app)
    const t = tasks[0]!
    assert.equal(t.owner_name, '面接官 花子')
    assert.equal(t.owner_staff_id, interviewer)
    assert.equal(t.owner_scope, 'staff')
  })

  test('assign は owner が null で scope が unassigned', async () => {
    const { app } = await applicationAtStep1({ owner: null })
    const tasks = tasksFor(await tasksAll(), app)
    assert.equal(tasks[0]!.owner_staff_id, null)
    assert.equal(tasks[0]!.owner_name, null)
    assert.equal(tasks[0]!.owner_scope, 'unassigned')
  })

  test('start_selection / decide は team', async () => {
    const { app: startApp } = await applicationNoEval()
    const { app: decideApp, evalId } = await applicationAtStep1()
    await scoreAndSubmit(evalId, 1)

    const tasks = await tasksAll()
    const start = tasksFor(tasks, startApp).find((t) => t.kind === 'start_selection')
    const decide = tasksFor(tasks, decideApp).find((t) => t.kind === 'decide')
    assert.ok(start)
    assert.equal(start.owner_scope, 'team')
    assert.ok(decide)
    assert.equal(decide.owner_scope, 'team')
  })
})

// -----------------------------------------------------------------
// 並び順
// -----------------------------------------------------------------

describe('並び順', () => {
  test('隣接行: is_overdue降順 → waiting_days降順 → step_order昇順 → task_key昇順', async () => {
    const tasks = await tasksAll()
    for (let i = 0; i < tasks.length - 1; i++) {
      const a = tasks[i]!
      const b = tasks[i + 1]!
      // is_overdue: true が先（false より先）
      if (a.is_overdue !== b.is_overdue) {
        assert.ok(a.is_overdue,
          `[${i}→${i + 1}] is_overdue の順が逆: a=${a.is_overdue}, b=${b.is_overdue}`)
        continue
      }
      // waiting_days: 降順
      if (a.waiting_days !== b.waiting_days) {
        assert.ok(a.waiting_days >= b.waiting_days,
          `[${i}→${i + 1}] waiting_days 降順違反: ${a.waiting_days} < ${b.waiting_days}`)
        continue
      }
      // step_order: 昇順
      if (a.step_order !== b.step_order) {
        assert.ok(a.step_order <= b.step_order,
          `[${i}→${i + 1}] step_order 昇順違反: ${a.step_order} > ${b.step_order}`)
        continue
      }
      // task_key: 文字列昇順
      assert.ok(a.task_key <= b.task_key,
        `[${i}→${i + 1}] task_key 昇順違反: "${a.task_key}" > "${b.task_key}"`)
    }
  })
})

// -----------------------------------------------------------------
// getDecidableStep の互換性（v_decidable_steps 経由）
// -----------------------------------------------------------------

describe('getDecidableStep の互換性', () => {
  test('v_decidable_steps 経由でも同じ結果を返す', async () => {
    const { app, evalId } = await applicationAtStep1()
    await scoreAndSubmit(evalId, 1)

    const step = await getDecidableStep(db, app)
    assert.ok(step, '判定可能ステップが返らない')
    assert.equal(step.step_name, '書類選考')
    assert.equal(step.next_step_name, '一次面接')
    assert.equal(Number(step.submitted_evaluations), 1)
  })

  test('評価が残っていると null', async () => {
    const { app } = await applicationAtStep1()
    assert.equal(await getDecidableStep(db, app), null)
  })

  test('壊れた id は null', async () => {
    assert.equal(await getDecidableStep(db, 'not-a-uuid'), null)
  })
})

// -----------------------------------------------------------------
// step / season 情報
// -----------------------------------------------------------------

describe('step / season 情報', () => {
  test('全タスク共通フィールドが揃っている', async () => {
    const tasks = await tasksAll()
    assert.ok(tasks.length > 0, 'タスクが1件もない')
    for (const t of tasks) {
      // 非空文字列
      assert.ok(t.source_id,      `source_id 空: kind=${t.kind}`)
      assert.ok(t.task_key,       `task_key 空: kind=${t.kind}`)
      assert.ok(t.application_id, `application_id 空: kind=${t.kind}`)
      assert.ok(t.person_id,   `person_id 空: kind=${t.kind}`)
      assert.ok(t.season_id,      `season_id 空: kind=${t.kind}`)
      assert.ok(t.step_name,      `step_name 空: kind=${t.kind}`)
      // 数値
      assert.ok(typeof t.step_order === 'number',
        `step_order が数値でない: kind=${t.kind}`)
      assert.ok(typeof t.enrollment_year === 'number',
        `enrollment_year が数値でない: kind=${t.kind}`)
      // number | null
      const cohort = t.cohort_number
      assert.ok(cohort === null || typeof cohort === 'number',
        `cohort_number が number|null でない: kind=${t.kind}`)
      // Date
      assert.ok(t.since instanceof Date,
        `since が Date でない: kind=${t.kind}`)
      // string | null
      const detail = t.detail
      assert.ok(detail === null || typeof detail === 'string',
        `detail が string|null でない: kind=${t.kind}`)
      // sla_days null → overdue_days null、sla_days あり → overdue_days >= 0
      const sla = t.sla_days
      const overdue = t.overdue_days
      if (sla === null) {
        assert.equal(overdue, null,
          `sla_days null なのに overdue_days が null でない: kind=${t.kind}`)
      } else {
        assert.ok(typeof overdue === 'number' && overdue >= 0,
          `sla_days あり なのに overdue_days が 0以上の数値でない: kind=${t.kind}, overdue_days=${overdue}`)
      }
    }
  })
})

// -----------------------------------------------------------------
// focused 4件
// -----------------------------------------------------------------

describe('focused: input tier は SQL を実行しない', () => {
  test('tier=input なら query を呼ばずに [] を返す', async () => {
    const fakeDb = {
      query: () => { throw new Error('SQL が呼ばれた') },
    } as unknown as Db
    const result = await getWorkTasks(fakeDb, { seasonId: 'any', tier: 'input' })
    assert.deepEqual(result, [])
  })
})

describe('focused: 0軸かつ応募受付以外は start_selection にならない', () => {
  test('0軸の非応募受付ステップは assign になる', async () => {
    const s3 = await makeSeason(db, { year: 2029, steps: ['応募受付', 'フォロー', '最終面接'] })
    for (const [i, name] of (['軸X', '軸Y'] as const).entries()) {
      await scalar<string>(db, `
        INSERT INTO evaluation_criteria (selection_step_id, name, scale_max, sort_order)
        VALUES ($1, $2, 5, $3) RETURNING id`, [s3.stepIds[2], name, i + 1])
    }
    const person = await makePerson(db, fx.schoolId)
    const app = await makeApplication(db, person, s3.id, jst('2026-07-01T20:00:00'))
    await scalar<string>(db, `
      INSERT INTO evaluations (application_id, selection_step_id,
                               interviewer_staff_id, state, assigned_at)
      VALUES ($1, $2, null, 'pending', now()) RETURNING id`,
      [app, s3.stepIds[1]])
    const tasks = tasksFor(await getWorkTasks(db, { seasonId: s3.id, tier: 'all' }), app)
    assert.equal(tasks.length, 1)
    assert.notEqual(tasks[0]!.kind, 'start_selection',
      '0軸でも応募受付以外は start_selection にならない')
    assert.equal(tasks[0]!.kind, 'assign')
  })
})

describe('focused: owner=null かつ state=held', () => {
  test('担当なし保留は unhold かつ owner_scope=unassigned・owner_staff_id=null', async () => {
    const { app } = await applicationAtStep1({ owner: null, state: 'held' })
    const tasks = tasksFor(await tasksAll(), app)
    assert.equal(tasks.length, 1)
    assert.equal(tasks[0]!.kind, 'unhold')
    assert.equal(tasks[0]!.owner_scope, 'unassigned')
    assert.equal(tasks[0]!.owner_staff_id, null)
  })
})

describe('focused: start_selection・decide の source_id', () => {
  test('source_id が application_id、decide の key に stepId を含む', async () => {
    const { app: startApp } = await applicationNoEval()
    const { app: decideApp, evalId } = await applicationAtStep1()
    await scoreAndSubmit(evalId, 1)

    const tasks = await tasksAll()

    const startTask = tasksFor(tasks, startApp).find((t) => t.kind === 'start_selection')
    assert.ok(startTask, 'start_selection タスクが見つからない')
    assert.equal(startTask.source_id, startApp)

    const decideTask = tasksFor(tasks, decideApp).find((t) => t.kind === 'decide')
    assert.ok(decideTask, 'decide タスクが見つからない')
    const d = decideTask as import('../src/queries/tasks.ts').DecideTask
    assert.equal(d.source_id, decideApp)
    assert.ok(decideTask.task_key.includes(season.stepIds[1]!),
      `decide の task_key に stepId が含まれない: ${decideTask.task_key}`)
  })
})

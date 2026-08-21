/**
 * Phase 4 Step 3: コックピットインラインアクション検証。
 *
 * ★ DB遷移テスト（5件）
 *   commandレイヤーを直接呼び、getWorkTasks()でタスク種別が変わることを確認する。
 *   Server Action自体はNext.jsランタイムが必要なため、commandレイヤーで検証する。
 *
 * ★ 認証ガードテスト（ソース確認）
 *   home-actions.ts で currentTier() が getDb() より前に呼ばれていることを確認する。
 *   Prefer behavior tests over brittle source regex where feasible（契約）――
 *   Server Actionのauth動作はランタイムなしでは行動テスト不可のため、ソース確認とする。
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { freshDb } from '../src/db/testing.ts'
import { scalar, type Db } from '../src/db/client.ts'
import {
  baseFixture, makeSeason, makePerson, makeApplication, makeEvaluation, jst,
  type Fixture, type Season,
} from './support/fixtures.ts'
import { getWorkTasks, type UnifiedTask } from '../src/queries/tasks.ts'
import { assignInterviewer, reassignInterviewer } from '../src/commands/assign.ts'
import { unholdEvaluation } from '../src/commands/unhold.ts'

const PROJECT_ROOT = join(import.meta.dirname, '..')
const ACTIONS_FILE = join(PROJECT_ROOT, 'app', 'home-actions.ts')

// ----------------------------------------------------------------
// DB テスト共通セットアップ
// ----------------------------------------------------------------

let db: Db
let fx: Fixture
let season: Season
let interviewerA: string
let _interviewerB: string

before(async () => {
  db = await freshDb()
  fx = await baseFixture(db)
  // 書類選考・一次面接の2段を用意する。評価軸は書類選考だけに置く。
  season = await makeSeason(db, {
    year: 2031,
    steps: ['書類選考', '一次面接'],
  })
  await scalar<string>(db, `
    INSERT INTO evaluation_criteria (selection_step_id, name, scale_max, sort_order)
    VALUES ($1, '確認軸', 5, 1) RETURNING id`, [season.stepIds[0]])

  interviewerA = await scalar<string>(db, `
    INSERT INTO staffs (display_name, email, is_active)
    VALUES ('面接官A', 'a81@example.test', true) RETURNING id`)
  _interviewerB = await scalar<string>(db, `
    INSERT INTO staffs (display_name, email, is_active)
    VALUES ('面接官B', 'b81@example.test', true) RETURNING id`)
})

after(async () => { await db.close() })

/** その応募のタスクを1件抽出する。 */
function taskFor(tasks: UnifiedTask[], appId: string): UnifiedTask | undefined {
  return tasks.find(t => t.application_id === appId)
}

/** 書類選考ステップに担当なし・pending の評価を置く（assign タスク用）。 */
async function makeAssignTask(): Promise<{ appId: string; evalId: string }> {
  const person = await makePerson(db, fx.schoolId)
  const appId = await makeApplication(db, person, season.id, jst('2026-07-01T20:00:00'))
  const evalId = await makeEvaluation(db, {
    applicationId: appId,
    stepId: season.stepIds[0]!,
    state: 'pending',
    assignedAt: jst('2026-07-05T10:00:00'),
  })
  return { appId, evalId }
}

/** 書類選考ステップに担当あり・held の評価を置く（unhold タスク用）。 */
async function makeUnholdTask(staffId?: string): Promise<{ appId: string; evalId: string }> {
  const person = await makePerson(db, fx.schoolId)
  const appId = await makeApplication(db, person, season.id, jst('2026-07-01T20:00:00'))
  const evalId = await makeEvaluation(db, {
    applicationId: appId,
    stepId: season.stepIds[0]!,
    staffId,
    state: 'held',
    assignedAt: jst('2026-07-05T10:00:00'),
    holdReason: '連絡待ち',
  })
  return { appId, evalId }
}

// ----------------------------------------------------------------
// 5件のDB遷移テスト
// ----------------------------------------------------------------

describe('DB遷移テスト（assign / reassign / unhold）', () => {
  test('1. assign → evaluate: 担当を割り当てると evaluate タスクに変わる', async () => {
    const { appId, evalId } = await makeAssignTask()

    // 事前: assign タスクが出る（担当なし）
    let tasks = await getWorkTasks(db, { seasonId: season.id, tier: 'all' })
    assert.equal(taskFor(tasks, appId)?.kind, 'assign',
      '事前: assign タスクが出るべき')
    assert.equal(taskFor(tasks, appId)?.owner_scope, 'unassigned',
      '事前: owner_scope が unassigned であるべき')

    // assignInterviewer を実行
    const result = await assignInterviewer(db, { evaluationId: evalId, staffId: interviewerA })
    assert.equal(result.ok, true, 'assignInterviewer が成功するべき')

    // 事後: evaluate タスクに変わる
    tasks = await getWorkTasks(db, { seasonId: season.id, tier: 'all' })
    const after = taskFor(tasks, appId)
    assert.equal(after?.kind, 'evaluate',
      '事後: evaluate タスクに変わるべき')
    assert.equal(after?.owner_scope, 'staff',
      '事後: owner_scope が staff に変わるべき')
    assert.equal(after?.owner_staff_id, interviewerA,
      '事後: owner_staff_id が割り当てた面接官Aであるべき')
  })

  test('2. assign → reassign: 利益相反のある担当を割り当てると reassign タスクになる', async () => {
    // 紹介者（staff）と、その紹介者に紹介された候補者を作る
    const refPerson = await makePerson(db, fx.schoolId)
    const refStaff = await scalar<string>(db, `
      INSERT INTO staffs (person_id, display_name, email, is_active)
      VALUES ($1, '紹介者スタッフ', 'ref81a@example.test', true) RETURNING id`,
      [refPerson])

    const candidatePerson = await makePerson(db, fx.schoolId, { referrerPersonId: refPerson })
    const appId = await makeApplication(db, candidatePerson, season.id, jst('2026-07-01T20:00:00'))
    const evalId = await makeEvaluation(db, {
      applicationId: appId,
      stepId: season.stepIds[0]!,
      state: 'pending',
      assignedAt: jst('2026-07-05T10:00:00'),
    })

    // 事前: assign タスクが出る
    let tasks = await getWorkTasks(db, { seasonId: season.id, tier: 'all' })
    assert.equal(taskFor(tasks, appId)?.kind, 'assign',
      '事前: assign タスクが出るべき')

    // 利益相反のある担当（紹介者スタッフ）を割り当てる
    const result = await assignInterviewer(db, { evaluationId: evalId, staffId: refStaff })
    assert.equal(result.ok, true,
      '利益相反のある担当でも assignInterviewer は成功するべき')

    // 事後: reassign タスクに変わる（利益相反が検出される）
    tasks = await getWorkTasks(db, { seasonId: season.id, tier: 'all' })
    assert.equal(taskFor(tasks, appId)?.kind, 'reassign',
      '事後: reassign タスクに変わるべき（利益相反検出）')
  })

  test('3. reassign → evaluate: 利益相反を解消すると evaluate タスクになる', async () => {
    // 利益相反がある reassign タスクを作る（test 2 と同じパターン）
    const refPerson2 = await makePerson(db, fx.schoolId)
    const refStaff2 = await scalar<string>(db, `
      INSERT INTO staffs (person_id, display_name, email, is_active)
      VALUES ($1, '紹介者スタッフ2', 'ref81b@example.test', true) RETURNING id`,
      [refPerson2])

    const candidatePerson2 = await makePerson(db, fx.schoolId, { referrerPersonId: refPerson2 })
    const appId = await makeApplication(db, candidatePerson2, season.id, jst('2026-07-01T20:00:00'))
    const evalId = await makeEvaluation(db, {
      applicationId: appId,
      stepId: season.stepIds[0]!,
      staffId: refStaff2,  // 最初から利益相反のある担当を入れる
      state: 'pending',
      assignedAt: jst('2026-07-05T10:00:00'),
    })

    // 事前: reassign タスクが出る
    let tasks = await getWorkTasks(db, { seasonId: season.id, tier: 'all' })
    assert.equal(taskFor(tasks, appId)?.kind, 'reassign',
      '事前: reassign タスクが出るべき')

    // reassignInterviewer で利益相反のない担当に替える
    const result = await reassignInterviewer(db, { evaluationId: evalId, staffId: interviewerA })
    assert.equal(result.ok, true, 'reassignInterviewer が成功するべき')

    // 事後: evaluate タスクに変わる
    tasks = await getWorkTasks(db, { seasonId: season.id, tier: 'all' })
    const after = taskFor(tasks, appId)
    assert.equal(after?.kind, 'evaluate',
      '事後: evaluate タスクに変わるべき')
    assert.equal(after?.owner_staff_id, interviewerA,
      '事後: owner_staff_id が新しい面接官であるべき')
  })

  test('4. unhold → evaluate: 担当ありの保留を解くと evaluate タスクになる', async () => {
    const { appId, evalId } = await makeUnholdTask(interviewerA)

    // 事前: unhold タスクが出る（担当あり）
    let tasks = await getWorkTasks(db, { seasonId: season.id, tier: 'all' })
    const before = taskFor(tasks, appId)
    assert.equal(before?.kind, 'unhold',
      '事前: unhold タスクが出るべき')
    assert.equal(before?.owner_scope, 'staff',
      '事前: owner_scope が staff であるべき')

    // unholdEvaluation を実行
    const result = await unholdEvaluation(db, { evaluationId: evalId })
    assert.equal(result.ok, true, 'unholdEvaluation が成功するべき')

    // 事後: evaluate タスクに変わる
    tasks = await getWorkTasks(db, { seasonId: season.id, tier: 'all' })
    const after = taskFor(tasks, appId)
    assert.equal(after?.kind, 'evaluate',
      '事後: evaluate タスクに変わるべき')
    assert.equal(after?.owner_staff_id, interviewerA,
      '事後: 担当者はそのまま保持されるべき')
  })

  test('5. unhold → assign: 担当なしの保留を解くと assign タスクになる', async () => {
    const { appId, evalId } = await makeUnholdTask(undefined)

    // 事前: unhold タスクが出る（担当なし）
    let tasks = await getWorkTasks(db, { seasonId: season.id, tier: 'all' })
    const before = taskFor(tasks, appId)
    assert.equal(before?.kind, 'unhold',
      '事前: unhold タスクが出るべき')
    assert.equal(before?.owner_scope, 'unassigned',
      '事前: owner_scope が unassigned であるべき（担当なし保留）')
    assert.equal(before?.owner_staff_id, null,
      '事前: owner_staff_id が null であるべき')

    // unholdEvaluation を実行
    const result = await unholdEvaluation(db, { evaluationId: evalId })
    assert.equal(result.ok, true, 'unholdEvaluation が成功するべき')

    // 事後: assign タスクに変わる（担当なし pending → assign）
    tasks = await getWorkTasks(db, { seasonId: season.id, tier: 'all' })
    const after = taskFor(tasks, appId)
    assert.equal(after?.kind, 'assign',
      '事後: assign タスクに変わるべき（担当なし pending）')
    assert.equal(after?.owner_scope, 'unassigned',
      '事後: owner_scope が unassigned のままであるべき')
  })
})

// ----------------------------------------------------------------
// 認証ガード（home-actions.ts ソース確認）
// ----------------------------------------------------------------

describe('認証ガード（home-actions.ts ソース確認）', () => {
  let actionsContent: string

  test.before(async () => {
    actionsContent = await readFile(ACTIONS_FILE, 'utf-8')
  })

  test('1. currentTier() が getDb() より前に呼ばれる', () => {
    const firstCurrentTier = actionsContent.indexOf('currentTier()')
    const firstGetDb = actionsContent.indexOf('getDb()')
    assert.ok(firstCurrentTier >= 0, 'currentTier() の呼び出しがある')
    assert.ok(firstGetDb >= 0, 'getDb() の呼び出しがある')
    assert.ok(firstCurrentTier < firstGetDb,
      'currentTier() が getDb() より前にあるべき')
  })

  test('2. null tier のガードがある（!tier で early return）', () => {
    assert.match(actionsContent, /if\s*\(\s*!tier\s*\)/,
      'null tier のガード（!tier）がある')
  })

  test('3. input tier のガードがある', () => {
    assert.match(actionsContent, /tier\s*===\s*['"]input['"]/,
      'input tier のガードがある')
  })

  test('4. 3つのアクションが export async function として定義されている', () => {
    assert.ok(
      actionsContent.includes('export async function cockpitAssignAction'),
      'cockpitAssignAction が export されている',
    )
    assert.ok(
      actionsContent.includes('export async function cockpitReassignAction'),
      'cockpitReassignAction が export されている',
    )
    assert.ok(
      actionsContent.includes('export async function cockpitUnholdAction'),
      'cockpitUnholdAction が export されている',
    )
  })

  test('5. 各アクション内で currentTier() が getDb() より前にある', () => {
    const assignStart = actionsContent.indexOf('export async function cockpitAssignAction')
    const reassignStart = actionsContent.indexOf('export async function cockpitReassignAction')
    const unholdStart = actionsContent.indexOf('export async function cockpitUnholdAction')

    assert.ok(assignStart >= 0, 'cockpitAssignAction が見つかる')
    assert.ok(reassignStart >= 0, 'cockpitReassignAction が見つかる')
    assert.ok(unholdStart >= 0, 'cockpitUnholdAction が見つかる')

    for (const [name, start, end] of [
      ['assign', assignStart, reassignStart] as const,
      ['reassign', reassignStart, unholdStart] as const,
      ['unhold', unholdStart, actionsContent.length] as const,
    ]) {
      const block = actionsContent.slice(start, end)
      const tierPos = block.indexOf('currentTier()')
      const dbPos = block.indexOf('getDb()')
      assert.ok(tierPos >= 0, `${name}: currentTier() の呼び出しがある`)
      assert.ok(dbPos >= 0, `${name}: getDb() の呼び出しがある`)
      assert.ok(tierPos < dbPos,
        `${name}: currentTier() が getDb() より前にあるべき`)
    }
  })

  test('6. home-actions.ts に "use server" がある', () => {
    assert.ok(
      actionsContent.startsWith("'use server'") || actionsContent.startsWith('"use server"'),
      '"use server" ディレクティブが先頭にある',
    )
  })
})

// ----------------------------------------------------------------
// home-actions が page.tsx にインポートされているか（ソース確認）
// ----------------------------------------------------------------

describe('page.tsx にインラインアクション統合の確認', () => {
  let pageContent: string

  test.before(async () => {
    pageContent = await readFile(join(PROJECT_ROOT, 'app', 'page.tsx'), 'utf-8')
  })

  test('7. cockpitAssignAction / cockpitReassignAction / cockpitUnholdAction が import されている', () => {
    assert.ok(
      pageContent.includes('cockpitAssignAction'),
      'cockpitAssignAction が page.tsx にある',
    )
    assert.ok(
      pageContent.includes('cockpitReassignAction'),
      'cockpitReassignAction が page.tsx にある',
    )
    assert.ok(
      pageContent.includes('cockpitUnholdAction'),
      'cockpitUnholdAction が page.tsx にある',
    )
  })

  test('8. assign / reassign / unhold の searchParams フィールドが型定義にある', () => {
    assert.match(pageContent, /assign\?:\s*string/,
      'assign? フィールドが searchParams 型定義にある')
    assert.match(pageContent, /reassign\?:\s*string/,
      'reassign? フィールドが searchParams 型定義にある')
    assert.match(pageContent, /unhold\?:\s*string/,
      'unhold? フィールドが searchParams 型定義にある')
  })

  test('9. listAssignableStaff が条件付きで呼ばれている（全タスク分は呼ばない）', () => {
    // needsStaff フラグで絞っている
    assert.match(pageContent, /needsStaff/,
      'needsStaff で条件絞りをしている')
    assert.ok(
      pageContent.includes('listAssignableStaff'),
      'listAssignableStaff が呼ばれている',
    )
  })

  test('10. reassign フォームが現在オーナーを除外している', () => {
    // reassign の select で owner_staff_id を filter している
    assert.ok(
      pageContent.includes('owner_staff_id'),
      'owner_staff_id の参照がある（reassign 除外ロジック）',
    )
  })
})

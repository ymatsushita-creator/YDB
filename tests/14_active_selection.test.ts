import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import {
  baseFixture, makeSeason, makePerson, makeApplication, makeEvaluation,
  makeVoidReason, voidApplication, deletePerson, addHistory, jst,
} from './support/fixtures.ts'
import {
  getPendingEvaluations, getHeldEvaluations, getUnassignedSummary, getConflicts,
} from '../src/queries/dashboard.ts'
import { getApplication, getPersonApplications } from '../src/queries/drilldown.ts'

/**
 * 「いま選考しているか」の範囲。
 *
 * CLAUDE.md の問い③（いま何が起きているか）と④（次に何をすべきか）は、
 * どちらも「この応募はまだ動いているか」に依存している。
 * ところが記録層でそれを表しているのは voided_at と status_histories の
 * 2つに分かれており、集計の「数えるか」（v_countable_applications）とは
 * 別の軸である。
 *
 *   数えるか   … 応募が起きた事実として木に数えるか（counts_as_application）
 *   動いているか … いま誰かが判断すべき状態にあるか
 *
 * 選考開始前に取り下げられた応募は「数えるが、動いていない」。
 * この2つを同じ述語で扱うと、催促しない相手を催促することになる。
 */

// -------------------------------------------------------------
// 応募の結末
// -------------------------------------------------------------

describe('応募の結末', () => {
  test('無効化された応募は「選考中」ではない', async () => {
    // 「選考開始前の取り下げ」は counts_as_application = true なので、
    // v_countable_applications には残る。しかし accept も reject も
    // withdraw の遷移も無いため、結末を「合格でも不合格でも辞退でもない
    // = 選考中」と導くと、9か月前に終わった応募が選考中として出る。
    const db = await freshDb()
    const base = await baseFixture(db)
    const s = await makeSeason(db, { year: 2026 })
    const person = await makePerson(db, base.schoolId)
    const app = await makeApplication(db, person, s.id, jst('2025-11-05T20:00:00'))
    const withdrawnBefore = await makeVoidReason(db, 'withdrawn_before_screening', true)
    await voidApplication(db, app, withdrawnBefore, jst('2025-11-12T10:00:00'))

    const detail = await getApplication(db, app)
    assert.ok(detail, '無効化されていても個別の画面からは消さない（C-12）')
    assert.equal(detail.is_countable, true, '木には数える')
    assert.equal(detail.outcome, 'voided',
      '無効化された応募の結末は「無効化」。選考中に落ちてはいけない')
    assert.equal(detail.is_in_selection, false, 'いま誰かが判断すべき状態ではない')

    const rows = await getPersonApplications(db, person)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]!.outcome, 'voided',
      '個人の画面と応募の画面で、同じ応募の結末が食い違ってはいけない')
    await db.close()
  })

  test('結末は、応募の画面と個人の画面で必ず一致する', async () => {
    // 同じラダーを画面2枚に書くと、片方だけ直したときに食い違う。
    // 定義は問い合わせ側の1か所にあり、画面は出すだけ、を固定する。
    const db = await freshDb()
    const base = await baseFixture(db)
    const s = await makeSeason(db, { year: 2026 })
    const person = await makePerson(db, base.schoolId)

    const accepted = await makeApplication(db, person, s.id, jst('2025-11-01T10:00:00'))
    await addHistory(db, {
      applicationId: accepted, type: 'advance', stepId: s.finalStepId,
      staffId: base.staffId, occurredAt: jst('2025-12-20T10:00:00'),
    })
    // 同一年度の二重応募は一意制約で防がれている。1件目を無効化して2件目を作る。
    const mismerge = await makeVoidReason(db, 'mismerge', false)
    await voidApplication(db, accepted, mismerge, jst('2025-12-25T10:00:00'))
    const rejected = await makeApplication(db, person, s.id, jst('2025-11-02T10:00:00'))
    await addHistory(db, {
      applicationId: rejected, type: 'reject',
      staffId: base.staffId, occurredAt: jst('2025-12-01T10:00:00'),
    })

    const list = await getPersonApplications(db, person)
    assert.equal(list.length, 2)
    // 「どちらも undefined」で通ってしまわないよう、値そのものを固定する。
    assert.deepEqual(new Set(list.map((r) => r.outcome)), new Set(['accepted', 'rejected']))
    for (const row of list) {
      const detail = await getApplication(db, row.application_id)
      assert.equal(row.outcome, detail!.outcome,
        `${row.application_id} の結末が画面で食い違っている`)
    }
    await db.close()
  })

  test('無効化は、合格や不合格より後には来ない', async () => {
    // 判定の順序そのものを固定する。合格した応募が後から事務処理の都合で
    // 無効化されたとき、結末を「無効化」にしてしまうと合格の事実が消える。
    // 起きた事実（合格）が先で、無効化は「その後どう扱うか」の話である。
    const db = await freshDb()
    const base = await baseFixture(db)
    const s = await makeSeason(db, { year: 2026 })
    const person = await makePerson(db, base.schoolId)
    const app = await makeApplication(db, person, s.id, jst('2025-11-01T10:00:00'))
    await addHistory(db, {
      applicationId: app, type: 'advance', stepId: s.finalStepId,
      staffId: base.staffId, occurredAt: jst('2025-12-20T10:00:00'),
    })
    const mismerge = await makeVoidReason(db, 'mismerge', false)
    await voidApplication(db, app, mismerge, jst('2025-12-25T10:00:00'))

    const detail = await getApplication(db, app)
    assert.equal(detail!.outcome, 'accepted', '合格した事実は無効化に上書きされない')
    assert.equal(detail!.is_in_selection, false, '結末が付いた応募は動いていない')
    await db.close()
  })
})

// -------------------------------------------------------------
// 判断待ち・保留・担当未割当
// -------------------------------------------------------------

describe('判断待ちに出てはいけないもの', () => {
  test('無効化された応募の評価は、判断待ちに出ない', async () => {
    const db = await freshDb()
    const base = await baseFixture(db)
    const s = await makeSeason(db, { year: 2027 })
    const person = await makePerson(db, base.schoolId)
    const app = await makeApplication(db, person, s.id, jst('2026-11-05T20:00:00'))
    await makeEvaluation(db, {
      applicationId: app, stepId: s.stepIds[0]!, staffId: base.staffId,
      assignedAt: jst('2026-11-06T10:00:00'),
    })
    assert.equal((await getPendingEvaluations(db, s.id)).length, 1,
      '無効化する前は判断待ちに出る')

    const withdrawnBefore = await makeVoidReason(db, 'withdrawn_before_screening', true)
    await voidApplication(db, app, withdrawnBefore, jst('2026-11-12T10:00:00'))
    assert.deepEqual(await getPendingEvaluations(db, s.id), [],
      '取り下げられた応募の判断を面接官に催促してはいけない')
    await db.close()
  })

  test('無効化された応募の評価は、保留の一覧にも出ない', async () => {
    const db = await freshDb()
    const base = await baseFixture(db)
    const s = await makeSeason(db, { year: 2027 })
    const person = await makePerson(db, base.schoolId)
    const app = await makeApplication(db, person, s.id, jst('2026-11-05T20:00:00'))
    await makeEvaluation(db, {
      applicationId: app, stepId: s.stepIds[0]!, staffId: base.staffId,
      state: 'held', holdReason: '本人と連絡が取れない',
      assignedAt: jst('2026-11-06T10:00:00'),
    })
    const withdrawnBefore = await makeVoidReason(db, 'withdrawn_before_screening', true)
    await voidApplication(db, app, withdrawnBefore, jst('2026-11-12T10:00:00'))
    assert.deepEqual(await getHeldEvaluations(db, s.id), [],
      '無効化された応募は保留の解消先にならない')
    await db.close()
  })

  test('担当未割当は、無効化された応募を数えない', async () => {
    const db = await freshDb()
    const base = await baseFixture(db)
    const s = await makeSeason(db, { year: 2027 })
    const person = await makePerson(db, base.schoolId)
    const app = await makeApplication(db, person, s.id, jst('2026-11-05T20:00:00'))
    await makeEvaluation(db, {
      applicationId: app, stepId: s.stepIds[0]!, assignedAt: jst('2026-11-06T10:00:00'),
    })
    assert.equal((await getUnassignedSummary(db, s.id))!.count, 1)

    const withdrawnBefore = await makeVoidReason(db, 'withdrawn_before_screening', true)
    await voidApplication(db, app, withdrawnBefore, jst('2026-11-12T10:00:00'))
    assert.equal((await getUnassignedSummary(db, s.id))!.count, 0,
      '割り当てる必要のない評価を「未割当」として催促してはいけない')
    await db.close()
  })

  test('担当未割当は、個人情報削除済みの人の評価を数えない', async () => {
    // getUnassignedSummary は applications にも persons にも結合していない。
    // 判断待ちの一覧（v_countable_applications 経由）とは母集団が違う。
    // 同じ画面の隣り合う2つの数字が、別の母集団から出ている状態だった。
    const db = await freshDb()
    const base = await baseFixture(db)
    const s = await makeSeason(db, { year: 2027 })
    const person = await makePerson(db, base.schoolId)
    const app = await makeApplication(db, person, s.id, jst('2026-11-05T20:00:00'))
    await makeEvaluation(db, {
      applicationId: app, stepId: s.stepIds[0]!, assignedAt: jst('2026-11-06T10:00:00'),
    })
    await deletePerson(db, person, jst('2026-11-20T10:00:00'))

    assert.equal((await getUnassignedSummary(db, s.id))!.count, 0,
      '個人情報削除を受けた人は、集計からもこの数からも外れる')
    assert.deepEqual(await getPendingEvaluations(db, s.id), [],
      '判断待ちの一覧と、担当未割当の数は同じ母集団から出る')
    await db.close()
  })
})

// -------------------------------------------------------------
// 利益相反
// -------------------------------------------------------------

describe('利益相反', () => {
  test('個人情報削除を受けた人の氏名は、利益相反の一覧に出ない', async () => {
    // 削除は集計から外すだけでは足りない（C-12）。氏名の見える窓を残さない。
    const db = await freshDb()
    const base = await baseFixture(db)
    const s = await makeSeason(db, { year: 2027 })

    const alumni = await makePerson(db, base.schoolId, { familyName: '卒業', givenName: '生' })
    const interviewer = await scalarStaff(db, alumni)
    const applicant = await makePerson(db, base.schoolId, {
      familyName: '応募', givenName: '者', referrerPersonId: alumni,
    })
    const app = await makeApplication(db, applicant, s.id, jst('2026-11-05T20:00:00'))
    await makeEvaluation(db, {
      applicationId: app, stepId: s.stepIds[0]!, staffId: interviewer,
      assignedAt: jst('2026-11-06T10:00:00'),
    })
    assert.equal((await getConflicts(db, s.id)).length, 1, '削除前は検出される')

    await deletePerson(db, applicant, jst('2026-11-20T10:00:00'))
    assert.deepEqual(await getConflicts(db, s.id), [],
      '削除済みの応募者の氏名を、運用の画面に出してはいけない')
    await db.close()
  })

  test('無効化された応募の利益相反は出ない', async () => {
    const db = await freshDb()
    const base = await baseFixture(db)
    const s = await makeSeason(db, { year: 2027 })
    const alumni = await makePerson(db, base.schoolId, { familyName: '卒業', givenName: '生' })
    const interviewer = await scalarStaff(db, alumni)
    const applicant = await makePerson(db, base.schoolId, {
      familyName: '応募', givenName: '者', referrerPersonId: alumni,
    })
    const app = await makeApplication(db, applicant, s.id, jst('2026-11-05T20:00:00'))
    await makeEvaluation(db, {
      applicationId: app, stepId: s.stepIds[0]!, staffId: interviewer,
      assignedAt: jst('2026-11-06T10:00:00'),
    })
    const mismerge = await makeVoidReason(db, 'mismerge', false)
    await voidApplication(db, app, mismerge, jst('2026-11-12T10:00:00'))

    assert.deepEqual(await getConflicts(db, s.id), [],
      '担当を替える必要のない応募を、利益相反として上げ続けない')
    await db.close()
  })
})

/** 卒業生スタッフを1人作る。面接官として選考に関わりうる（資料3-4）。 */
async function scalarStaff(db: Parameters<typeof getConflicts>[0], personId: string) {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO staffs (display_name, email, person_id)
     VALUES ('卒業 生', 'alumni@example.test', $1) RETURNING id`, [personId])
  return rows[0]!.id
}

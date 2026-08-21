import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { all, scalar, type Db } from '../src/db/client.ts'
import {
  listCandidatesByStep, listStepTabs, getScoringSheet, listDerivedTasks,
  listPersonEvaluationIds,
} from '../src/queries/borderline.ts'
import { getApplication } from '../src/queries/drilldown.ts'
import { assignInterviewer } from '../src/commands/assign.ts'
import { saveScore } from '../src/commands/score.ts'
import { submitEvaluation } from '../src/commands/decide.ts'
import { holdEvaluation } from '../src/commands/hold.ts'

/**
 * ボーダーラインの選考タブで採点する（実行⑩。依頼者の指示）。
 *
 * これまで点を入れられたのは `/applications/[id]` だけで、そこへは
 * 「やること」からしか辿り着けなかった。**選考タブは成績を出しているのに、
 * その場で入れられなかった。**
 *
 * ここで固定したいのは1つ ―― **一覧の行と、採点する相手が同じであること。**
 * 一覧は「そのステップの、確定していない評価」を応募ごとに1件へ畳んでいる
 * （面接官が2人だと評価が2件ある）。採点シートが別の評価を指すと、
 * 画面の「n 軸」と手元で付けた点が食い違う。
 * だから**シートは行が持つ evaluation_id で引く**（母集団の一致。CLAUDE.md）。
 */

describe('選考タブで採点する', () => {
  let db: Db
  let seasonId: string
  let finalStepId: string
  let schoolId: string
  let staffA: string
  let staffB: string

  before(async () => {
    db = await freshDb({ seeds: 'production' })
    // 2期を使う。最終面接に軸が6本ある唯一のステップである。
    seasonId = await scalar<string>(db, `SELECT id FROM seasons WHERE cohort_number = 2`)
    finalStepId = await scalar<string>(db, `
      SELECT id FROM selection_steps WHERE season_id = $1 AND name = '最終面接'`, [seasonId])
    schoolId = await scalar<string>(db,
      `INSERT INTO schools (name) VALUES ('架空高校') RETURNING id`)
    const staffs = await all<{ id: string }>(db, `
      INSERT INTO staffs (display_name, email)
      VALUES ('架空 甲','bl.a@example.test'),('架空 乙','bl.b@example.test')
      RETURNING id`)
    staffA = staffs[0]!.id
    staffB = staffs[1]!.id
  })

  after(async () => { await db.close() })

  /** 最終面接の評価が1件ぶら下がった応募を作る。担当は付けない。 */
  const makeCandidate = async (name: string) => {
    const personId = await scalar<string>(db, `
      INSERT INTO persons (family_name, given_name, birth_date, school_id, email)
      VALUES ('採点', $1, '2008-04-01', $2, $3) RETURNING id`,
    [name, schoolId, `score.${name}@example.test`])
    const applicationId = await scalar<string>(db, `
      INSERT INTO applications (person_id, season_id, submitted_at)
      VALUES ($1, $2, now()) RETURNING id`, [personId, seasonId])
    const evaluationId = await scalar<string>(db, `
      INSERT INTO evaluations (application_id, selection_step_id, state, assigned_at)
      VALUES ($1, $2, 'pending', now()) RETURNING id`, [applicationId, finalStepId])
    return { personId, applicationId, evaluationId }
  }

  const rowFor = async (applicationId: string) => {
    const rows = await listCandidatesByStep(db, seasonId, finalStepId)
    return rows.find((r) => r.application_id === applicationId) ?? null
  }

  test('一覧の行は、採点する評価を名指しする', async () => {
    const c = await makeCandidate('あ')
    const row = await rowFor(c.applicationId)
    assert.ok(row, '作った応募が選考タブの一覧に出る')
    assert.equal(row.evaluation_id, c.evaluationId)

    const sheet = await getScoringSheet(db, row.evaluation_id)
    assert.ok(sheet)
    assert.equal(sheet.evaluation_id, c.evaluationId)
    assert.equal(sheet.step_name, '最終面接')
    assert.equal(sheet.criteria.length, 6, '最終面接の6軸が並ぶ')
    assert.deepEqual(sheet.criteria.map((x) => x.score), Array(6).fill(null))
  })

  test('★ 面接官が2人でも、一覧の行とシートは同じ評価を指す', async () => {
    const c = await makeCandidate('い')
    // 同じステップにもう1件。一覧は待ちの長いほう（先に割り当てたほう）を代表にする。
    // 担当を分けないと `evaluations_assignment_key` に当たる ―― 同じ応募・
    // 同じステップ・同じ担当・同じ回の評価は1件しか作れない。
    const second = await scalar<string>(db, `
      INSERT INTO evaluations
        (application_id, selection_step_id, interviewer_staff_id, state, assigned_at)
      VALUES ($1, $2, $3, 'pending', now() + interval '1 hour') RETURNING id`,
    [c.applicationId, finalStepId, staffB])

    const row = await rowFor(c.applicationId)
    assert.ok(row)
    assert.equal(row.evaluation_id, c.evaluationId, '代表は先に割り当てたほう')
    assert.notEqual(row.evaluation_id, second)

    const sheet = await getScoringSheet(db, row.evaluation_id)
    assert.equal(sheet?.evaluation_id, c.evaluationId)
  })

  test('担当が決まるまでは点を付けられず、次にやることを名指しする', async () => {
    const c = await makeCandidate('う')
    const before = await getScoringSheet(db, c.evaluationId)
    assert.equal(before?.can_score, false)
    assert.equal(before?.blocked_by, '先に担当を決める')
    assert.equal(before?.can_submit, false)

    const assigned = await assignInterviewer(db,
      { evaluationId: c.evaluationId, staffId: staffA })
    assert.equal(assigned.ok, true)

    const after = await getScoringSheet(db, c.evaluationId)
    assert.equal(after?.can_score, true)
    assert.equal(after?.blocked_by, null)
    assert.equal(after?.interviewer, '架空 甲')
  })

  test('保留の間は点を付けられない', async () => {
    const c = await makeCandidate('え')
    await assignInterviewer(db, { evaluationId: c.evaluationId, staffId: staffB })
    const held = await holdEvaluation(db,
      { evaluationId: c.evaluationId, reason: '本人と連絡が取れない' })
    assert.equal(held.ok, true)

    const sheet = await getScoringSheet(db, c.evaluationId)
    assert.equal(sheet?.can_score, false)
    assert.equal(sheet?.blocked_by, '先に保留を解く')
  })

  test('点を入れると、その軸は根拠ごとシートに残る', async () => {
    const c = await makeCandidate('お')
    await assignInterviewer(db, { evaluationId: c.evaluationId, staffId: staffA })
    const sheet = await getScoringSheet(db, c.evaluationId)
    const first = sheet!.criteria[0]!

    const saved = await saveScore(db, {
      evaluationId: c.evaluationId, criteriaId: first.criteria_id,
      score: 3, rationale: '具体例を自分の言葉で話した',
    })
    assert.equal(saved.ok, true)

    const after = await getScoringSheet(db, c.evaluationId)
    const scored = after!.criteria.find((x) => x.criteria_id === first.criteria_id)!
    assert.equal(scored.score, 3)
    assert.equal(scored.rationale, '具体例を自分の言葉で話した')
    assert.equal(after!.unscored_count, 5)
    assert.equal(after!.can_submit, false, '残っている軸があるうちは確定できない')
  })

  test('★ 全軸そろって初めて確定でき、確定すると一覧から外れる', async () => {
    const c = await makeCandidate('か')
    await assignInterviewer(db, { evaluationId: c.evaluationId, staffId: staffA })

    // 段数も軸の数も決め打ちしない。シートが出した軸をそのまま回す。
    let sheet = (await getScoringSheet(db, c.evaluationId))!
    for (const criterion of sheet.criteria) {
      const saved = await saveScore(db, {
        evaluationId: c.evaluationId, criteriaId: criterion.criteria_id,
        score: 2, rationale: `${criterion.criteria_name}の根拠`,
      })
      assert.equal(saved.ok, true)
    }

    sheet = (await getScoringSheet(db, c.evaluationId))!
    assert.equal(sheet.unscored_count, 0)
    assert.equal(sheet.can_submit, true)

    const submitted = await submitEvaluation(db, { evaluationId: c.evaluationId })
    assert.equal(submitted.ok, true)

    assert.equal(await rowFor(c.applicationId), null,
      '確定した評価は「判断待ち」ではないので、選考タブの一覧から外れる')
  })

  test('確定した評価は、シートの上でも締まっている', async () => {
    const c = await makeCandidate('き')
    await assignInterviewer(db, { evaluationId: c.evaluationId, staffId: staffA })
    const sheet = (await getScoringSheet(db, c.evaluationId))!
    for (const criterion of sheet.criteria) {
      await saveScore(db, {
        evaluationId: c.evaluationId, criteriaId: criterion.criteria_id,
        score: 4, rationale: '満点の根拠',
      })
    }
    await submitEvaluation(db, { evaluationId: c.evaluationId })

    const after = (await getScoringSheet(db, c.evaluationId))!
    assert.equal(after.state, 'submitted')
    assert.equal(after.can_score, false)
    assert.equal(after.can_submit, false)
    // 点は消えない。締まったのは入口だけである。
    assert.equal(after.criteria.every((x) => x.score === 4), true)
  })

  test('軸が1本も登録されていないステップでは、確定させない', async () => {
    // 2期の「応募受付」には評価軸が無い（旧システムに点が無いため入れていない）。
    const stepId = await scalar<string>(db, `
      SELECT id FROM selection_steps WHERE season_id = $1 AND name = '応募受付'`, [seasonId])
    const personId = await scalar<string>(db, `
      INSERT INTO persons (family_name, given_name, birth_date, school_id, email)
      VALUES ('採点', '軸なし', '2008-04-01', $1, 'score.none@example.test') RETURNING id`,
    [schoolId])
    const applicationId = await scalar<string>(db, `
      INSERT INTO applications (person_id, season_id, submitted_at)
      VALUES ($1, $2, now()) RETURNING id`, [personId, seasonId])
    const evaluationId = await scalar<string>(db, `
      INSERT INTO evaluations (application_id, selection_step_id, state, assigned_at)
      VALUES ($1, $2, 'pending', now()) RETURNING id`, [applicationId, stepId])
    await assignInterviewer(db, { evaluationId, staffId: staffA })

    const sheet = (await getScoringSheet(db, evaluationId))!
    assert.equal(sheet.criteria.length, 0)
    assert.equal(sheet.can_score, true, 'やることとしては「評価する」のままである')
    // ★ 軸が0本のとき「全軸そろった」と読むと、点が1つも無い評価を確定できてしまう。
    //   0 件そろったことを「そろった」と数えない。
    assert.equal(sheet.can_submit, false)
    assert.equal(sheet.no_criteria, true)
  })

  test('★ やることは、開ける応募を名指しする（source_id は評価のID）', async () => {
    const c = await makeCandidate('く')
    await assignInterviewer(db, { evaluationId: c.evaluationId, staffId: staffA })

    const tasks = await listDerivedTasks(db, seasonId)
    const task = tasks.find((t) => t.source_id === c.evaluationId)
    assert.ok(task, '担当が決まった評価は「評価する」やることになる')
    assert.equal(task.kind, 'evaluate')

    // ★ ここが 404 の正体。`source_id` は評価のIDで、応募のIDではない。
    //   画面はこれを `/applications/{id}` に入れており、押すと 404 になっていた。
    //   **画面から点を入れられる唯一の経路が壊れていた**（C-60）。
    assert.notEqual(task.application_id, task.source_id)
    assert.equal(task.application_id, c.applicationId)

    // 名指しした応募が実在することを、応募の画面と同じ問い合わせで確かめる。
    const app = await getApplication(db, task.application_id)
    assert.ok(app, 'やることのリンク先は開ける応募である')
  })

  test('選考タブの見出しに出る母集団と、採点できる相手はずれない', async () => {
    const tabs = await listStepTabs(db, seasonId)
    const finalTab = tabs.find((t) => t.step_name === '最終面接')!
    const rows = await listCandidatesByStep(db, seasonId, finalStepId)
    assert.equal(finalTab.open_applications, rows.length)

    // 行が名指しした評価は、すべて実在して確定していない。
    for (const r of rows) {
      const sheet = await getScoringSheet(db, r.evaluation_id)
      assert.ok(sheet, `${r.evaluation_id} のシートが引ける`)
      assert.notEqual(sheet.state, 'submitted')
    }
  })
})

/**
 * 採点レイヤー（実行⑩。依頼者の指示 ――「個人名押したら採点できるレイヤー」）。
 *
 * 一覧のタブは「いまその段に居る応募」しか出さない。
 * レイヤーは**候補者1人の採点用紙**なので、段で絞らない。
 */
describe('個人の採点レイヤー', () => {
  let db: Db
  let seasonId: string
  let steps: Array<{ id: string; sort_order: number }>
  let schoolId: string
  let staffId: string

  before(async () => {
    db = await freshDb({ seeds: 'production' })
    seasonId = await scalar<string>(db, `SELECT id FROM seasons WHERE cohort_number = 2`)
    steps = await all<{ id: string; sort_order: number }>(db, `
      SELECT id, sort_order FROM selection_steps
       WHERE season_id = $1 AND name <> '特別選考' ORDER BY sort_order`, [seasonId])
    schoolId = await scalar<string>(db,
      `INSERT INTO schools (name) VALUES ('架空第二高校') RETURNING id`)
    staffId = await scalar<string>(db, `
      INSERT INTO staffs (display_name, email)
      VALUES ('架空 丙','layer@example.test') RETURNING id`)
  })

  after(async () => { await db.close() })

  test('★ 段で絞らない。確定済みも落とさない', async () => {
    const personId = await scalar<string>(db, `
      INSERT INTO persons (family_name, given_name, birth_date, school_id, email)
      VALUES ('採点', '層', '2008-04-01', $1, 'layer.p@example.test') RETURNING id`, [schoolId])
    const applicationId = await scalar<string>(db, `
      INSERT INTO applications (person_id, season_id, submitted_at)
      VALUES ($1, $2, now()) RETURNING id`, [personId, seasonId])

    // 2本目は確定済み、3本目は判断待ち。段数は決め打ちしない。
    const done = await scalar<string>(db, `
      INSERT INTO evaluations (application_id, selection_step_id, interviewer_staff_id,
                               state, assigned_at, submitted_at)
      VALUES ($1, $2, $3, 'submitted', now(), now()) RETURNING id`,
    [applicationId, steps[1]!.id, staffId])
    const open = await scalar<string>(db, `
      INSERT INTO evaluations (application_id, selection_step_id, state, assigned_at)
      VALUES ($1, $2, 'pending', now()) RETURNING id`, [applicationId, steps[2]!.id])

    const ids = (await listPersonEvaluationIds(db, personId, seasonId))
      .map((r) => r.evaluation_id)
    assert.deepEqual(ids, [done, open], '段の順に、確定済みも含めて並ぶ')

    // 確定済みのシートも引ける（前の段の点を見ずに次の段は付けられない）。
    const sheet = await getScoringSheet(db, done)
    assert.equal(sheet?.state, 'submitted')
    assert.equal(sheet?.can_score, false)
  })

  test('別の期の評価は混ざらない', async () => {
    const otherSeason = await scalar<string>(db,
      `SELECT id FROM seasons WHERE cohort_number = 3`)
    const otherStep = await scalar<string>(db, `
      SELECT id FROM selection_steps WHERE season_id = $1 AND name <> '特別選考' ORDER BY sort_order LIMIT 1`,
    [otherSeason])
    const personId = await scalar<string>(db, `
      INSERT INTO persons (family_name, given_name, birth_date, school_id, email)
      VALUES ('採点', '両期', '2008-04-02', $1, 'layer.q@example.test') RETURNING id`, [schoolId])
    for (const [season, step] of [[seasonId, steps[0]!.id], [otherSeason, otherStep]] as const) {
      const appId = await scalar<string>(db, `
        INSERT INTO applications (person_id, season_id, submitted_at)
        VALUES ($1, $2, now()) RETURNING id`, [personId, season])
      await db.query(`
        INSERT INTO evaluations (application_id, selection_step_id, state, assigned_at)
        VALUES ($1, $2, 'pending', now())`, [appId, step])
    }

    assert.equal((await listPersonEvaluationIds(db, personId, seasonId)).length, 1)
    assert.equal((await listPersonEvaluationIds(db, personId, otherSeason)).length, 1)
  })

  test('削除済みの人の評価は出ない', async () => {
    const personId = await scalar<string>(db, `
      INSERT INTO persons (family_name, given_name, birth_date, school_id, email)
      VALUES ('採点', '削除', '2008-04-03', $1, 'layer.r@example.test') RETURNING id`, [schoolId])
    const appId = await scalar<string>(db, `
      INSERT INTO applications (person_id, season_id, submitted_at)
      VALUES ($1, $2, now()) RETURNING id`, [personId, seasonId])
    const evalId = await scalar<string>(db, `
      INSERT INTO evaluations (application_id, selection_step_id, state, assigned_at)
      VALUES ($1, $2, 'pending', now()) RETURNING id`, [appId, steps[0]!.id])

    assert.equal((await listPersonEvaluationIds(db, personId, seasonId)).length, 1)
    await db.query(`UPDATE persons SET deleted_at = now() WHERE id = $1`, [personId])
    assert.equal((await listPersonEvaluationIds(db, personId, seasonId)).length, 0)
    assert.equal(await getScoringSheet(db, evalId), null,
      '氏名の見える窓を残さない')
  })
})

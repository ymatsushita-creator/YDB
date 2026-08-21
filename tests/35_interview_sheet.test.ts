import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { all, scalar, maybeOne, type Db } from '../src/db/client.ts'
import {
  saveInterviewSheet, RECOMMENDATIONS, INTERVIEW_FIELDS,
} from '../src/commands/interview.ts'
import {
  getInterviewSheet, listInterviewRevisions, listPersonInterviews,
} from '../src/queries/interview.ts'
import { listPersonFormResponses } from '../src/queries/intake.ts'
import { saveScore } from '../src/commands/score.ts'
import { reassignInterviewer } from '../src/commands/assign.ts'

/**
 * 面接シート（実行⑩。依頼者から様式を受領）。
 *
 * ここで固定したいのは4つ ――
 *   ① 現在値と変更ログが**必ず一緒に**書かれること
 *   ② 変更ログが**追記専用**であること（上書きも削除もできない）
 *   ③ 最終判定（合格・ボーダー・不合格）が**選考の判定と混ざらない**こと
 *   ④ 点は面接シートではなく `evaluation_scores` に入ること
 */

const EMPTY = {
  interviewedOn: '', firstImpression: '', checkPointNotes: '',
  strengths: '', concerns: '', ownChallenge: '',
  neoCareerLink: '', neoUsagePlan: '', overallComment: '',
  recommendation: '', recommendationNote: '',
}

describe('面接シート', () => {
  let db: Db
  let seasonId: string
  let finalStepId: string
  let schoolId: string
  let staffA: string
  let staffB: string

  before(async () => {
    db = await freshDb({ seeds: 'production' })
    seasonId = await scalar<string>(db, `SELECT id FROM seasons WHERE cohort_number = 2`)
    finalStepId = await scalar<string>(db, `
      SELECT id FROM selection_steps WHERE season_id = $1 AND name = '最終面接'`, [seasonId])
    schoolId = await scalar<string>(db,
      `INSERT INTO schools (name) VALUES ('架空面接高校') RETURNING id`)
    const s = await all<{ id: string }>(db, `
      INSERT INTO staffs (display_name, email)
      VALUES ('架空 面接官','iv.a@example.test'),('架空 面接官2','iv.b@example.test')
      RETURNING id`)
    staffA = s[0]!.id
    staffB = s[1]!.id
  })

  after(async () => { await db.close() })

  let seq = 0
  const makeEvaluation = async () => {
    seq += 1
    const personId = await scalar<string>(db, `
      INSERT INTO persons (family_name, given_name, birth_date, school_id, email)
      VALUES ('面接', $1, '2008-04-01', $2, $3) RETURNING id`,
    [`対象${seq}`, schoolId, `iv.p${seq}@example.test`])
    const applicationId = await scalar<string>(db, `
      INSERT INTO applications (person_id, season_id, submitted_at)
      VALUES ($1, $2, now()) RETURNING id`, [personId, seasonId])
    const evaluationId = await scalar<string>(db, `
      INSERT INTO evaluations (application_id, selection_step_id, interviewer_staff_id,
                               state, assigned_at)
      VALUES ($1, $2, $3, 'pending', now()) RETURNING id`,
    [applicationId, finalStepId, staffA])
    return { personId, applicationId, evaluationId }
  }

  test('依頼者の様式どおりに保存でき、そのまま読み戻せる', async () => {
    const c = await makeEvaluation()
    const saved = await saveInterviewSheet(db, {
      evaluationId: c.evaluationId, staffId: staffA,
      interviewedOn: '2026-04-08',
      firstImpression: '落ち着いて話す',
      checkPointNotes: '確認ポイントには一つずつ答えた',
      strengths: '自分の言葉で言い直していた',
      concerns: '数字の根拠が薄い',
      ownChallenge: '巻き込みが弱いと自己申告',
      neoCareerLink: '教育の現場と接続できる',
      neoUsagePlan: '起業部の運営に関わる',
      overallComment: '伸びしろがある',
      recommendation: 'border',
      recommendationNote: '2次の点が伸びれば合格',
    })
    assert.equal(saved.ok, true)
    assert.equal(saved.ok && saved.revisionNumber, 1)

    const sheet = (await getInterviewSheet(db, c.evaluationId))!
    assert.equal(sheet.first_impression, '落ち着いて話す')
    assert.equal(sheet.own_challenge, '巻き込みが弱いと自己申告')
    assert.equal(sheet.neo_career_link, '教育の現場と接続できる')
    assert.equal(sheet.recommendation, 'border')
    assert.equal(sheet.recommendation_note, '2次の点が伸びれば合格')
    assert.equal(sheet.revision_count, 1)
  })

  test('★ 現在値と変更ログは、必ず一緒に書かれる', async () => {
    const c = await makeEvaluation()
    await saveInterviewSheet(db,
      { ...EMPTY, evaluationId: c.evaluationId, staffId: staffA, overallComment: '一度目' })
    await saveInterviewSheet(db,
      { ...EMPTY, evaluationId: c.evaluationId, staffId: staffB, overallComment: '二度目' })

    const sheet = (await getInterviewSheet(db, c.evaluationId))!
    assert.equal(sheet.overall_comment, '二度目', '現在値は最後に書いたもの')

    const log = await listInterviewRevisions(db, c.evaluationId)
    assert.equal(log.length, 2)
    assert.deepEqual(log.map((r) => r.revision_number), [2, 1], '新しい順')
    assert.equal(log[0]!.overall_comment, '二度目')
    assert.equal(log[1]!.overall_comment, '一度目', '★ 上書きされた前の版が残る')
    assert.equal(log[0]!.changed_by, '架空 面接官2', '誰が書いたかが残る')
  })

  test('★ 記入欄は、送った名前で入れて、列の名前で読み戻せる', async () => {
    // ★ 送りは camelCase、記録層は snake_case。**綴りが違う。**
    //   片方から導けると思って書いたら、保存はできるのに
    //   開き直すと全部空になった。様式の対応をここで固定する。
    const c = await makeEvaluation()
    const input: Record<string, string> = { ...EMPTY }
    for (const f of INTERVIEW_FIELDS) input[f.name] = `${f.label}の中身`

    const saved = await saveInterviewSheet(db, {
      ...(input as unknown as typeof EMPTY),
      evaluationId: c.evaluationId, staffId: staffA,
    })
    assert.equal(saved.ok, true)

    const sheet = (await getInterviewSheet(db, c.evaluationId))!
    for (const f of INTERVIEW_FIELDS) {
      assert.equal(
        (sheet as unknown as Record<string, string | null>)[f.column],
        `${f.label}の中身`,
        `${f.label}（${f.name} → ${f.column}）が往復する`,
      )
    }
    assert.equal(INTERVIEW_FIELDS.length, 8, '依頼者の様式の記入欄は8つ（面接日と面接官を除く）')
  })

  test('★ 変更ログは追記専用（上書きも削除もできない）', async () => {
    const c = await makeEvaluation()
    await saveInterviewSheet(db,
      { ...EMPTY, evaluationId: c.evaluationId, staffId: staffA, overallComment: '元' })

    await assert.rejects(
      () => db.query(`UPDATE interview_sheet_revisions SET overall_comment = '改' `
        + `WHERE evaluation_id = $1`, [c.evaluationId]),
      /append|追記|immutable|変更/i,
    )
    await assert.rejects(
      () => db.query(`DELETE FROM interview_sheet_revisions WHERE evaluation_id = $1`,
        [c.evaluationId]),
      /append|追記|immutable|変更/i,
    )

    const log = await listInterviewRevisions(db, c.evaluationId)
    assert.equal(log[0]!.overall_comment, '元')
  })

  test('最終判定は3つだけ。知らない値は入らない', async () => {
    const c = await makeEvaluation()
    assert.deepEqual([...RECOMMENDATIONS], ['pass', 'border', 'fail'])

    for (const r of RECOMMENDATIONS) {
      const ok = await saveInterviewSheet(db,
        { ...EMPTY, evaluationId: c.evaluationId, staffId: staffA, recommendation: r })
      assert.equal(ok.ok, true, `${r} は入る`)
    }
    const bad = await saveInterviewSheet(db,
      { ...EMPTY, evaluationId: c.evaluationId, staffId: staffA, recommendation: '合格' })
    assert.equal(bad.ok, false)
    assert.equal(!bad.ok && bad.reason, 'bad_recommendation')
  })

  test('★ 面接官の所見は、選考の判定を1件も動かさない', async () => {
    const c = await makeEvaluation()
    const before = await scalar<number>(db,
      `SELECT count(*)::int FROM status_histories WHERE application_id = $1`,
      [c.applicationId])

    await saveInterviewSheet(db,
      { ...EMPTY, evaluationId: c.evaluationId, staffId: staffA, recommendation: 'pass' })

    const after = await scalar<number>(db,
      `SELECT count(*)::int FROM status_histories WHERE application_id = $1`,
      [c.applicationId])
    assert.equal(after, before, '★ 「合格」の所見でも、選考の遷移は増えない')

    // 「ボーダー」は選考の側に存在しない。存在しないものを写していないこと。
    const transitions = await all<{ transition_type: string }>(db,
      `SELECT DISTINCT transition_type FROM status_histories`)
    assert.equal(transitions.some((t) => t.transition_type === 'border'), false)
  })

  test('判定補足だけは残せない', async () => {
    const c = await makeEvaluation()
    const r = await saveInterviewSheet(db, {
      ...EMPTY, evaluationId: c.evaluationId, staffId: staffA,
      recommendation: '', recommendationNote: '理由だけ書いた',
    })
    assert.equal(r.ok, false)
    assert.equal(!r.ok && r.reason, 'note_without_recommendation')
  })

  test('面接日は日付の形をしていないと入らない', async () => {
    const c = await makeEvaluation()
    const r = await saveInterviewSheet(db,
      { ...EMPTY, evaluationId: c.evaluationId, staffId: staffA, interviewedOn: '4/8' })
    assert.equal(r.ok, false)
    assert.equal(!r.ok && r.reason, 'bad_date')
  })

  test('空欄は空文字ではなく「無い」として残す', async () => {
    const c = await makeEvaluation()
    await saveInterviewSheet(db,
      { ...EMPTY, evaluationId: c.evaluationId, staffId: staffA, strengths: '   ' })
    const sheet = (await getInterviewSheet(db, c.evaluationId))!
    assert.equal(sheet.strengths, null)
  })

  test('★ 点はシートに入らない。評価軸の側に入る', async () => {
    const c = await makeEvaluation()
    const sheet = (await getInterviewSheet(db, c.evaluationId))!
    assert.equal(sheet.criteria.length, 6, '最終面接の6軸')
    assert.deepEqual(sheet.criteria.map((x) => x.scale_max), Array(6).fill(4), '各4点満点')

    const first = sheet.criteria[0]!
    const saved = await saveScore(db, {
      evaluationId: c.evaluationId, criteriaId: first.criteria_id,
      score: 3, rationale: '具体例で答えた',
    })
    assert.equal(saved.ok, true)

    const after = (await getInterviewSheet(db, c.evaluationId))!
    assert.equal(after.criteria[0]!.score, 3)
    assert.equal(after.criteria[0]!.rationale, '具体例で答えた')
    // ★ シートが持つ列を丸ごと固定する。
    //   「点らしい名前が無いこと」で確かめようとすると、記入欄の
    //   `check_point_notes`（確認ポイント）に引っかかる ―― 様式の言葉と
    //   こちらの都合が衝突する。**列の一覧そのものを正典にする。**
    const columns = (await all<{ column_name: string }>(db, `
      SELECT column_name FROM information_schema.columns
       WHERE table_name = 'interview_sheets' ORDER BY column_name`))
      .map((c2) => c2.column_name)
    assert.deepEqual(columns, [
      'check_point_notes', 'concerns', 'created_at', 'evaluation_id',
      'first_impression', 'id', 'interviewed_on', 'neo_career_link',
      'neo_usage_plan', 'overall_comment', 'own_challenge',
      'recommendation', 'recommendation_note', 'strengths', 'updated_at',
    ], '点は1列も持たない。持たせたら evaluation_scores と二重になる')
  })

  test('シートがまだ無い面接も引ける（書き始める入口が要る）', async () => {
    const c = await makeEvaluation()
    const sheet = (await getInterviewSheet(db, c.evaluationId))!
    assert.equal(sheet.sheet_id, null)
    assert.equal(sheet.revision_count, 0)
    assert.equal(sheet.criteria.length, 6, '軸は先に出る')
    assert.equal(sheet.interviewer_name, '架空 面接官')
  })

  test('★ 面接官が2人なら、シートも2枚になる', async () => {
    const c = await makeEvaluation()
    const second = await scalar<string>(db, `
      INSERT INTO evaluations (application_id, selection_step_id, interviewer_staff_id,
                               state, assigned_at)
      VALUES ($1, $2, $3, 'pending', now()) RETURNING id`,
    [c.applicationId, finalStepId, staffB])

    await saveInterviewSheet(db,
      { ...EMPTY, evaluationId: c.evaluationId, staffId: staffA, overallComment: '1人目の所見' })
    await saveInterviewSheet(db,
      { ...EMPTY, evaluationId: second, staffId: staffB, overallComment: '2人目の所見' })

    assert.equal((await getInterviewSheet(db, c.evaluationId))!.overall_comment, '1人目の所見')
    assert.equal((await getInterviewSheet(db, second))!.overall_comment, '2人目の所見')

    const rows = await listPersonInterviews(db, c.personId)
    assert.equal(rows.length, 2, '詳細画面には2枚とも並ぶ')
    assert.equal(rows.every((r) => r.has_sheet), true)
  })

  test('★ 削除済みの人の面接は、引けも書けもしない', async () => {
    const c = await makeEvaluation()
    await saveInterviewSheet(db,
      { ...EMPTY, evaluationId: c.evaluationId, staffId: staffA, overallComment: '書いた' })
    assert.ok(await getInterviewSheet(db, c.evaluationId))

    await db.query(`UPDATE persons SET deleted_at = now() WHERE id = $1`, [c.personId])

    assert.equal(await getInterviewSheet(db, c.evaluationId), null, '氏名の見える窓を残さない')
    assert.equal((await listPersonInterviews(db, c.personId)).length, 0)
    const write = await saveInterviewSheet(db,
      { ...EMPTY, evaluationId: c.evaluationId, staffId: staffA, overallComment: '追記' })
    assert.equal(write.ok, false)
    assert.equal(!write.ok && write.reason, 'evaluation_not_found')

    // 記録そのものは消していない。集計と画面から外しただけである。
    const kept = await maybeOne(db,
      `SELECT 1 FROM interview_sheets WHERE evaluation_id = $1`, [c.evaluationId])
    assert.ok(kept)
  })

  test('書いた人を選ばずには保存できない', async () => {
    const c = await makeEvaluation()
    const r = await saveInterviewSheet(db,
      { ...EMPTY, evaluationId: c.evaluationId, staffId: '' })
    assert.equal(r.ok, false)
    assert.equal(!r.ok && r.reason, 'staff_not_found')
  })

  test('詳細画面の一覧は、期をまたいで並ぶ（再応募）', async () => {
    const c = await makeEvaluation()
    const other = await scalar<string>(db, `SELECT id FROM seasons WHERE cohort_number = 3`)
    const otherStep = await scalar<string>(db, `
      SELECT id FROM selection_steps WHERE season_id = $1 ORDER BY sort_order LIMIT 1`, [other])
    const appId = await scalar<string>(db, `
      INSERT INTO applications (person_id, season_id, submitted_at, is_reapplication)
      VALUES ($1, $2, now(), true) RETURNING id`, [c.personId, other])
    await db.query(`
      INSERT INTO evaluations (application_id, selection_step_id, state, assigned_at)
      VALUES ($1, $2, 'pending', now())`, [appId, otherStep])

    const rows = await listPersonInterviews(db, c.personId)
    assert.equal(rows.length, 2)
    assert.deepEqual(rows.map((r) => r.cohort_number), [3, 2], '新しい期が先')
  })

  /**
   * 提出された書類（実行⑫。依頼者の指示）。
   *
   * 「面接タブから提出された書類を閲覧可能にする」。書類の実体は
   * **応募フォームの回答**（依頼者の回答）で、記録層は 0025 のままである。
   */
  test('その人に結び付いたフォーム回答が読める。未接合の回答は出ない', async () => {
    const c = await makeEvaluation()
    const channelId = await scalar<string>(db, `SELECT id FROM channels WHERE name = 'LINE'`)

    // 結び付いた回答（2件。新しい順に並ぶこと）
    for (const [key, day] of [['r1', '2026-03-01'], ['r2', '2026-03-05']] as const) {
      await db.query(`
        INSERT INTO form_responses
          (source, form_key, response_key, submitted_at, channel_id, raw,
           person_id, matched_at, match_method)
        VALUES ('google', 'f1', $1, $2::timestamptz, $3, $4::jsonb, $5, now(), 'manual')`,
      [`${key}-${seq}`, `${day}T10:00:00+09:00`, channelId,
        JSON.stringify({ 志望動機: `理由 ${key}` }), c.personId])
    }
    // 誰にも結び付いていない回答（**出てはいけない**）
    await db.query(`
      INSERT INTO form_responses (source, form_key, response_key, submitted_at, raw)
      VALUES ('google', 'f1', $1, now(), '{"志望動機":"未接合"}'::jsonb)`,
    [`unmatched-${seq}`])

    const rows = await listPersonFormResponses(db, c.personId)
    assert.equal(rows.length, 2, '未接合の回答は混ざらない')
    assert.deepEqual(rows.map((r) => (r.raw as { 志望動機: string }).志望動機),
      ['理由 r2', '理由 r1'], '送信の新しい順')

    // 回答そのものは書き換えられない（0025 のトリガ）。画面も読み取り専用である。
    await assert.rejects(() => db.query(
      `UPDATE form_responses SET raw = '{}'::jsonb WHERE person_id = $1`, [c.personId]))
  })

  test('担当を替えても、シートは古い面接官を指したままにならない', async () => {
    const c = await makeEvaluation()
    await saveInterviewSheet(db,
      { ...EMPTY, evaluationId: c.evaluationId, staffId: staffA, overallComment: '所見' })
    assert.equal((await getInterviewSheet(db, c.evaluationId))!.interviewer_name, '架空 面接官')

    // 担当が既に居るので、替えるのは `reassignInterviewer` の役目である
    // （`assignInterviewer` は未割当のときだけ通す）。
    const moved = await reassignInterviewer(db,
      { evaluationId: c.evaluationId, staffId: staffB })
    assert.equal(moved.ok, true)

    // 面接官はシートに写していない。評価から辿るので、替えれば一緒に動く。
    assert.equal((await getInterviewSheet(db, c.evaluationId))!.interviewer_name, '架空 面接官2')
  })
})

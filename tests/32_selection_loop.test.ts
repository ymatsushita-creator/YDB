import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { all, one, scalar, type Db } from '../src/db/client.ts'
import { assignInterviewer } from '../src/commands/assign.ts'
import { saveScore } from '../src/commands/score.ts'
import { submitEvaluation, decideStep, correctDecision, getDecidableStep } from '../src/commands/decide.ts'
import { holdEvaluation } from '../src/commands/hold.ts'
import { unholdEvaluation } from '../src/commands/unhold.ts'

/**
 * 選考フローをループで回す（実行⑨。依頼者の指示）。
 *
 * 1周ぶんを手で書いたテストは既にある。ここで確かめたいのは別のことで、
 * **何周回しても不変条件が崩れないか**である。
 *
 * 分岐は周ごとに変える ―― 途中で保留にする周、判定を編集する周、
 * 不合格で終わる周。**同じ道だけ通ると、通っていない道が壊れても気づけない。**
 *
 * 3期は2期と段の数が違う（3本 / 4本）。**段数を決め打ちしない。**
 */

const CYCLES = 12

describe('選考フローを回し続ける', () => {
  let db: Db
  let seasonId: string
  let steps: Array<{ id: string; sort_order: number }>
  let staff: string[]
  let schoolId: string

  before(async () => {
    db = await freshDb({ seeds: 'production' })
    // 2期（段が4本あり、最終面接に軸が6本ある）で回す。
    seasonId = await scalar<string>(db,
      `SELECT id FROM seasons WHERE cohort_number = 2`)
    steps = await all<{ id: string; sort_order: number }>(db,
      `SELECT id, sort_order FROM selection_steps
        WHERE season_id = $1 AND name <> '特別選考' ORDER BY sort_order`, [seasonId])
    schoolId = await scalar<string>(db,
      `INSERT INTO schools (name) VALUES ('架空高校') RETURNING id`)
    staff = (await all<{ id: string }>(db, `
      INSERT INTO staffs (display_name, email)
      VALUES ('架空 A','loop.a@example.test'),('架空 B','loop.b@example.test'),
             ('架空 C','loop.c@example.test')
      RETURNING id`)).map((r) => r.id)
  })

  after(async () => { await db.close() })

  const makeApplication = async (n: number) => {
    const personId = await scalar<string>(db, `
      INSERT INTO persons (family_name, given_name, birth_date, school_id, email)
      VALUES ('周回', $1, '2008-04-01', $2, $3) RETURNING id`,
    [`${n}`, schoolId, `loop${n}@example.test`])
    return scalar<string>(db, `
      INSERT INTO applications (person_id, season_id, submitted_at)
      VALUES ($1, $2, now()) RETURNING id`, [personId, seasonId])
  }

  /**
   * その段の評価を用意し、担当を付けて、軸があれば全部埋めて確定する。
   *
   * ★ **すでにある行を使う。** 通過を判定すると、次の段の評価行は
   *   `decideStep` が自分で作る（作らないと「通過したのに次にやることが無い」
   *   状態になるため）。ここで作り直すと担当未割当の行が二重にできる。
   */
  const passStep = async (applicationId: string, stepId: string, who: number) => {
    const existing = await all<{ id: string }>(db, `
      SELECT id FROM evaluations
       WHERE application_id = $1 AND selection_step_id = $2 AND state <> 'submitted'
       ORDER BY attempt LIMIT 1`, [applicationId, stepId])
    const evaluationId = existing[0]?.id ?? await scalar<string>(db, `
      INSERT INTO evaluations (application_id, selection_step_id, assigned_at)
      VALUES ($1, $2, now()) RETURNING id`, [applicationId, stepId])

    const assigned = await assignInterviewer(db, { evaluationId, staffId: staff[who % staff.length]! })
    assert.equal(assigned.ok, true, '担当を付けられる')
    await scoreAndSubmit(evaluationId, stepId)
    return evaluationId
  }

  /** 軸があれば全部埋めてから確定する。軸が0本の段は点を付けずに確定する。 */
  const scoreAndSubmit = async (evaluationId: string, stepId: string) => {
    const criteria = await all<{ id: string; scale_max: number }>(db, `
      SELECT id, scale_max FROM evaluation_criteria
       WHERE selection_step_id = $1 AND applies_to = 'all'`, [stepId])
    for (const c of criteria) {
      const r = await saveScore(db, {
        evaluationId, criteriaId: c.id, score: c.scale_max, rationale: '周回テストの根拠',
      })
      assert.equal(r.ok, true, '点を入れられる')
    }
    const submitted = await submitEvaluation(db, { evaluationId })
    assert.equal(submitted.ok, true, '確定できる')
  }

  test(`${CYCLES} 周まわしても、不変条件が毎周成り立つ`, async () => {
    for (let n = 1; n <= CYCLES; n++) {
      const applicationId = await makeApplication(n)

      // 周ごとに道を変える。
      const holdThisRound = n % 3 === 0      // 途中で保留にして解く
      const editThisRound = n % 4 === 0      // 判定を編集して戻す
      const rejectAtEnd = n % 5 === 0        // 最後に不合格で終える

      for (const [i, step] of steps.entries()) {
        const _evaluationId = await passStep(applicationId, step.id, n + i)

        if (holdThisRound && i === 1) {
          // 確定済みは保留にできない（母集団の外）。新しい評価行で試す。
          const extra = await scalar<string>(db, `
            INSERT INTO evaluations (application_id, selection_step_id, interviewer_staff_id, attempt, assigned_at)
            VALUES ($1, $2, $3, 2, now()) RETURNING id`,
          [applicationId, step.id, staff[0]])
          const held = await holdEvaluation(db, { evaluationId: extra, reason: '周回テストの保留' })
          assert.equal(held.ok, true, '保留にできる')
          const back = await unholdEvaluation(db, { evaluationId: extra })
          assert.equal(back.ok, true, '保留を解ける')

          // ★ 解いただけでは判定に進めない。**その段の評価が全部確定して
          //   初めて判定できる**（面接官が2人なら2人とも出すまで待つ）。
          //   ここを埋めずに次へ行こうとして落ちた ―― 仕様どおりの挙動である。
          await scoreAndSubmit(extra, step.id)
        }

        const decidable = await getDecidableStep(db, applicationId)
        assert.ok(decidable, `${i + 1} 段目は判定できる状態になる`)

        const isLast = i === steps.length - 1
        const decision = isLast && rejectAtEnd ? 'reject' : 'advance'
        const d = await decideStep(db, {
          applicationId, staffId: staff[n % staff.length]!, decision,
        })
        assert.equal(d.ok, true, `${i + 1} 段目を判定できる`)

        // この周は判定を編集して、また戻す。**元の判定は消えない。**
        if (editThisRound && i === 0) {
          const before = await scalar<number>(db,
            `SELECT count(*)::int FROM status_histories WHERE application_id = $1`, [applicationId])
          const cur = await one<{ history_id: string }>(db, `
            SELECT id AS history_id FROM status_histories
             WHERE application_id = $1 ORDER BY occurred_at DESC, id DESC LIMIT 1`, [applicationId])
          const flip = await correctDecision(db, {
            applicationId, historyId: cur.history_id, staffId: staff[0]!, note: '周回テストの編集',
          })
          assert.equal(flip.ok, true, '判定を編集できる')
          const back = await correctDecision(db, {
            applicationId,
            historyId: await scalar<string>(db, `
              SELECT id FROM status_histories WHERE application_id = $1
               ORDER BY occurred_at DESC, id DESC LIMIT 1`, [applicationId]),
            staffId: staff[0]!, note: '周回テストの戻し',
          })
          assert.equal(back.ok, true, '編集をさらに編集して戻せる')
          const after = await scalar<number>(db,
            `SELECT count(*)::int FROM status_histories WHERE application_id = $1`, [applicationId])
          assert.equal(after, before + 2, '編集は上書きではなく追記（2行増える）')
        }

        if (decision === 'reject') break
      }

      // --- 毎周たしかめる不変条件 ---

      // 1. 結末は必ず1つに決まる。
      const outcomes = await all<{ outcome: string }>(db,
        `SELECT outcome FROM v_application_outcome WHERE application_id = $1`, [applicationId])
      assert.equal(outcomes.length, 1, `${n} 周目: 結末が1つに決まる`)

      // 2. 合格の定義は「最終段への有効な通過」。段数を決め打ちしない。
      const accepted = await scalar<boolean>(db,
        `SELECT is_accepted FROM v_application_state WHERE application_id = $1`, [applicationId])
      assert.equal(accepted, !rejectAtEnd, `${n} 周目: 合否が道と一致する`)

      // 3. 片付いた応募に、やることは残らない。
      const left = await scalar<number>(db,
        `SELECT count(*)::int FROM v_open_tasks WHERE application_id = $1`, [applicationId])
      assert.equal(left, 0, `${n} 周目: やることが残らない`)
    }
  })

  test('★ 有効な判定は件数で数えると二重になる。だから EXISTS で判定する', async () => {
    // ここは**落とし穴を踏ませるためのテスト**である。
    //
    // 編集をさらに編集すると、元の判定が有効に戻る（会計の逆仕訳）。
    // そのとき同じ段に**有効な通過が2件**並ぶ ―― 元の行と、戻した行。
    // 件数で合否を判定すると、この応募だけ二重に数える。
    //
    // 最初これを「二重にならない」と書いて落とした。**誤っていたのは
    // 実装ではなくテストの側で、逆仕訳はそういう挙動である。**
    const doubled = await all<{ application_id: string }>(db, `
      SELECT application_id FROM v_effective_status_histories
       WHERE transition_type = 'advance'
       GROUP BY application_id, selection_step_id
      HAVING count(*) > 1`)
    assert.ok(doubled.length > 0,
      '編集を往復した応募が1件も無い。落とし穴を踏んでいないので検査になっていない')

    // それでも**結末は1つに決まる**。v_application_state は EXISTS で見ている。
    for (const d of doubled) {
      const rows = await all(db,
        `SELECT outcome FROM v_application_outcome WHERE application_id = $1`,
        [d.application_id])
      assert.equal(rows.length, 1, '二重に数えられる応募でも、結末は1つ')
    }
  })

  test('何周回しても、点は軸の満点を超えない', async () => {
    const over = await scalar<number>(db, `
      SELECT count(*)::int FROM evaluation_scores es
        JOIN evaluation_criteria ec ON ec.id = es.criteria_id
       WHERE es.score > ec.scale_max OR es.score < 0`)
    assert.equal(over, 0)
  })

  test('回した結果が、集計の母集団と食い違わない', async () => {
    // 数える応募と、動いている応募は別の述語である（混同しない）。
    // 片付いた応募が「動いている」に残っていたら、やることが永遠に消えない。
    const stillActive = await scalar<number>(db, `
      SELECT count(*)::int FROM v_active_applications a
        JOIN v_application_outcome o ON o.application_id = a.id
       WHERE o.outcome <> 'in_selection'`)
    assert.equal(stillActive, 0, '結末の付いた応募が「動いている」に残っている')
  })
})

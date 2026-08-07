import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { scalar, maybeOne, type Db } from '../src/db/client.ts'
import {
  baseFixture, makeSeason, makePerson, makeApplication, jst,
  type Fixture, type Season,
} from './support/fixtures.ts'
import { saveScore, SAVE_SCORE_CODE_MESSAGE, parseSaveScoreCode } from '../src/commands/score.ts'
import { getApplicationEvaluations } from '../src/queries/drilldown.ts'

/**
 * E2「1軸だけ保存する」の検証。
 *
 * ★ このテストの主目的は、**記録層の拒否を正しく写せているか**である。
 *
 *   `src/commands/score.ts` は入力の検証を持たない。規則はすべて記録層に
 *   あり（CHECK とトリガ）、保存を試みて失敗を写して返す。
 *   写す先は制約名とトリガの文面なので、**それが変わったら落ちなければ
 *   ならない。** だから1つずつ実際に踏ませる。
 *
 *   検証を書き写すより、写し間違いがテストで出るほうを選んだ、という判断の
 *   裏づけがここである。
 */

let db: Db
let fx: Fixture
let season: Season
let interviewer: string
let criteriaA: string
let criteriaB: string
let reapplicantOnly: string
/** 別ステップの軸。付けられてはいけない。 */
let otherStepCriteria: string

before(async () => {
  db = await freshDb()
  fx = await baseFixture(db)
  season = await makeSeason(db, { year: 2026, steps: ['書類選考', '一次面接'] })
  interviewer = await scalar<string>(db, `
    INSERT INTO staffs (display_name, email) VALUES ('面接官 一郎', 's1@example.test')
    RETURNING id`)

  criteriaA = await scalar<string>(db, `
    INSERT INTO evaluation_criteria (selection_step_id, name, scale_max, sort_order)
    VALUES ($1, '志望動機の具体性', 5, 1) RETURNING id`, [season.stepIds[0]])
  criteriaB = await scalar<string>(db, `
    INSERT INTO evaluation_criteria (selection_step_id, name, scale_max, sort_order)
    VALUES ($1, '行動実績', 5, 2) RETURNING id`, [season.stepIds[0]])
  reapplicantOnly = await scalar<string>(db, `
    INSERT INTO evaluation_criteria
      (selection_step_id, name, scale_max, applies_to, sort_order)
    VALUES ($1, '前回からの変化', 5, 'reapplicant_only', 99) RETURNING id`,
    [season.stepIds[0]])
  otherStepCriteria = await scalar<string>(db, `
    INSERT INTO evaluation_criteria (selection_step_id, name, scale_max, sort_order)
    VALUES ($1, '主体性', 5, 1) RETURNING id`, [season.stepIds[1]])
})

after(async () => { await db.close() })

/** 「評価する」として運転席に出る評価を1件作る。 */
async function evaluatable(opts: {
  reapplication?: boolean
  owner?: string | null
  state?: 'pending' | 'held'
  referrerPerson?: string
} = {}) {
  const person = await makePerson(db, fx.schoolId,
    opts.referrerPerson ? { referrerPersonId: opts.referrerPerson } : {})
  const app = await makeApplication(db, person, season.id, jst('2025-11-01T20:00:00'),
    { isReapplication: opts.reapplication ?? false })
  const evaluationId = await scalar<string>(db, `
    INSERT INTO evaluations (application_id, selection_step_id, interviewer_staff_id,
                             state, assigned_at, hold_reason)
    VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [app, season.stepIds[0],
     opts.owner === undefined ? interviewer : opts.owner,
     opts.state ?? 'pending', jst('2025-11-02T10:00:00'),
     (opts.state ?? 'pending') === 'held' ? '日程を再調整中' : null])
  return { person, app, evaluationId }
}

const scoreRow = (evaluationId: string, criteriaId: string) =>
  maybeOne<{ score: number; rationale: string }>(db, `
    SELECT score, rationale FROM evaluation_scores
     WHERE evaluation_id = $1 AND criteria_id = $2`, [evaluationId, criteriaId])

const RATIONALE = '在庫管理の仕組みを自分で作った経緯が具体的に語られた'

describe('1軸だけ保存する', () => {
  test('点と根拠が保存され、その軸は「これから付ける軸」から消える', async () => {
    const { app, evaluationId } = await evaluatable()
    const before = await getApplicationEvaluations(db, app)
    assert.equal(before[0]!.pending_criteria.length, 2)

    const result = await saveScore(db, {
      evaluationId, criteriaId: criteriaA, score: 4, rationale: RATIONALE,
    })
    assert.equal(result.ok, true)
    assert.equal(result.ok && result.criteriaName, '志望動機の具体性')

    const saved = await scoreRow(evaluationId, criteriaA)
    assert.equal(saved?.score, 4)
    assert.equal(saved?.rationale, RATIONALE)

    const after = await getApplicationEvaluations(db, app)
    assert.deepEqual(after[0]!.pending_criteria.map((c) => c.criteria_name), ['行動実績'])
    assert.equal(after[0]!.scores.length, 1)
  })

  test('1軸ずつ足していける（途中で止めても残る）', async () => {
    // 面接の途中で1つだけ書き留められることが、この単位で作った理由である。
    const { app, evaluationId } = await evaluatable()
    await saveScore(db, { evaluationId, criteriaId: criteriaA, score: 3, rationale: RATIONALE })
    const mid = await getApplicationEvaluations(db, app)
    assert.equal(mid[0]!.scores.length, 1)
    assert.equal(mid[0]!.pending_criteria.length, 1)

    await saveScore(db, { evaluationId, criteriaId: criteriaB, score: 5, rationale: RATIONALE })
    const done = await getApplicationEvaluations(db, app)
    assert.equal(done[0]!.scores.length, 2)
    assert.deepEqual(done[0]!.pending_criteria, [])
    // 全軸そろっても、確定（submitted）にはしない。それは E3 の判断。
    assert.equal(await scalar<string>(db,
      `SELECT state FROM evaluations WHERE id = $1`, [evaluationId]), 'pending')
  })

  test('0 点も保存できる（未入力と区別する）', async () => {
    // 0 を弾くと「0 点だった」を記録できない。下限は 0（CHECK score >= 0）。
    const { evaluationId } = await evaluatable()
    const result = await saveScore(db, {
      evaluationId, criteriaId: criteriaA, score: 0, rationale: '該当する取り組みが挙がらなかった',
    })
    assert.equal(result.ok, true)
    assert.equal((await scoreRow(evaluationId, criteriaA))?.score, 0)
  })

  test('再応募なら、再応募者限定の軸にも付けられる', async () => {
    const { evaluationId } = await evaluatable({ reapplication: true })
    const result = await saveScore(db, {
      evaluationId, criteriaId: reapplicantOnly, score: 4, rationale: RATIONALE,
    })
    assert.equal(result.ok, true)
  })
})

describe('記録層の拒否を、画面の言葉に写せている', () => {
  // ここが写し間違いを見つける唯一の場所である。1つずつ実際に踏ませる。

  test('根拠が空だと拒否される（空白・改行・タブ・全角スペースも）', async () => {
    // **0015 で塞いだ穴である。** btrim の既定は半角スペースだけを落とすため、
    // 改行だけ・タブだけ・全角スペースだけの根拠が保存できていた。
    // 原典の意図（資料5-3「空文字が通ると必須化が形骸化する」）はそのままで、
    // 実装が半角スペースしか見ていなかった。
    const { evaluationId } = await evaluatable()
    for (const rationale of ['', '   ', '\n', '\t', ' \n\t ', '\u3000', '\u3000 \n']) {
      const result = await saveScore(db, {
        evaluationId, criteriaId: criteriaA, score: 3, rationale,
      })
      assert.equal(!result.ok && result.reason, 'rationale_blank',
        `rationale=${JSON.stringify(rationale)} が通ってしまう`)
    }
    assert.equal(await scoreRow(evaluationId, criteriaA), null)
  })

  test('前後に空白があっても、中身があれば保存できる', async () => {
    // 塞ぎ方が強すぎないことの確認。落とすのは前後だけで、中身は触らない。
    const { evaluationId } = await evaluatable()
    const result = await saveScore(db, {
      evaluationId, criteriaId: criteriaA, score: 4, rationale: `\n  ${RATIONALE}  \n`,
    })
    assert.equal(result.ok, true)
    const saved = await scoreRow(evaluationId, criteriaA)
    assert.ok(saved!.rationale.includes(RATIONALE), '入力された文字はそのまま残す')
  })

  test('満点を超えた点は拒否される（トリガの scale_max 参照）', async () => {
    const { evaluationId } = await evaluatable()
    const result = await saveScore(db, {
      evaluationId, criteriaId: criteriaA, score: 6, rationale: RATIONALE,
    })
    assert.equal(!result.ok && result.reason, 'score_out_of_range')
    assert.equal(await scoreRow(evaluationId, criteriaA), null)
  })

  test('負の点は拒否される（CHECK score >= 0）', async () => {
    const { evaluationId } = await evaluatable()
    const result = await saveScore(db, {
      evaluationId, criteriaId: criteriaA, score: -1, rationale: RATIONALE,
    })
    assert.equal(!result.ok && result.reason, 'score_out_of_range')
  })

  test('整数でない点は拒否される', async () => {
    const { evaluationId } = await evaluatable()
    const result = await saveScore(db, {
      evaluationId, criteriaId: criteriaA, score: 3.5, rationale: RATIONALE,
    })
    assert.equal(!result.ok && result.reason, 'score_out_of_range')
  })

  test('再応募でない応募に、再応募者限定の軸は付けられない', async () => {
    const { evaluationId } = await evaluatable({ reapplication: false })
    const result = await saveScore(db, {
      evaluationId, criteriaId: reapplicantOnly, score: 4, rationale: RATIONALE,
    })
    assert.equal(!result.ok && result.reason, 'criteria_not_applicable')
  })

  test('別のステップの軸は付けられない', async () => {
    // 付くと、ステップ別の平均点が別物の混合になる（原典のトリガのコメント）。
    const { evaluationId } = await evaluatable()
    const result = await saveScore(db, {
      evaluationId, criteriaId: otherStepCriteria, score: 4, rationale: RATIONALE,
    })
    assert.equal(!result.ok && result.reason, 'criteria_not_applicable')
  })

  test('同じ軸に二度は付けられない（訂正は別の判断）', async () => {
    const { evaluationId } = await evaluatable()
    await saveScore(db, { evaluationId, criteriaId: criteriaA, score: 4, rationale: RATIONALE })
    const again = await saveScore(db, {
      evaluationId, criteriaId: criteriaA, score: 2, rationale: '考え直した',
    })
    assert.equal(!again.ok && again.reason, 'already_scored')
    assert.equal((await scoreRow(evaluationId, criteriaA))?.score, 4, '先に入った点が残る')
  })
})

describe('点を付けられない状態', () => {
  test('担当が決まっていない評価には付けられない', async () => {
    const { evaluationId } = await evaluatable({ owner: null })
    const result = await saveScore(db, {
      evaluationId, criteriaId: criteriaA, score: 4, rationale: RATIONALE,
    })
    assert.equal(!result.ok && result.reason, 'not_evaluatable')
    assert.equal(await scoreRow(evaluationId, criteriaA), null)
  })

  test('保留中の評価には付けられない（先に解く）', async () => {
    const { evaluationId } = await evaluatable({ state: 'held' })
    const result = await saveScore(db, {
      evaluationId, criteriaId: criteriaA, score: 4, rationale: RATIONALE,
    })
    assert.equal(!result.ok && result.reason, 'not_evaluatable')
  })

  test('利益相反が出ている評価には付けられない（先に担当を替える）', async () => {
    // 運転席が出している順序を、点の入力で素通りできてはいけない。
    const mentorPerson = await makePerson(db, fx.schoolId)
    const mentorStaff = await scalar<string>(db, `
      INSERT INTO staffs (person_id, display_name, email)
      VALUES ($1,'紹介者スタッフ','s2@example.test') RETURNING id`, [mentorPerson])
    const { evaluationId } = await evaluatable({
      owner: mentorStaff, referrerPerson: mentorPerson,
    })
    const result = await saveScore(db, {
      evaluationId, criteriaId: criteriaA, score: 4, rationale: RATIONALE,
    })
    assert.equal(!result.ok && result.reason, 'not_evaluatable')
    assert.equal(await scoreRow(evaluationId, criteriaA), null)
  })

  test('動いていない応募には付けられない', async () => {
    const { app, evaluationId } = await evaluatable()
    const reason = await scalar<string>(db, `
      INSERT INTO void_reasons (code, label, counts_as_application)
      VALUES ('withdrawn_20', '選考前の取り下げ', true) RETURNING id`)
    await db.query(
      `UPDATE applications SET voided_at = $2, void_reason_id = $3 WHERE id = $1`,
      [app, jst('2025-11-10T10:00:00'), reason])

    const result = await saveScore(db, {
      evaluationId, criteriaId: criteriaA, score: 4, rationale: RATIONALE,
    })
    assert.equal(!result.ok && result.reason, 'not_evaluatable')
  })

  test('個人情報削除を受けた人の評価には付けられない', async () => {
    const { person, evaluationId } = await evaluatable()
    await db.query(`UPDATE persons SET deleted_at = now() WHERE id = $1`, [person])
    const result = await saveScore(db, {
      evaluationId, criteriaId: criteriaA, score: 4, rationale: RATIONALE,
    })
    assert.equal(!result.ok && result.reason, 'not_evaluatable')
  })

  test('壊れた id は 500 にせず、見つからないで返す', async () => {
    for (const bad of ['', 'not-a-uuid', "'; DROP TABLE evaluation_scores; --"]) {
      const result = await saveScore(db, {
        evaluationId: bad, criteriaId: criteriaA, score: 4, rationale: RATIONALE,
      })
      assert.equal(!result.ok && result.reason, 'evaluation_not_found', `id=${bad}`)
    }
    const { evaluationId } = await evaluatable()
    const badCriteria = await saveScore(db, {
      evaluationId, criteriaId: 'nope', score: 4, rationale: RATIONALE,
    })
    assert.equal(!badCriteria.ok && badCriteria.reason, 'criteria_not_applicable')
    assert.ok(Number(await scalar<string>(db, `SELECT count(*) FROM evaluation_scores`)) >= 0)
  })
})

describe('画面へ返すコード', () => {
  test('すべてのコードに文言がある', () => {
    const codes = ['saved', 'evaluation_not_found', 'not_evaluatable',
      'criteria_not_applicable', 'already_scored', 'score_out_of_range',
      'rationale_blank'] as const
    for (const c of codes) assert.ok(SAVE_SCORE_CODE_MESSAGE[c]?.length > 0, c)
    assert.equal(Object.keys(SAVE_SCORE_CODE_MESSAGE).length, codes.length,
      '文言の数とコードの数が合っていない')
  })

  test('知らないコードは捨てる', () => {
    assert.equal(parseSaveScoreCode('nope'), null)
    assert.equal(parseSaveScoreCode('saved'), 'saved')
  })
})

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { all, one, scalar, type Db } from '../src/db/client.ts'
import { holdEvaluation } from '../src/commands/hold.ts'
import { unholdEvaluation } from '../src/commands/unhold.ts'
import { assignInterviewer } from '../src/commands/assign.ts'
import { saveScore } from '../src/commands/score.ts'
import { submitEvaluation, decideStep } from '../src/commands/decide.ts'

/**
 * 保留にする（C-35）。`unhold` の対で、これまで**片道しか無かった**。
 *
 * 実行⑦で架空の10人を通したときに詰まって見つけた。デモデータは記録層へ
 * 直接 `held` を書いて作っていたので、これまで表に出なかった。
 */

interface World {
  db: Db
  steps: Array<{ id: string; name: string; sort_order: number }>
  staff: string[]
  schoolId: string
  seasonId: string
}

async function world(db: Db): Promise<World> {
  const season = await one<{ id: string }>(db, `SELECT id FROM seasons`)
  const steps = await all<{ id: string; name: string; sort_order: number }>(
    db, `SELECT id, name, sort_order FROM selection_steps ORDER BY sort_order`)
  const schoolId = await scalar<string>(
    db, `INSERT INTO schools (name) VALUES ('架空高校') RETURNING id`)
  const staff = (await all<{ id: string }>(db, `
    INSERT INTO staffs (display_name, email)
    VALUES ('架空 面接官A','a@example.test'),('架空 面接官B','b@example.test')
    RETURNING id`)).map((s) => s.id)
  return { db, steps, staff, schoolId, seasonId: season.id }
}

/** 判断待ちの評価を1件つくる（担当まで決めた状態）。 */
async function pendingEvaluation(w: World, tag: string, stepIndex = 3) {
  const person = await scalar<string>(w.db, `
    INSERT INTO persons (family_name, given_name, birth_date, school_id, email)
    VALUES ('架空', $1, DATE '2007-04-01', $2, $3) RETURNING id`,
    [tag, w.schoolId, `${tag}@example.test`])
  const appId = await scalar<string>(w.db, `
    INSERT INTO applications (person_id, season_id, submitted_at)
    VALUES ($1, $2, TIMESTAMPTZ '2026-03-15 10:00+09') RETURNING id`, [person, w.seasonId])
  const evalId = await scalar<string>(w.db, `
    INSERT INTO evaluations (application_id, selection_step_id, assigned_at)
    VALUES ($1, $2, now()) RETURNING id`, [appId, w.steps[stepIndex]!.id])
  assert.ok((await assignInterviewer(w.db, { evaluationId: evalId, staffId: w.staff[0]! })).ok)
  return { appId, evalId }
}

describe('保留にする（C-35）', () => {
  test('判断待ちの評価を保留にできる', async () => {
    const db = await freshDb({ seeds: 'production' })
    const w = await world(db)
    const { evalId } = await pendingEvaluation(w, '保留にする')

    const r = await holdEvaluation(db, {
      evaluationId: evalId, reason: '追加提出を依頼して返答待ち',
    })
    assert.ok(r.ok, `保留が ${JSON.stringify(r)}`)

    const row = await one<{ state: string; hold_reason: string }>(
      db, `SELECT state, hold_reason FROM evaluations WHERE id = $1`, [evalId])
    assert.equal(row.state, 'held')
    assert.equal(row.hold_reason, '追加提出を依頼して返答待ち')
    await db.close()
  })

  test('理由が空だと保留にできない（空白だけも通さない）', async () => {
    // 制約が要求しているのは NOT NULL だけ。空白だけの文字列は通ってしまう。
    // A-19 で同じ穴が rationale に開いていた。同じ間違いを2度しない。
    const db = await freshDb({ seeds: 'production' })
    const w = await world(db)
    const { evalId } = await pendingEvaluation(w, '理由なし')

    for (const bad of ['', '   ', '\t\n', '　']) {
      const r = await holdEvaluation(db, { evaluationId: evalId, reason: bad })
      assert.equal(r.ok, false, `理由 ${JSON.stringify(bad)} が通った`)
      assert.equal((r as { reason: string }).reason, 'reason_required')
    }
    assert.equal(
      await scalar<string>(db, `SELECT state FROM evaluations WHERE id = $1`, [evalId]),
      'pending', '弾いたのに状態が変わっている')
    await db.close()
  })

  test('すでに保留の評価は、もう一度保留にできない', async () => {
    const db = await freshDb({ seeds: 'production' })
    const w = await world(db)
    const { evalId } = await pendingEvaluation(w, '二重保留')
    assert.ok((await holdEvaluation(db, { evaluationId: evalId, reason: '1回目' })).ok)

    const r = await holdEvaluation(db, { evaluationId: evalId, reason: '2回目' })
    assert.equal(r.ok, false)
    assert.equal((r as { reason: string }).reason, 'not_pending')
    assert.equal(
      await scalar<string>(db, `SELECT hold_reason FROM evaluations WHERE id = $1`, [evalId]),
      '1回目', '最初の理由が上書きされた')
    await db.close()
  })

  test('確定済みの評価は保留にできない', async () => {
    const db = await freshDb({ seeds: 'production' })
    const w = await world(db)
    const { evalId } = await pendingEvaluation(w, '確定済み')
    const step = w.steps[3]!
    for (const c of await all<{ id: string; name: string; scale_max: number }>(db, `
      SELECT id, name, scale_max FROM evaluation_criteria
       WHERE selection_step_id = $1`, [step.id])) {
      assert.ok((await saveScore(db, {
        evaluationId: evalId, criteriaId: c.id, score: c.scale_max, rationale: `${c.name}: 根拠`,
      })).ok)
    }
    assert.ok((await submitEvaluation(db, { evaluationId: evalId })).ok)

    const r = await holdEvaluation(db, { evaluationId: evalId, reason: 'あとから止める' })
    assert.equal(r.ok, false)
    assert.equal((r as { reason: string }).reason, 'not_pending')
    await db.close()
  })

  test('動いていない応募の評価は保留にできない', async () => {
    const db = await freshDb({ seeds: 'production' })
    const w = await world(db)
    const { appId, evalId } = await pendingEvaluation(w, '不合格ずみ', 1)
    // 書類選考は軸が0本なので、点を付けずに確定できる（C-33）。
    assert.ok((await submitEvaluation(db, { evaluationId: evalId })).ok)
    assert.ok((await decideStep(db, {
      applicationId: appId, decision: 'reject', staffId: w.staff[0]!,
    })).ok)

    const r = await holdEvaluation(db, { evaluationId: evalId, reason: '止める' })
    assert.equal(r.ok, false)
    assert.equal((r as { reason: string }).reason, 'not_active')
    await db.close()
  })

  test('保留にして解くと、判断待ちに戻り理由は残る（往復）', async () => {
    const db = await freshDb({ seeds: 'production' })
    const w = await world(db)
    const { evalId } = await pendingEvaluation(w, '往復')

    assert.ok((await holdEvaluation(db, { evaluationId: evalId, reason: '書類の再提出待ち' })).ok)
    assert.ok((await unholdEvaluation(db, { evaluationId: evalId })).ok)

    const row = await one<{ state: string; hold_reason: string | null }>(
      db, `SELECT state, hold_reason FROM evaluations WHERE id = $1`, [evalId])
    assert.equal(row.state, 'pending', '解いたのに判断待ちに戻っていない')
    assert.equal(row.hold_reason, '書類の再提出待ち',
      '解いたら理由が消えた。何を待っていたかが記録から失われる')

    // もう一度保留にできる。往復が片道で終わらない。
    assert.ok((await holdEvaluation(db, { evaluationId: evalId, reason: '2回目の待ち' })).ok)
    assert.equal(
      await scalar<string>(db, `SELECT hold_reason FROM evaluations WHERE id = $1`, [evalId]),
      '2回目の待ち', '2回目の理由が入っていない')
    await db.close()
  })

  test('保留にすると、やることが「保留を解く」に変わる', async () => {
    // 運転席の順序（先に担当を決める・解く・替える）と噛み合っているか。
    const db = await freshDb({ seeds: 'production' })
    const w = await world(db)
    const { appId, evalId } = await pendingEvaluation(w, 'やること')

    assert.equal(
      await scalar<string>(db, `SELECT kind FROM v_open_tasks WHERE application_id = $1`, [appId]),
      'evaluate', '担当が決まったら「評価する」に出るはず')

    assert.ok((await holdEvaluation(db, { evaluationId: evalId, reason: '待ち' })).ok)
    assert.equal(
      await scalar<string>(db, `SELECT kind FROM v_open_tasks WHERE application_id = $1`, [appId]),
      'unhold', '保留にしたのに「保留を解く」に出ない')

    // 1つの評価は1件のやることにしか出ない（A-18 の性質を保留でも確かめる）
    assert.equal(
      await scalar<number>(db, `
        SELECT count(*)::int FROM v_open_tasks WHERE application_id = $1`, [appId]),
      1, '同じ応募のやることが二重に出ている')
    await db.close()
  })
})

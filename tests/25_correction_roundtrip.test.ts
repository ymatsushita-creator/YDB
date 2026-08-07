import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { all, one, maybeOne, scalar, type Db } from '../src/db/client.ts'
import { assignInterviewer } from '../src/commands/assign.ts'
import { saveScore } from '../src/commands/score.ts'
import {
  submitEvaluation, decideStep, getCorrectableDecision, correctDecision,
} from '../src/commands/decide.ts'

/**
 * 判定を何度も訂正して、記録が壊れないかを見る（自作テスト その3）。
 *
 * 訂正は**打ち消し行の追記**で表す（原則5）。UPDATE も DELETE も
 * トリガが拒否する。だから往復させても**元の記録は1行も減らない**はずで、
 * 有効な判定は `v_effective_status_histories` が「深さ偶数＝有効」で解く。
 *
 * ここを厚くする理由は2つある。
 *
 *   1. **訂正はいちばん人が触る場所**である。押し間違いは必ず起きる
 *   2. **バグが偶然に作っていた経路は、バグを直すと一緒に消える**（tests/13）。
 *      往復の回数を増やさないと、偶数回目と奇数回目のどちらかしか通らない
 */

interface World { db: Db; steps: Array<{ id: string; name: string; sort_order: number }>; staff: string[]; schoolId: string; seasonId: string }

async function world(db: Db): Promise<World> {
  const season = await one<{ id: string }>(db, `SELECT id FROM seasons`)
  const steps = await all<{ id: string; name: string; sort_order: number }>(
    db, `SELECT id, name, sort_order FROM selection_steps ORDER BY sort_order`)
  const schoolId = await scalar<string>(db, `INSERT INTO schools (name) VALUES ('架空高校') RETURNING id`)
  const staff = (await all<{ id: string }>(db, `
    INSERT INTO staffs (display_name, email)
    VALUES ('架空 面接官A','a@example.test'),('架空 面接官B','b@example.test') RETURNING id`))
    .map((s) => s.id)
  return { db, steps, staff, schoolId, seasonId: season.id }
}

async function readyToDecide(w: World, tag: string, step: { id: string; name: string }) {
  const person = await scalar<string>(w.db, `
    INSERT INTO persons (family_name, given_name, birth_date, school_id, email)
    VALUES ('架空', $1, DATE '2007-04-01', $2, $3) RETURNING id`,
    [tag, w.schoolId, `${tag}@example.test`])
  const appId = await scalar<string>(w.db, `
    INSERT INTO applications (person_id, season_id, submitted_at)
    VALUES ($1, $2, TIMESTAMPTZ '2026-03-15 10:00+09') RETURNING id`, [person, w.seasonId])
  const evalId = await scalar<string>(w.db, `
    INSERT INTO evaluations (application_id, selection_step_id, assigned_at)
    VALUES ($1, $2, now()) RETURNING id`, [appId, step.id])
  assert.ok((await assignInterviewer(w.db, { evaluationId: evalId, staffId: w.staff[0]! })).ok)
  for (const c of await all<{ id: string; name: string; scale_max: number }>(w.db, `
    SELECT id, name, scale_max FROM evaluation_criteria
     WHERE selection_step_id = $1 ORDER BY sort_order`, [step.id])) {
    assert.ok((await saveScore(w.db, {
      evaluationId: evalId, criteriaId: c.id, score: c.scale_max, rationale: `${c.name}: 根拠`,
    })).ok)
  }
  assert.ok((await submitEvaluation(w.db, { evaluationId: evalId })).ok)
  return appId
}

const effective = (db: Db, appId: string) =>
  maybeOne<{ transition_type: string }>(db, `
    SELECT transition_type FROM v_effective_status_histories
     WHERE application_id = $1 ORDER BY occurred_at DESC, created_at DESC LIMIT 1`, [appId])

describe('判定の訂正を往復させる', () => {
  test('10回訂正しても、結末は毎回1つに決まる', async () => {
    const db = await freshDb({ seeds: 'production' })
    const w = await world(db)
    const step = w.steps[1]!                       // 書類選考
    const appId = await readyToDecide(w, '往復', step)

    assert.ok((await decideStep(db, {
      applicationId: appId, decision: 'reject', staffId: w.staff[0]!,
    })).ok, '最初の判定が通らない')

    for (let i = 1; i <= 10; i++) {
      const target = await getCorrectableDecision(db, appId)
      assert.ok(target, `${i} 回目: 訂正できる判定が見つからない`)
      const r = await correctDecision(db, {
        applicationId: appId,
        historyId: (target as { history_id: string }).history_id,
        staffId: w.staff[i % 2]!,
      })
      assert.ok(r.ok, `${i} 回目の訂正が ${JSON.stringify(r)}`)

      // 奇数回で通過、偶数回で不合格へ戻る。往復が噛み合っているか。
      const now = await effective(db, appId)
      assert.equal(now?.transition_type, i % 2 === 1 ? 'advance' : 'reject',
        `${i} 回目のあとの判定が合わない`)

      // **結末は常に1つ。** 有効な行は複数になりうる（下のテスト参照）が、
      // 応募1件が同時に合格でも不合格でもある状態は作れない。
      const outcome = await one<{ outcome: string }>(db, `
        SELECT outcome FROM v_application_outcome WHERE application_id = $1`, [appId])
      assert.equal(outcome.outcome, i % 2 === 1 ? 'in_selection' : 'rejected',
        `${i} 回目のあとの結末が合わない`)
    }

    // 元の記録は1行も減らない（追記のみ）。
    const total = await scalar<number>(
      db, `SELECT count(*)::int FROM status_histories WHERE application_id = $1`, [appId])
    assert.equal(total, 11, `追記が ${total} 行。最初の1件＋訂正10件のはず`)

    await db.close()
  })

  test('訂正で通過に戻すと次の段が立ち、不合格に戻すと消える', async () => {
    const db = await freshDb({ seeds: 'production' })
    const w = await world(db)
    const step = w.steps[1]!
    const appId = await readyToDecide(w, '次段', step)
    const nextStepId = w.steps[2]!.id

    const nextExists = () => scalar<number>(db, `
      SELECT count(*)::int FROM evaluations
       WHERE application_id = $1 AND selection_step_id = $2`, [appId, nextStepId])

    assert.ok((await decideStep(db, {
      applicationId: appId, decision: 'reject', staffId: w.staff[0]!,
    })).ok)
    assert.equal(await nextExists(), 0, '不合格なのに次の段が立っている')

    // 不合格 → 通過
    const t1 = await getCorrectableDecision(db, appId)
    assert.ok((await correctDecision(db, {
      applicationId: appId, historyId: (t1 as { history_id: string }).history_id,
      staffId: w.staff[0]!,
    })).ok)
    assert.equal(await nextExists(), 1, '通過に訂正したのに次の段が立たない')

    // 通過 → 不合格（戻す）
    const t2 = await getCorrectableDecision(db, appId)
    assert.ok((await correctDecision(db, {
      applicationId: appId, historyId: (t2 as { history_id: string }).history_id,
      staffId: w.staff[0]!,
    })).ok)
    assert.equal(
      await scalar<number>(db, `
        SELECT count(*)::int FROM v_open_tasks WHERE application_id = $1`, [appId]),
      0, '不合格に戻したのに、やることが残っている')

    await db.close()
  })

  test('訂正を往復しても、点は1つも増えず減らない', async () => {
    // 判定の訂正は評価の点に触らない。触れば「再現不能なものだけ凍結する」
    // （原則2）が崩れる。往復のたびに数え直す。
    const db = await freshDb({ seeds: 'production' })
    const w = await world(db)
    const appId = await readyToDecide(w, '点の保存', w.steps[3]!)   // 最終面接（6軸）
    const before = await scalar<number>(db, `SELECT count(*)::int FROM evaluation_scores`)
    assert.equal(before, 6, '最終面接の6軸が入っていない')

    assert.ok((await decideStep(db, {
      applicationId: appId, decision: 'advance', staffId: w.staff[0]!,
    })).ok)
    for (let i = 0; i < 4; i++) {
      const t = await getCorrectableDecision(db, appId)
      assert.ok(t, `${i} 回目: 訂正できる判定が無い`)
      assert.ok((await correctDecision(db, {
        applicationId: appId, historyId: (t as { history_id: string }).history_id,
        staffId: w.staff[0]!,
      })).ok)
      assert.equal(
        await scalar<number>(db, `SELECT count(*)::int FROM evaluation_scores`), before,
        `${i} 回目の訂正で点の数が変わった`)
    }
    await db.close()
  })

  test('★ 有効な判定を件数で数えると二重になる（EXISTS で判定すること）', async () => {
    // 深さ偶数＝有効なので、2回訂正すると**元の行と最新の行の両方が有効**になる
    // （tests/03「訂正を訂正すると元の記録が復活する」の必然）。
    // これは設計どおりで、欠陥ではない。**数え方のほうが罠である。**
    //
    // 0011 の outcome も dashboard も EXISTS で判定しているので影響が無い。
    // 「どのステップで落ちたか」を count(*) で数えると二重になる。
    // ここはその落とし穴が実在することを、テストとして残しておく場所である。
    const db = await freshDb({ seeds: 'production' })
    const w = await world(db)
    const appId = await readyToDecide(w, '数え方', w.steps[1]!)
    assert.ok((await decideStep(db, {
      applicationId: appId, decision: 'reject', staffId: w.staff[0]!,
    })).ok)
    for (let i = 0; i < 2; i++) {
      const t = await getCorrectableDecision(db, appId)
      assert.ok((await correctDecision(db, {
        applicationId: appId, historyId: (t as { history_id: string }).history_id,
        staffId: w.staff[0]!,
      })).ok)
    }

    const rows = await scalar<number>(db, `
      SELECT count(*)::int FROM v_effective_status_histories
       WHERE application_id = $1 AND transition_type = 'reject'`, [appId])
    assert.equal(rows, 2, '2回訂正したのに有効な不合格が2行になっていない（設計が変わった）')

    const outcome = await all<{ outcome: string }>(db, `
      SELECT outcome FROM v_application_outcome WHERE application_id = $1`, [appId])
    assert.equal(outcome.length, 1, '結末が複数行ある')
    assert.equal(outcome[0]!.outcome, 'rejected', '結末は1つに決まるはず')

    const distinct = await scalar<number>(db, `
      SELECT count(DISTINCT application_id)::int FROM v_effective_status_histories
       WHERE application_id = $1 AND transition_type = 'reject'`, [appId])
    assert.equal(distinct, 1, '応募単位で数えれば1件。集計はこちらで数える')
    await db.close()
  })

  test('記録は追記しかできない（UPDATE も DELETE もトリガが拒否する）', async () => {
    const db = await freshDb({ seeds: 'production' })
    const w = await world(db)
    const appId = await readyToDecide(w, '追記のみ', w.steps[1]!)
    assert.ok((await decideStep(db, {
      applicationId: appId, decision: 'reject', staffId: w.staff[0]!,
    })).ok)

    await assert.rejects(
      () => db.query(`UPDATE status_histories SET note = '書き換え' WHERE application_id = $1`, [appId]),
      /append|update|immutable|追記/i, 'UPDATE が通ってしまった')
    await assert.rejects(
      () => db.query(`DELETE FROM status_histories WHERE application_id = $1`, [appId]),
      /append|delete|immutable|追記/i, 'DELETE が通ってしまった')

    await db.close()
  })
})

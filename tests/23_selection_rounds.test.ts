import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { all, one, maybeOne, scalar, type Db } from '../src/db/client.ts'
import { assignInterviewer } from '../src/commands/assign.ts'
import { saveScore } from '../src/commands/score.ts'
import { submitEvaluation, decideStep } from '../src/commands/decide.ts'
import { unholdEvaluation } from '../src/commands/unhold.ts'
import { getOpenTasks } from '../src/queries/cockpit.ts'

/**
 * 選考を20周まわして、毎周そのつど不変条件を検査する（自作テスト その1）。
 *
 * **実在する2026年度（本番シード）で回す。** デモの年度で回すと、
 * デモが埋めてしまっている欠落が見えない ―― 実行④〜⑥で5回踏んだ
 * 「デモデータが検証したい経路を踏んでいない」を避けるため。
 *
 * 周ごとに**操作の順序と分岐を変える。** 同じ道を20回通っても、
 * 通らなかった道の穴は1つも見つからない。
 *
 * 乱数は固定シードの線形合同法で自前に持つ。`Math.random()` を使うと
 * 落ちたときに同じ状態を作り直せず、原因を追えない。
 */

/** 固定シードの疑似乱数。落ちた周を seed で再現できる。 */
const rng = (seed: number) => () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648

interface World {
  db: Db
  seasonId: string
  steps: Array<{ id: string; name: string; sort_order: number }>
  staff: string[]
  schoolId: string
}

async function world(db: Db): Promise<World> {
  const season = await one<{ id: string }>(db, `SELECT id FROM seasons`)
  const steps = await all<{ id: string; name: string; sort_order: number }>(
    db, `SELECT id, name, sort_order FROM selection_steps ORDER BY sort_order`)
  const schoolId = await scalar<string>(
    db, `INSERT INTO schools (name) VALUES ('架空高校') RETURNING id`)
  const staff = (await all<{ id: string }>(db, `
    INSERT INTO staffs (display_name, email) VALUES
      ('架空 面接官A','a@example.test'),
      ('架空 面接官B','b@example.test'),
      ('架空 面接官C','c@example.test') RETURNING id`)).map((s) => s.id)
  return { db, seasonId: season.id, steps, staff, schoolId }
}

async function newApplication(w: World, tag: string): Promise<string> {
  const person = await scalar<string>(w.db, `
    INSERT INTO persons (family_name, given_name, birth_date, school_id, email)
    VALUES ('架空', $1, DATE '2007-04-01', $2, $3) RETURNING id`,
    [tag, w.schoolId, `${tag}@example.test`])
  return scalar<string>(w.db, `
    INSERT INTO applications (person_id, season_id, submitted_at)
    VALUES ($1, $2, TIMESTAMPTZ '2026-03-15 10:00+09') RETURNING id`, [person, w.seasonId])
}

/** その段の評価を、担当決め → （保留 → 解除）→ 採点 → 確定 まで進める。 */
async function work(
  w: World, appId: string, step: { id: string; name: string }, who: number, hold: boolean,
) {
  // 通過すると次の段の評価はアプリが自動で作る（C-24）。あればそれを使う。
  // scalar は行が無いと throw する。無いのが正常な場合があるので maybeOne を使う。
  const found = await maybeOne<{ id: string }>(w.db, `
    SELECT id FROM evaluations WHERE application_id = $1 AND selection_step_id = $2`,
    [appId, step.id])
  let evalId = found?.id ?? null
  if (!evalId) {
    evalId = await scalar<string>(w.db, `
      INSERT INTO evaluations (application_id, selection_step_id, assigned_at)
      VALUES ($1, $2, now()) RETURNING id`, [appId, step.id])
  }

  const cur = await one<{ interviewer_staff_id: string | null }>(
    w.db, `SELECT interviewer_staff_id FROM evaluations WHERE id = $1`, [evalId])
  if (!cur.interviewer_staff_id) {
    const a = await assignInterviewer(w.db, { evaluationId: evalId, staffId: w.staff[who]! })
    assert.ok(a.ok, `担当決めが ${JSON.stringify(a)}`)
  }

  if (hold) {
    // **保留にするコマンドは無い**（unhold しかない。C-32）。
    // 運営は画面から保留を作れないので、ここは記録層に直接書いている。
    await w.db.query(`
      UPDATE evaluations SET state = 'held', hold_reason = '追加提出を依頼して返答待ち'
       WHERE id = $1 AND state = 'pending'`, [evalId])
    const u = await unholdEvaluation(w.db, { evaluationId: evalId })
    assert.ok(u.ok, `保留の解除が ${JSON.stringify(u)}`)
  }

  const criteria = await all<{ id: string; name: string; scale_max: number }>(w.db, `
    SELECT id, name, scale_max FROM evaluation_criteria
     WHERE selection_step_id = $1 ORDER BY sort_order`, [step.id])
  for (const c of criteria) {
    const r = await saveScore(w.db, {
      evaluationId: evalId, criteriaId: c.id,
      score: Math.max(1, c.scale_max - 1), rationale: `${c.name}: 架空の根拠`,
    })
    assert.ok(r.ok, `採点が ${JSON.stringify(r)}`)
  }
  const s = await submitEvaluation(w.db, { evaluationId: evalId })
  assert.ok(s.ok, `確定が ${JSON.stringify(s)}`)
}

/** 毎周これを検査する。**周ごとの中身が違っても、成り立つべき性質**である。 */
async function invariants(db: Db, round: number) {
  const at = (s: string) => `${round}周目: ${s}`

  // 1評価は1件のやることにしか出ない（A-18 の再発を全体の性質で見る）
  const dup = await scalar<number>(db, `
    SELECT count(*)::int FROM (
      SELECT source_id FROM v_open_tasks GROUP BY source_id HAVING count(*) > 1) x`)
  assert.equal(dup, 0, at('同じ評価がやることに二重で出ている'))

  // 根拠は空にできない（A-19 で一度破れていた）
  const blank = await scalar<number>(db, `
    SELECT count(*)::int FROM evaluation_scores
     WHERE rationale IS NULL OR btrim(rationale) = ''`)
  assert.equal(blank, 0, at('根拠が空の点がある'))

  // 点は満点を超えない
  const over = await scalar<number>(db, `
    SELECT count(*)::int FROM evaluation_scores es
      JOIN evaluation_criteria ec ON ec.id = es.criteria_id
     WHERE es.score < 0 OR es.score > ec.scale_max`)
  assert.equal(over, 0, at('満点を超えた点がある'))

  // 合格は「最終ステップを通過した応募」と一致する
  const acc = await one<{ flagged: number; via_step: number }>(db, `
    SELECT (SELECT count(*)::int FROM v_application_state WHERE is_accepted) AS flagged,
           (SELECT count(DISTINCT h.application_id)::int
              FROM v_effective_status_histories h
              JOIN selection_steps ss ON ss.id = h.selection_step_id
             WHERE h.transition_type = 'advance'
               AND ss.sort_order = (SELECT max(sort_order) FROM selection_steps)) AS via_step`)
  assert.equal(acc.flagged, acc.via_step, at('合格の数が最終ステップの通過数と合わない'))

  // 動いている応募は、数える応募の部分集合である
  const leak = await scalar<number>(db, `
    SELECT count(*)::int FROM v_active_applications a
     WHERE NOT EXISTS (SELECT 1 FROM v_countable_applications c WHERE c.id = a.id)`)
  assert.equal(leak, 0, at('数えない応募が「動いている」に入っている'))

  // 片付いた応募にやることは残らない
  const ghost = await scalar<number>(db, `
    SELECT count(*)::int FROM v_open_tasks t
     WHERE NOT EXISTS (SELECT 1 FROM v_active_applications a WHERE a.id = t.application_id)`)
  assert.equal(ghost, 0, at('動いていない応募にやることが残っている'))
}

describe('選考を20周まわす（順序と分岐を毎周変える）', () => {
  test('20周とも不変条件が成り立つ', async () => {
    const db = await freshDb({ seeds: 'production' })
    const w = await world(db)
    const rand = rng(20260807)
    const last = w.steps.at(-1)!.sort_order

    let expectedAccepted = 0
    for (let round = 1; round <= 20; round++) {
      const appId = await newApplication(w, `候補${round}`)

      // 周ごとに道を変える。どこで落ちるか / 保留を挟むか / 誰が見るか。
      const rejectAt = rand() < 0.35 ? 1 + Math.floor(rand() * last) : null
      const holdAt = rand() < 0.3 ? 1 + Math.floor(rand() * last) : null
      const withdraw = rejectAt === null && rand() < 0.15

      if (withdraw) {
        await db.query(`
          INSERT INTO status_histories (application_id, transition_type, withdraw_reason_id,
                                        occurred_at, changed_by_staff_id)
          SELECT $1, 'withdraw', wr.id, now(), $2
            FROM withdraw_reasons wr WHERE wr.code = 'unconfirmed'`,
          [appId, w.staff[0]])
      } else {
        for (const st of w.steps) {
          await work(w, appId, st, Math.floor(rand() * w.staff.length), holdAt === st.sort_order)
          const decision = rejectAt === st.sort_order ? 'reject' : 'advance'
          const d = await decideStep(db, {
            applicationId: appId, decision, staffId: w.staff[Math.floor(rand() * 3)]!,
          })
          assert.ok(d.ok, `${round}周目 ${st.name} の判定が ${JSON.stringify(d)}`)
          if (decision === 'reject') break
        }
        if (rejectAt === null) expectedAccepted++
      }

      await invariants(db, round)
    }

    const accepted = await scalar<number>(
      db, `SELECT count(*)::int FROM v_application_state WHERE is_accepted`)
    assert.equal(accepted, expectedAccepted, '合格の数が、通し切った人数と合わない')

    const countable = await scalar<number>(
      db, `SELECT count(*)::int FROM v_countable_applications WHERE season_id = $1`, [w.seasonId])
    assert.equal(countable, 20, '20人ぶんの応募が木に数えられていない')

    await db.close()
  })

  test('20周を通しても、やることは片付いた応募に残らない', async () => {
    // 上の周回のあと「動いている応募」が残っていれば、それは道半ばの応募だけ
    // であるはず。ここでは新しい DB で、全員を通し切ったときに空になるかを見る。
    const db = await freshDb({ seeds: 'production' })
    const w = await world(db)
    for (let i = 0; i < 5; i++) {
      const appId = await newApplication(w, `完走${i}`)
      for (const st of w.steps) {
        await work(w, appId, st, i % 3, false)
        const d = await decideStep(db, {
          applicationId: appId, decision: 'advance', staffId: w.staff[0]!,
        })
        assert.ok(d.ok)
      }
    }
    assert.equal(
      await scalar<number>(db, `SELECT count(*)::int FROM v_open_tasks WHERE season_id = $1`,
        [w.seasonId]),
      0, '全員が合格したのに、やることが残っている')
    assert.equal(
      await scalar<number>(db, `SELECT count(*)::int FROM v_active_applications WHERE season_id = $1`,
        [w.seasonId]),
      0, '全員が合格したのに、動いている応募が残っている')
    await db.close()
  })
})

describe('評価の観点が0本の段（C-33）', () => {
  test('軸が0本の段は、点を1つも付けずに確定できる', async () => {
    // **これは欠陥ではなく、いまの事実である。** 4段のうち3段に軸が無い。
    // 止めると選考が回らないので止めていない。代わりに運転席が
    // 「評価の観点が未登録」と出す。
    //
    // 軸を入れたらこのテストが落ちる。落ちたら画面の分岐も一緒に見直す
    // ―― 「記録が実装より厳密に見える」を作らないため。
    const db = await freshDb({ seeds: 'production' })
    const w = await world(db)
    const noCriteria = await all<{ name: string }>(db, `
      SELECT ss.name FROM selection_steps ss
       WHERE NOT EXISTS (SELECT 1 FROM evaluation_criteria ec
                          WHERE ec.selection_step_id = ss.id)
       ORDER BY ss.sort_order`)
    assert.deepEqual(noCriteria.map((r) => r.name), ['応募受付', '書類選考', 'グループ面接'],
      '軸が0本の段の顔ぶれが変わった。画面の分岐（C-33）も見直すこと')

    const appId = await newApplication(w, '軸なし')
    const step = w.steps[1]!                          // 書類選考
    await work(w, appId, step, 0, false)              // 採点は0件のまま確定まで行く
    assert.equal(
      await scalar<number>(db, `SELECT count(*)::int FROM evaluation_scores`), 0,
      '点が入っている。この段には軸が無いはず')
    const d = await decideStep(db, {
      applicationId: appId, decision: 'advance', staffId: w.staff[0]!,
    })
    assert.ok(d.ok, `点なしの確定が通らない: ${JSON.stringify(d)}`)
    await db.close()
  })

  test('やることは、軸が0本の段でも軸の総数を0として返す', async () => {
    // 運転席の分岐はこの値で決まる。null だと分岐が壊れる。
    const db = await freshDb({ seeds: 'production' })
    const w = await world(db)
    const appId = await newApplication(w, '軸の総数')
    await db.query(`
      INSERT INTO evaluations (application_id, selection_step_id, interviewer_staff_id, assigned_at)
      VALUES ($1, $2, $3, now())`, [appId, w.steps[1]!.id, w.staff[0]])
    // criteria_total はビューではなく getOpenTasks が組み立てている。
    const tasks = await getOpenTasks(db, w.seasonId)
    const t = tasks.find((x) => x.application_id === appId)
    assert.ok(t, 'やることに出ていない')
    assert.equal(Number(t.criteria_total), 0, '軸の総数が0になっていない')
    assert.equal(Number(t.criteria_scored), 0, '付いた軸が0になっていない')
    await db.close()
  })
})

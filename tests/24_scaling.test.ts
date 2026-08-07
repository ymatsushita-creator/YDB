import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { all, one, scalar, type Db } from '../src/db/client.ts'

/**
 * 主画面の集計が、量に対してどう伸びるかを見る（自作テスト その2）。
 *
 * **絞り込みの有無を両方測る。** 片側だけでは必ずどちらかを取り逃す ――
 * A-11 は絞ると速くなって見逃し、A-16 は**絞ると 9000 倍遅くなった**。
 *
 * **秒数は書き残さない。** 機械が違えば違う数字が出るし、
 * 作り物のデータから出た秒数は追試できない（`CLAUDE.md` 9節）。
 * ここが固定するのは**伸び方**である ―― 人が3倍になったとき、
 * 実行計画が変わって桁で跳ねないこと。
 *
 * 実行計画も直接見る。**「集合を返す関数を結合の内側に置かない」**
 * （実行③で一覧が 444 秒になった）と
 * **`MATERIALIZED` を外さない**（A-16）は、時間ではなく計画に出る。
 */

interface Bench { rows: number; ms: number }

/** 3回まわして最小値を採る。1回だけだと GC や WASM の暖機が乗る。 */
async function bench(db: Db, sql: string, params: unknown[] = []): Promise<Bench> {
  let best = Infinity
  let rows = 0
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now()
    const r = await db.query(sql, params)
    const dt = performance.now() - t0
    if (dt < best) best = dt
    rows = r.rows.length
  }
  return { rows, ms: best }
}

/** n 人ぶんの応募と、途中まで進んだ評価を作る。 */
async function fill(db: Db, n: number) {
  const season = await one<{ id: string }>(db, `SELECT id FROM seasons`)
  const steps = await all<{ id: string; sort_order: number }>(
    db, `SELECT id, sort_order FROM selection_steps ORDER BY sort_order`)
  const schoolId = await scalar<string>(
    db, `INSERT INTO schools (name) VALUES ('架空高校') RETURNING id`)
  const staffId = await scalar<string>(db, `
    INSERT INTO staffs (display_name, email)
    VALUES ('架空 面接官', 'x@example.test') RETURNING id`)

  // 1行ずつ INSERT すると量が増えたときにテスト自体が遅くなる。
  // 集合で入れる。ここは計測対象ではない。
  await db.query(`
    INSERT INTO persons (family_name, given_name, birth_date, school_id, email)
    SELECT '架空', '候補' || g, DATE '2007-04-01', $1, 'p' || g || '@example.test'
      FROM generate_series(1, $2) g`, [schoolId, n])
  await db.query(`
    INSERT INTO applications (person_id, season_id, submitted_at)
    SELECT p.id, $1, TIMESTAMPTZ '2026-03-15 10:00+09' FROM persons p`, [season.id])
  // 半分は担当あり、半分は担当なし。運転席の両方の枝に載せる。
  await db.query(`
    INSERT INTO evaluations (application_id, selection_step_id, interviewer_staff_id, assigned_at)
    SELECT a.id, $1,
           CASE WHEN row_number() OVER (ORDER BY a.id) % 2 = 0
                THEN $2::uuid ELSE NULL END,
           now() - interval '20 days'
      FROM applications a`, [steps[1]!.id, staffId])
  return { seasonId: season.id }
}

describe('量に対する伸び方（絞り込みの有無を両方測る）', () => {
  test('やることの一覧は、人が3倍でも桁で跳ねない', async () => {
    const small = await freshDb({ seeds: 'production' })
    const { seasonId: s1 } = await fill(small, 100)
    const large = await freshDb({ seeds: 'production' })
    const { seasonId: s2 } = await fill(large, 300)

    // 絞り込み**なし**
    const allSmall = await bench(small, `SELECT * FROM v_open_tasks`)
    const allLarge = await bench(large, `SELECT * FROM v_open_tasks`)
    // 絞り込み**あり**（年度を1つ指定する。A-16 が爆発した形）
    const oneSmall = await bench(small, `SELECT * FROM v_open_tasks WHERE season_id = $1`, [s1])
    const oneLarge = await bench(large, `SELECT * FROM v_open_tasks WHERE season_id = $1`, [s2])

    assert.equal(allSmall.rows, 100, '100人ぶんのやることが出ていない')
    assert.equal(allLarge.rows, 300, '300人ぶんのやることが出ていない')
    assert.equal(oneSmall.rows, 100, '年度で絞ると件数が変わっている')
    assert.equal(oneLarge.rows, 300, '年度で絞ると件数が変わっている')

    // 3倍の量に対して、10倍を超えたら実行計画が変わったと見る。
    // 実測の秒数は残さない。残すのは「桁で跳ねないこと」だけ。
    const growAll = allLarge.ms / Math.max(allSmall.ms, 0.5)
    const growOne = oneLarge.ms / Math.max(oneSmall.ms, 0.5)
    assert.ok(growAll < 10, `絞り込みなしで ${growAll.toFixed(1)} 倍に伸びた（3倍の量に対して）`)
    assert.ok(growOne < 10, `絞り込みありで ${growOne.toFixed(1)} 倍に伸びた（3倍の量に対して）`)

    // **絞ったほうが遅い**という形そのものを見張る（A-16 はこれだった）。
    const penalty = oneLarge.ms / Math.max(allLarge.ms, 0.5)
    assert.ok(penalty < 5, `年度で絞ると ${penalty.toFixed(1)} 倍遅い。A-16 と同じ形`)

    await small.close()
    await large.close()
  })

  test('やることの実行計画に、行ごとに評価される関数が現れない', async () => {
    // 実行③で一覧が 444 秒かかった原因。時間ではなく計画に出る。
    const db = await freshDb({ seeds: 'production' })
    const { seasonId } = await fill(db, 100)
    const plan = (await all<{ 'QUERY PLAN': string }>(
      db, `EXPLAIN SELECT * FROM v_open_tasks WHERE season_id = $1`, [seasonId]))
      .map((r) => r['QUERY PLAN']).join('\n')

    assert.ok(!/Function Scan/.test(plan),
      `実行計画に Function Scan がある。集合を返す関数が結合の内側にいる:\n${plan}`)
    await db.close()
  })

  test('人の一覧は、直積のまま量に対して素直に伸びる', async () => {
    // v_person_season_state は persons × seasons の直積（実行③から持ち越し）。
    // いま問題にならないことを固定しておく。跳ねたらここが落ちる。
    const small = await freshDb({ seeds: 'production' })
    await fill(small, 100)
    const large = await freshDb({ seeds: 'production' })
    await fill(large, 300)

    const a = await bench(small, `SELECT * FROM v_person_season_state`)
    const b = await bench(large, `SELECT * FROM v_person_season_state`)
    const grow = b.ms / Math.max(a.ms, 0.5)
    assert.ok(grow < 10, `3倍の人数に対して ${grow.toFixed(1)} 倍に伸びた`)

    await small.close()
    await large.close()
  })
})

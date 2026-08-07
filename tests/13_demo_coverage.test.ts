import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { scalar, type Db } from '../src/db/client.ts'
import { seedDemo } from '../src/seed/demo.ts'

/**
 * デモデータが、検証したい経路を実際に踏んでいるか。
 *
 * これまでに3回繰り返した失敗がある ―― 画面に出しただけで検証したつもりに
 * なり、直した分岐がデモデータでは一度も実行されていなかった。
 * 「その形のデータが存在すること」を人が目で確かめる運用は必ず抜けるので、
 * 機械に確かめさせる。
 *
 * 数を固定しない。乱数の分布に依存する値をテストに書くと、
 * デモの規模を変えただけで落ちる。「1件以上あるか」だけを見る。
 */

let db: Db

before(async () => {
  db = await freshDb({ seeds: 'examples' })
  // 「今日」を固定する。既定の Date.now() だと、進行中の年度の見え方が
  // 実行日で変わり、何を確かめたのか読んで分からなくなる。
  await seedDemo(db, { asOf: '2026-08-06' })
})

after(async () => { await db.close() })

const count = (sql: string) => scalar<string>(db, sql).then(Number)

describe('デモデータが踏んでいる経路', () => {
  test('集計から外れる無効化応募に、評価と遷移がぶら下がっている', async () => {
    // 名寄せ誤りが選考の途中で判明する形。実データでは必ず起きる。
    // この形が無いと、個人画面が「集計に出ない応募」をどう扱うかを
    // 一度も実行しないまま「動いた」ことになる。
    assert.ok(await count(`
      SELECT count(*) FROM applications a
        JOIN void_reasons vr ON vr.id = a.void_reason_id
       WHERE NOT vr.counts_as_application
         AND EXISTS (SELECT 1 FROM evaluations e WHERE e.application_id = a.id)
         AND EXISTS (SELECT 1 FROM status_histories sh WHERE sh.application_id = a.id)`) >= 1,
      '評価と遷移を持つ「集計外の応募」が1件も無い')
  })

  test('同一年度に集計対象の応募が2件ある人がいる', async () => {
    // 取り下げて出し直した形（counts_as_application = true）。
    // 0007 で v_person_season_state を応募またぎの最高到達点に直した理由。
    assert.ok(await count(`
      SELECT count(*) FROM (
        SELECT person_id, season_id FROM v_application_state
         GROUP BY person_id, season_id HAVING count(*) > 1) t`) >= 1,
      '同一 Person × Season に集計対象応募が2件ある組が無い')
  })

  test('訂正の訂正まで入った応募がある', async () => {
    // 深さ2の行が有効に戻る経路（A-3）。
    assert.ok(await count(`
      SELECT count(DISTINCT c2.application_id)
        FROM status_histories c2
        JOIN status_histories c1 ON c1.id = c2.corrects_history_id
       WHERE c1.corrects_history_id IS NOT NULL`) >= 1,
      '訂正を訂正した応募が無い')
  })

  test('再応募して合格した人がいる', async () => {
    // 再応募者限定の評価軸（applies_to = 'reapplicant_only'）が
    // 実際にスコアを持つ経路。
    assert.ok(await count(`
      SELECT count(*) FROM v_application_state WHERE is_reapplication AND is_accepted`) >= 1)
    assert.ok(await count(`
      SELECT count(*) FROM evaluation_scores es
        JOIN evaluation_criteria ec ON ec.id = es.criteria_id
       WHERE ec.applies_to = 'reapplicant_only'`) >= 1,
      '再応募者限定の軸に一度もスコアが付いていない')
  })

  test('判断待ち・保留・担当未割当・利益相反がそろっている', async () => {
    // ダッシュボード(2)が数えるもの。どれかが0だと、その表示は
    // 一度も実データで確かめられていないことになる。
    assert.ok(await count(`SELECT count(*) FROM evaluations WHERE state = 'pending'`) >= 1)
    assert.ok(await count(`SELECT count(*) FROM evaluations WHERE state = 'held'`) >= 1)
    assert.ok(await count(`
      SELECT count(*) FROM evaluations
       WHERE interviewer_staff_id IS NULL AND state = 'pending'`) >= 1)
    assert.ok(await count(`SELECT count(*) FROM v_conflict_of_interest`) >= 1)
  })

  test('個人情報削除済みの Person がいて、接点だけが残っている', async () => {
    // 削除済みが集計から外れていることを画面で確かめるための種。
    assert.ok(await count(`SELECT count(*) FROM persons WHERE deleted_at IS NOT NULL`) >= 1)
    assert.ok(await count(`
      SELECT count(*) FROM touchpoints t
        JOIN persons p ON p.id = t.person_id
       WHERE p.deleted_at IS NOT NULL`) >= 1)
  })

  test('林の窓の外にいる人と、内にいる人が両方いる', async () => {
    // 個人画面が「林」を窓の内外で呼び分ける経路。
    // 片方しか無いと、呼び分けが効いているか分からない。
    const inside = await count(`
      SELECT count(*) FROM f_person_season_state(90) WHERE in_active_window`)
    const outside = await count(`
      SELECT count(*) FROM f_person_season_state(90) WHERE NOT in_active_window`)
    assert.ok(inside >= 1 && outside >= 1)
  })

  test('「今日」を渡さなくても、同じ日なら同じデータになる', async () => {
    // demo.ts は「何度流しても同じデータになる」と書いてある。乱数は固定
    // シードだが、既定の asOf が Date.now() だったため、地平線（すでに
    // 起きたことの締め）が実行の時刻ぶんだけ動いていた。
    // 実際 pnpm db:reset を数分あけて2回流したら、進行中の年度の
    // 判断待ちが 23 件と 26 件で食い違った。
    //
    // 記録が実装より厳密に見える形なので、既定値を JST の暦日に丸めた。
    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
    const [auto, fixed] = await Promise.all([
      freshDb({ seeds: 'examples' }).then(async (d) => [d, await seedDemo(d)] as const),
      freshDb({ seeds: 'examples' }).then(async (d) => [d, await seedDemo(d, { asOf: today })] as const),
    ])
    assert.deepEqual(auto[1], fixed[1])
    await auto[0].close()
    await fixed[0].close()
  })

  test('「数えるが、動いていない」応募に、判断待ちの評価が残っている', async () => {
    // 木には数えるのに選考は止まっている形（選考開始前の取り下げ）。
    // 評価行はステップ到達時に生成済みなので pending のまま残り、
    // 判断待ちの母集団を v_countable_applications にしていると催促され続ける。
    // A-14 で直した分岐が、デモで実際に踏まれていることを固定する。
    const stranded = await count(`
      SELECT count(*) FROM evaluations e
        JOIN v_countable_applications a ON a.id = e.application_id
       WHERE e.state = 'pending' AND a.voided_at IS NOT NULL`)
    assert.ok(stranded >= 1, '「数えるが、動いていない」応募に判断待ちが残る形が必要')

    const active = await count(`
      SELECT count(*) FROM evaluations e
        JOIN v_active_applications a ON a.id = e.application_id
       WHERE e.state = 'pending' AND a.voided_at IS NOT NULL`)
    assert.equal(active, 0, 'その評価は「いま動いている応募」には入らない')
  })

  test('デモの出来事が、年度の期間より前に起きていない', async () => {
    // demo.ts の at() は「JST の指定日の指定時刻」と書いてある。
    // 実際は JST 深夜の UTC 日付が前日になるため、指定日の1日前を返していた。
    // 応募は at(applicationOpen, 0, ...) から作られるので、
    // 最初の応募が応募開始日より前に発生する。
    //
    // ファネルは応募開始日より前の出来事を初日に寄せる（0004 の clamped）ため、
    // 集計値としては辻褄が合ってしまい、この形が表に出なかった。
    // 丸め込みが欠陥を隠すのは、実行②の「表示の丸めで注記が嘘になった」と同じ。
    const early = await count(`
      SELECT count(*) FROM applications a
        JOIN seasons se ON se.id = a.season_id
       WHERE jst_date(a.submitted_at) < se.application_open_date`)
    assert.equal(early, 0, '応募開始日より前の応募は作らない')

    const earlyTouch = await count(`
      SELECT count(*) FROM touchpoints t
       WHERE jst_date(t.occurred_at) < (SELECT min(outreach_start_date) FROM seasons)`)
    assert.equal(earlyTouch, 0, '最初の集客開始日より前の接点は作らない')
  })

  test('団体経由の接点と、年度に紐づかない接点がある', async () => {
    assert.ok(await count(`SELECT count(*) FROM touchpoints WHERE partner_id IS NOT NULL`) >= 1)
    assert.ok(await count(`
      SELECT count(*) FROM v_touchpoint_season WHERE season_id IS NULL`) >= 1)
  })

  // -----------------------------------------------------------
  // 0012（森と、いまやること）が足した経路
  // -----------------------------------------------------------

  test('森と林の両方があり、接点がその両方に付いている', async () => {
    // 林に接点が付く形が無いと、v_partner_forest が森へ畳んでいるかを
    // 一度も確かめられない。森直付けだけのデータでは畳む処理が空回りする。
    assert.ok(await count(`SELECT count(*) FROM v_forests`) >= 1)
    assert.ok(await count(`SELECT count(*) FROM v_communities`) >= 1)
    assert.ok(await count(`
      SELECT count(*) FROM touchpoints t
        JOIN v_communities c ON c.community_id = t.partner_id`) >= 1,
      '林に付いた接点が1件も無い')
    assert.ok(await count(`
      SELECT count(*) FROM touchpoints t
        JOIN v_forests f ON f.forest_id = t.partner_id`) >= 1,
      '森に直付けの接点が1件も無い')
  })

  test('要注意の3つの形が、それぞれ1つ以上ある', async () => {
    // 接点なし・休眠・滞留。旗の立て方は事実そのままなので、
    // その事実がデモに無ければ、コックピットの表示は一度も確かめられない。
    assert.ok(await count(`
      SELECT count(*) FROM v_forest_activity WHERE days_since_touch IS NULL`) >= 1,
      '接点が1件も無い森が必要（リーチだけの森）')
    assert.ok(await count(`
      SELECT count(*) FROM v_forest_activity WHERE days_since_touch >= 60`) >= 1,
      '休眠した森が必要')
    assert.ok(await count(`
      SELECT count(*) FROM v_forest_season_activity WHERE overdue_tasks >= 1`) >= 1,
      '期限を超えたやることを抱えた森が必要')
  })

  test('推定リーチだけの森と、接点だけの森が両方ある', async () => {
    // この2つの列を割って「識別率」にしてはならない（domain.md 8節）。
    // 片方が NULL になる形を残しておくと、割った瞬間に破綻して気づける。
    assert.ok(await count(`
      SELECT count(*) FROM v_forest_activity
       WHERE estimated_reach IS NOT NULL AND persons_touched = 0`) >= 1)
    assert.ok(await count(`
      SELECT count(*) FROM v_forest_activity
       WHERE estimated_reach IS NULL AND persons_touched >= 1`) >= 1)
  })

  test('やることの4種すべてに、実際の行がある', async () => {
    // 'reassign' は判断がまだ下りていない利益相反だけを出す。実測すると
    // 乱数で生まれた利益相反は3件すべて submitted で、この分岐は一度も
    // 踏まれていなかった。同時に、判断待ちから利益相反を除いている側
    // （'evaluate' の NOT EXISTS）も一度も効いていなかった。
    const kinds = await db.query<{ kind: string }>(
      `SELECT DISTINCT kind FROM v_open_tasks ORDER BY kind`)
    assert.deepEqual(kinds.rows.map((r) => r.kind).sort(),
      ['assign', 'evaluate', 'reassign', 'unhold'])
  })

  test('期限を超えたやることがあり、超えていないものもある', async () => {
    assert.ok(await count(`SELECT count(*) FROM v_open_tasks WHERE is_overdue`) >= 1)
    assert.ok(await count(`SELECT count(*) FROM v_open_tasks WHERE NOT is_overdue`) >= 1)
  })

  test('1つの評価が、2件のやることに出ていない', async () => {
    // 同じ評価が2種類のタスクとして並ぶと、件数が二重に見える。
    // 0012 で 'evaluate' から利益相反を除いたが、'unhold' に同じ手当てを
    // 忘れており、保留＋利益相反で2行になっていた（0013 で直した）。
    // 種別ごとの条件を足すたびに壊れうるので、ビュー全体の性質として固定する。
    const dup = await db.query<{ source_id: string; kinds: string }>(`
      SELECT source_id, string_agg(kind, ',' ORDER BY kind) AS kinds
        FROM v_open_tasks GROUP BY source_id HAVING count(*) > 1`)
    assert.deepEqual(dup.rows, [], '1つの評価が複数のやることに出ている')
  })

  test('1人で複数のやることを持つ形がある（件と人が一致しない）', async () => {
    // 件数と人数を同じ数として扱っていないかは、両者が違う日にしか
    // 確かめられない。常に一致するデータでは混同していても気づけない。
    const tasks = await count(`SELECT count(*) FROM v_open_tasks`)
    const persons = await count(`SELECT count(DISTINCT person_id) FROM v_open_tasks`)
    assert.ok(tasks > persons, `やること ${tasks} 件・人 ${persons} 人。1人が複数持つ形が無い`)
  })
})

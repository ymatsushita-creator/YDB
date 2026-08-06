import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { all, one, scalar, type Db } from '../src/db/client.ts'
import {
  baseFixture, makeSeason, makePerson, makeApplication, addHistory, accept,
  makeChannel, makeTouchpoint, makeVoidReason, voidApplication,
  unconfirmedWithdrawReason, jst,
} from './support/fixtures.ts'

/**
 * 定義との食い違いを塞いだ分（0007 / 0008）と、
 * DECISIONS B 節のうちテストが無かった制約。
 *
 * B 節の表には「この制約を固定しているテスト」の列がある。
 * ここのテスト名はその列と一字一句そろえてある。ずれると、
 * 記録が実装より厳密であるかのように見える状態がまた戻る。
 */

const setup = async () => {
  const db = await freshDb()
  const base = await baseFixture(db)
  const season = await makeSeason(db, { year: 2026 })
  return { ...base, season }
}

// -------------------------------------------------------------
// 0007: 定義との食い違い
// -------------------------------------------------------------

describe('年度別の現在地は Person × Season で必ず1行', () => {
  test('取り下げて出し直した人でも1行しか出ない', async () => {
    // A-2 で同一年度に集計対象の応募が2件ありうるようになった。
    // 結合が 1:1 のままだと、同じ人が「木」と「幹」の2行で現れる。
    const { db, schoolId, staffId, season } = await setup()
    const p = await makePerson(db, schoolId, { createdAt: jst('2025-10-01T10:00:00') })

    const first = await makeApplication(db, p, season.id, jst('2025-11-02T10:00:00'))
    const counts = await makeVoidReason(db, 'withdrawn_before_screening', true)
    await voidApplication(db, first, counts, jst('2025-11-03T10:00:00'))

    const second = await makeApplication(db, p, season.id, jst('2025-11-10T10:00:00'))
    await accept(db, {
      applicationId: second, season, staffId, occurredAt: jst('2025-12-20T10:00:00'),
    })

    // 無効化された1件目も counts_as_application なので集計対象に残る
    assert.equal(
      Number(await scalar(db,
        `SELECT count(*) FROM v_application_state WHERE person_id = $1`, [p])),
      2, '集計対象の応募は2件ある（この前提が崩れるとテストの意味が変わる）',
    )

    const rows = await all<{ current_level: string }>(
      db, `SELECT current_level FROM v_person_season_state
            WHERE person_id = $1 AND season_id = $2`, [p, season.id])
    assert.equal(rows.length, 1, 'Person × Season で1行')
    assert.equal(rows[0]!.current_level, 'accepted', '年度内の最高到達点を採る')
    await db.close()
  })

  test('どの Person も年度ごとに1行しか持たない', async () => {
    const { db, schoolId, staffId, season } = await setup()
    for (let i = 0; i < 5; i++) {
      const p = await makePerson(db, schoolId, { createdAt: jst('2025-10-01T10:00:00') })
      const a = await makeApplication(db, p, season.id, jst('2025-11-05T10:00:00'))
      if (i % 2 === 0) {
        const r = await makeVoidReason(db, `reason_${i}`, true)
        await voidApplication(db, a, r, jst('2025-11-06T10:00:00'))
        const b = await makeApplication(db, p, season.id, jst('2025-11-20T10:00:00'))
        await addHistory(db, {
          applicationId: b, type: 'reject', staffId, occurredAt: jst('2025-12-01T10:00:00'),
        })
      }
    }
    const dupes = await all(db, `
      SELECT person_id, season_id FROM v_person_season_state
       GROUP BY person_id, season_id HAVING count(*) > 1`)
    assert.deepEqual(dupes, [], '重複した (person, season) は無い')
    await db.close()
  })
})

describe('訂正は同じ応募の中でしか行えない', () => {
  test('別の応募の記録を打ち消せない', async () => {
    const { db, schoolId, staffId, season } = await setup()
    const appX = await makeApplication(
      db, await makePerson(db, schoolId), season.id, jst('2025-11-05T10:00:00'))
    const appY = await makeApplication(
      db, await makePerson(db, schoolId), season.id, jst('2025-11-06T10:00:00'))

    const accepted = await accept(db, {
      applicationId: appX, season, staffId, occurredAt: jst('2025-12-01T10:00:00'),
    })

    await assert.rejects(
      () => addHistory(db, {
        applicationId: appY, type: 'reject', staffId,
        occurredAt: jst('2025-12-02T10:00:00'), correctsHistoryId: accepted,
      }),
      /correction crosses applications/,
    )

    // 打ち消せていないので合格は残る
    assert.equal(
      await scalar(db, `SELECT is_accepted FROM v_application_state WHERE application_id = $1`,
        [appX]), true)
    await db.close()
  })
})

describe('選考ステップは応募の年度のものに限る', () => {
  test('他年度のステップを指す遷移は作れない', async () => {
    const db = await freshDb()
    const base = await baseFixture(db)
    const s2026 = await makeSeason(db, { year: 2026 })
    const s2027 = await makeSeason(db, { year: 2027 })
    const app = await makeApplication(
      db, await makePerson(db, base.schoolId), s2026.id, jst('2025-11-05T10:00:00'))

    await assert.rejects(
      () => addHistory(db, {
        applicationId: app, type: 'advance', stepId: s2027.finalStepId,
        staffId: base.staffId, occurredAt: jst('2025-12-01T10:00:00'),
      }),
      /selection step belongs to season/,
    )
    await db.close()
  })

  test('他年度のステップを指す評価は作れない', async () => {
    const db = await freshDb()
    const base = await baseFixture(db)
    const s2026 = await makeSeason(db, { year: 2026 })
    const s2027 = await makeSeason(db, { year: 2027 })
    const app = await makeApplication(
      db, await makePerson(db, base.schoolId), s2026.id, jst('2025-11-05T10:00:00'))

    await assert.rejects(
      () => db.query(
        `INSERT INTO evaluations (application_id, selection_step_id) VALUES ($1, $2)`,
        [app, s2027.stepIds[0]]),
      /selection step belongs to season/,
    )
    await db.close()
  })
})

// -------------------------------------------------------------
// 0008 と本番の参照データ
// -------------------------------------------------------------

describe('辞退理由', () => {
  test('理由のない辞退は記録できない', async () => {
    // NULL を許すと「未記録」と「本当に理由がない」が集計上区別できない。
    const { db, schoolId, staffId, season } = await setup()
    const app = await makeApplication(
      db, await makePerson(db, schoolId), season.id, jst('2025-11-05T10:00:00'))

    await assert.rejects(
      () => db.query(
        `INSERT INTO status_histories
           (application_id, transition_type, occurred_at, changed_by_staff_id)
         VALUES ($1, 'withdraw', $2, $3)`,
        [app, jst('2025-12-01T10:00:00'), staffId]),
      /withdraw_reason_required/,
    )
    await db.close()
  })

  test('理由が分からないときは「未確認」を選ぶ', async () => {
    const { db, schoolId, staffId, season } = await setup()
    const app = await makeApplication(
      db, await makePerson(db, schoolId), season.id, jst('2025-11-05T10:00:00'))
    const unconfirmed = await unconfirmedWithdrawReason(db)

    await addHistory(db, {
      applicationId: app, type: 'withdraw', staffId,
      occurredAt: jst('2025-12-01T10:00:00'), withdrawReasonId: unconfirmed,
    })

    const row = await one<{ label: string; count: number }>(db, `
      SELECT wr.label, count(DISTINCT sh.application_id) AS count
        FROM v_effective_status_histories sh
        JOIN withdraw_reasons wr ON wr.id = sh.withdraw_reason_id
       WHERE sh.transition_type = 'withdraw' GROUP BY wr.label`)
    assert.equal(row.label, '未確認', '分布から消えず、未確認として数えられる')
    await db.close()
  })

  test('辞退以外の遷移に理由は付けられない', async () => {
    const { db, schoolId, staffId, season } = await setup()
    const app = await makeApplication(
      db, await makePerson(db, schoolId), season.id, jst('2025-11-05T10:00:00'))
    const unconfirmed = await unconfirmedWithdrawReason(db)
    await assert.rejects(
      () => addHistory(db, {
        applicationId: app, type: 'reject', staffId,
        occurredAt: jst('2025-12-01T10:00:00'), withdrawReasonId: unconfirmed,
      }),
      /status_histories_withdraw_reason/,
    )
    await db.close()
  })
})

describe('本番の参照データ', () => {
  test('確定していないマスタは1行も入らない', async () => {
    // 集計に関わるマスタは追加と非活性化でしか運用できない（原則3）。
    // 最初に入った値が事実上の初期値として固定化されるため、
    // 分類が決まるまで仮の値を入れない。
    const db = await freshDb({ seeds: 'production' })
    const counts = await one<Record<string, number>>(db, `
      SELECT (SELECT count(*) FROM channels)         AS channels,
             (SELECT count(*) FROM void_reasons)     AS void_reasons,
             (SELECT count(*) FROM withdraw_reasons) AS withdraw_reasons`)
    assert.deepEqual(
      Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Number(v)])),
      { channels: 0, void_reasons: 0, withdraw_reasons: 1 },
    )
    await db.close()
  })

  test('本番に入る唯一の辞退理由は「未確認」', async () => {
    // 0008 で辞退理由を必須にしたので、受け皿が無いと辞退が記録できない。
    const db = await freshDb({ seeds: 'production' })
    const row = await one<{ code: string; label: string; is_active: boolean }>(
      db, `SELECT code, label, is_active FROM withdraw_reasons`)
    assert.deepEqual(row, { code: 'unconfirmed', label: '未確認', is_active: true })
    await db.close()
  })

  test('サンプルの参照データは本番のシードに混ざらない', async () => {
    const production = await freshDb({ seeds: 'production' })
    const examples = await freshDb({ seeds: 'examples' })
    const n = (db: Db) => scalar<string>(db, `SELECT count(*) FROM channels`)
    assert.equal(Number(await n(production)), 0)
    assert.ok(Number(await n(examples)) > 0, 'サンプルを明示したときだけ入る')
    await production.close()
    await examples.close()
  })
})

// -------------------------------------------------------------
// 年度サマリ指標
// -------------------------------------------------------------

describe('年度の林→木転換率', () => {
  const conversion = (db: Db, seasonId: string) =>
    one<{
      reached_persons: number; applied_persons: number; is_final: boolean
    }>(db, `
      SELECT
        (SELECT count(DISTINCT t.person_id) FROM touchpoints t
           JOIN persons p ON p.id = t.person_id AND p.deleted_at IS NULL
          WHERE jst_date(t.occurred_at)
                BETWEEN s.outreach_start_date AND s.application_close_date
            AND jst_date(t.occurred_at) <= jst_today())      AS reached_persons,
        (SELECT count(DISTINCT a.person_id) FROM v_application_state a
          WHERE a.season_id = s.id
            AND jst_date(a.submitted_at) <= jst_today())     AS applied_persons,
        (jst_today() > s.selection_end_date)                 AS is_final
        FROM seasons s WHERE s.id = $1`, [seasonId])

  test('分母は募集期間中に一度でも接点があった実人数', async () => {
    // ローリングウィンドウではないので、窓の幅に依存しない。
    const db = await freshDb()
    const base = await baseFixture(db)
    const season = await makeSeason(db, {
      year: 2026, outreachStart: '2025-09-01', applicationOpen: '2025-11-01',
      applicationClose: '2025-12-15', selectionEnd: '2026-02-28',
    })
    const ch = await makeChannel(db, 'イベント')

    // 募集期間の頭に1回だけ接点。90日ローリングなら締切時点では窓の外。
    const early = await makePerson(db, base.schoolId, { createdAt: jst('2025-09-02T10:00:00') })
    await makeTouchpoint(db, early, ch, jst('2025-09-02T10:00:00'))
    // 締切直前に接点
    const late = await makePerson(db, base.schoolId, { createdAt: jst('2025-12-10T10:00:00') })
    await makeTouchpoint(db, late, ch, jst('2025-12-10T10:00:00'))
    // 募集期間の外（締切後）の接点だけの人は数えない
    const after = await makePerson(db, base.schoolId, { createdAt: jst('2025-12-20T10:00:00') })
    await makeTouchpoint(db, after, ch, jst('2025-12-20T10:00:00'))

    await makeApplication(db, early, season.id, jst('2025-11-05T09:00:00'))

    const c = await conversion(db, season.id)
    assert.equal(Number(c.reached_persons), 2, '募集期間内に接点がある2人')
    assert.equal(Number(c.applied_persons), 1)
    await db.close()
  })

  test('接点の回数ではなく実人数で数える', async () => {
    const db = await freshDb()
    const base = await baseFixture(db)
    const season = await makeSeason(db, { year: 2026 })
    const ch = await makeChannel(db, 'イベント')
    const p = await makePerson(db, base.schoolId, { createdAt: jst('2025-09-05T10:00:00') })
    for (let i = 0; i < 5; i++) {
      await makeTouchpoint(db, p, ch, jst(`2025-09-${String(10 + i).padStart(2, '0')}T10:00:00`))
    }
    const c = await conversion(db, season.id)
    assert.equal(Number(c.reached_persons), 1)
    await db.close()
  })

  test('削除済み Person は分母から外れる', async () => {
    const db = await freshDb()
    const base = await baseFixture(db)
    const season = await makeSeason(db, { year: 2026 })
    const ch = await makeChannel(db, 'イベント')
    const p = await makePerson(db, base.schoolId, { createdAt: jst('2025-09-05T10:00:00') })
    await makeTouchpoint(db, p, ch, jst('2025-09-10T10:00:00'))
    await db.query(`UPDATE persons SET deleted_at = now() WHERE id = $1`, [p])
    assert.equal(Number((await conversion(db, season.id)).reached_persons), 0)
    await db.close()
  })

  test('選考完了日を過ぎるまでは暫定', async () => {
    const db = await freshDb()
    await baseFixture(db)
    // 今日（2026-08-06 想定）より後に選考が終わる年度
    const live = await makeSeason(db, {
      year: 2099, outreachStart: '2098-04-01', applicationOpen: '2098-07-01',
      applicationClose: '2098-08-31', selectionEnd: '2098-11-30',
    })
    const done = await makeSeason(db, { year: 2020 })

    assert.equal((await conversion(db, live.id)).is_final, false, '未来の年度は暫定')
    assert.equal((await conversion(db, done.id)).is_final, true, '終わった年度は確定')
    await db.close()
  })
})

// -------------------------------------------------------------
// B 節でテストが無かった制約
// -------------------------------------------------------------

describe('B節の制約', () => {
  const rejects = (db: Db, sql: string, params: unknown[], match: RegExp) =>
    assert.rejects(() => db.query(sql, params), match)

  test('試行回数は1以上', async () => {
    const { db, schoolId, season } = await setup()
    const app = await makeApplication(
      db, await makePerson(db, schoolId), season.id, jst('2025-11-05T10:00:00'))
    await rejects(db,
      `INSERT INTO evaluations (application_id, selection_step_id, attempt)
       VALUES ($1, $2, 0)`, [app, season.stepIds[0]], /attempt_positive/)
    await db.close()
  })

  test('選考ステップの順序は正の整数', async () => {
    // 「いちばん大きい sort_order が最終ステップ」という定義が
    // 成り立つ前提。0 や負値が混じると順序の意味が壊れる。
    const { db, season } = await setup()
    const seasonId = await scalar<string>(
      db, `SELECT season_id FROM selection_steps WHERE id = $1`, [season.stepIds[0]])
    await rejects(db,
      `INSERT INTO selection_steps (season_id, sort_order, name) VALUES ($1, 0, 'ゼロ')`,
      [seasonId], /order_positive/)
    await rejects(db,
      `INSERT INTO selection_steps (season_id, sort_order, name) VALUES ($1, -1, '負')`,
      [seasonId], /order_positive/)
    await db.close()
  })

  test('SLA は0日にできない', async () => {
    // 0日だと割り当てた瞬間に超過となり、滞留一覧が全件警告で埋まる。
    const { db, season } = await setup()
    const seasonId = await scalar<string>(
      db, `SELECT season_id FROM selection_steps WHERE id = $1`, [season.stepIds[0]])
    await rejects(db,
      `INSERT INTO selection_steps (season_id, sort_order, name, sla_days)
       VALUES ($1, 9, '即日', 0)`, [seasonId], /sla_positive/)
    await db.close()
  })

  test('評価軸の満点は1以上', async () => {
    const { db, season } = await setup()
    await rejects(db,
      `INSERT INTO evaluation_criteria (selection_step_id, name, scale_max, sort_order)
       VALUES ($1, 'ゼロ点満点', 0, 1)`, [season.stepIds[0]], /scale_positive/)
    await db.close()
  })

  test('評価スコアは負にできない', async () => {
    const { db, schoolId, staffId, season } = await setup()
    const app = await makeApplication(
      db, await makePerson(db, schoolId), season.id, jst('2025-11-05T10:00:00'))
    const crit = await scalar<string>(db,
      `INSERT INTO evaluation_criteria (selection_step_id, name, scale_max, sort_order)
       VALUES ($1, '主体性', 5, 1) RETURNING id`, [season.stepIds[0]])
    const ev = await scalar<string>(db,
      `INSERT INTO evaluations (application_id, selection_step_id, interviewer_staff_id)
       VALUES ($1, $2, $3) RETURNING id`, [app, season.stepIds[0], staffId])
    await rejects(db,
      `INSERT INTO evaluation_scores (evaluation_id, criteria_id, score, rationale)
       VALUES ($1, $2, -1, '根拠')`, [ev, crit], /score_lower/)
    await db.close()
  })

  test('スコアリング規則のパラメータ', async () => {
    const { db, staffId } = await setup()
    const set = await scalar<string>(db,
      `INSERT INTO scoring_rule_sets (version, created_by_staff_id)
       VALUES (1, $1) RETURNING id`, [staffId])

    // 半減期0は減衰の定義がゼロ除算になる
    await rejects(db,
      `INSERT INTO scoring_rules
         (rule_set_id, condition_type, target_key, points, sort_order, decay_half_life_days)
       VALUES ($1, 'existence', 'x', 1, 1, 0)`, [set], /half_life_positive/)

    // 閾値のない count_threshold は条件として成立しない
    await rejects(db,
      `INSERT INTO scoring_rules
         (rule_set_id, condition_type, target_key, points, sort_order)
       VALUES ($1, 'count_threshold', 'x', 1, 2)`, [set], /threshold_required/)

    // existence は閾値なしでよい
    await db.query(
      `INSERT INTO scoring_rules
         (rule_set_id, condition_type, target_key, points, sort_order)
       VALUES ($1, 'existence', 'x', 1, 3)`, [set])
    await db.close()
  })

  test('推定リーチは負にならない', async () => {
    const { db } = await setup()
    const partner = await scalar<string>(
      db, `INSERT INTO partners (name) VALUES ('NPO') RETURNING id`)
    await rejects(db,
      `INSERT INTO partner_reaches (partner_id, occurred_on, estimated_reach)
       VALUES ($1, '2025-10-01', -1)`, [partner], /estimate_non_negative/)
    await db.close()
  })

  test('団体との関係の期間は逆転しない', async () => {
    const { db } = await setup()
    const partner = await scalar<string>(
      db, `INSERT INTO partners (name) VALUES ('NPO') RETURNING id`)
    await rejects(db,
      `INSERT INTO partner_relations (partner_id, relation_type, started_on, ended_on)
       VALUES ($1, 'referral', '2025-10-01', '2025-09-01')`, [partner], /relations_period/)
    await db.close()
  })
})

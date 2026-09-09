import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { scalar, type Db } from '../src/db/client.ts'
import { makeSeason, makePerson, baseFixture, makeApplication } from './support/fixtures.ts'
import { addKpi, reviseKpi } from '../src/commands/kpi.ts'
import { listKpis } from '../src/queries/kpi.ts'
import { listKpiMetrics, countKpiMetric } from '../src/queries/kpi_metrics.ts'

/**
 * KPIの変数は、記録に繋がる（0049。C-199。依頼者の指摘）。
 *
 * 依頼者の言葉 ――「変数ってお前何のことか理解してんの？
 *   それを選択したら、グラフにも反映されるんだぞ？」。
 *
 * 固定したいのは4つ ――
 *   ① 選べる語は**数えられるものだけ**（マスタにある語だけ）
 *   ② 知らない語は入らない
 *   ③ ★ 選んだ変数の実績が、**記録から数えられる**
 *   ④ 変数を選ばないKPIも作れる（目標だけ。実績は null で、0 と書かない）
 */

describe('KPIの変数（C-199）', () => {
  let db: Db
  let seasonId: string

  before(async () => {
    db = await freshDb({ seeds: 'production' })
    const base = await baseFixture(db)
    const season = await makeSeason(db, { year: 2031 })
    seasonId = season.id
    const p = await makePerson(db, base.schoolId, { familyName: '架空', givenName: '指標' })
    await makeApplication(db, p, seasonId, '2030-11-05T10:00:00+09:00')
  })

  after(async () => { await db.close() })

  test('選べる語は、数えられるものだけ', async () => {
    const metrics = await listKpiMetrics(db)
    assert.ok(metrics.length >= 6)
    for (const m of metrics) {
      // ★ 語ごとに数え方がある。無ければ画面に出してはいけない。
      assert.notEqual(await countKpiMetric(db, m.key, seasonId), null,
        `${m.key} の数え方が無い（選ばせてはいけない）`)
    }
  })

  test('★ 知らない語は入らない', async () => {
    const r = await addKpi(db, {
      seasonId, title: '架空', variable: '―', value: '10', memo: '',
      metricKey: 'nonexistent_metric',
    })
    assert.equal(r.ok, false)
    assert.equal(!r.ok && r.reason, 'bad_metric')
  })

  test('★ 選んだ変数の実績が、記録から数えられる', async () => {
    const r = await addKpi(db, {
      seasonId, title: '応募の目標', variable: '―', value: '5', memo: '',
      metricKey: 'applicants',
    })
    assert.equal(r.ok, true)
    const rows = await listKpis(db, seasonId)
    const kpi = rows.find((k) => k.title === '応募の目標')!
    assert.equal(kpi.metric_key, 'applicants', '変数が残っていない')

    const actual = await countKpiMetric(db, kpi.metric_key, seasonId)
    const real = Number(await scalar(db, `
      SELECT count(*) FROM applications
       WHERE season_id = $1 AND voided_at IS NULL AND deleted_at IS NULL`, [seasonId]))
    assert.equal(actual, real, '画面の数え方と記録が食い違っている')
  })

  test('変数を選ばないKPIも作れる（実績は 0 ではなく「無い」）', async () => {
    const r = await addKpi(db, {
      seasonId, title: '目標だけ', variable: '―', value: '3', memo: '', metricKey: '',
    })
    assert.equal(r.ok, true)
    const kpi = (await listKpis(db, seasonId)).find((k) => k.title === '目標だけ')!
    assert.equal(kpi.metric_key, null)
    assert.equal(await countKpiMetric(db, kpi.metric_key, seasonId), null,
      '数えられないものを 0 と書いている')
  })

  test('変数は書き換えられ、履歴に残る', async () => {
    const made = await addKpi(db, {
      seasonId, title: '差し替え', variable: '―', value: '9', memo: '', metricKey: 'partners',
    })
    assert.equal(made.ok, true)
    if (!made.ok) throw new Error('unreachable')
    const r = await reviseKpi(db, {
      kpiId: made.id, seasonId, title: '差し替え', variable: '―', value: '9', memo: '',
      metricKey: 'touchpoints',
    })
    assert.equal(r.ok, true)
    const versions = Number(await scalar(db, `
      SELECT count(*) FROM kpi_revisions WHERE kpi_id = $1`, [made.id]))
    assert.equal(versions, 2, '書き換えが履歴に積まれていない')
  })
})

// -------------------------------------------------------------
// イベント参加人数（R7・2026-09 改修）
//
// 依頼者の指摘 ――「アワード参加人数との連携も欲しい。俺が見た限りでは
// 連携できていなかったはず」。事実だった。`touchpoints` は**全接点**を数え、
// イベント参加者を人数として区別しない。数えられない語は選ばせない規則
// （① の検査）に従い、語と数え方を対で足す。
//
// ここで固定するのは、語が在ることではなく **同じ予定の同じ人が二重に
// 数えられないこと**。重複排除は `event_attendances` の一意制約が持つ。
// -------------------------------------------------------------

describe('イベント参加人数のKPI（R7）', () => {
  let db: Db
  let seasonId: string
  let schoolId: string

  before(async () => {
    db = await freshDb({ seeds: 'production' })
    const base = await baseFixture(db)
    schoolId = base.schoolId
    const season = await makeSeason(db, { year: 2032 })
    seasonId = season.id
  })

  after(async () => { await db.close() })

  const makeEvent = (title: string, day: string) => scalar<string>(db, `
    INSERT INTO appointments (season_id, kind_id, title, starts_at, ends_at)
    SELECT $1, k.id, $2, ($3 || ' 13:00+09')::timestamptz, ($3 || ' 17:00+09')::timestamptz
      FROM appointment_kinds k WHERE k.code = 'event'
    RETURNING id`, [seasonId, title, day])

  const attend = async (appointmentId: string, personId: string, at: string) => {
    const tp = await scalar<string>(db, `
      INSERT INTO touchpoints (person_id, channel_id, occurred_at)
      SELECT $1, c.id, $2::timestamptz FROM channels c ORDER BY c.name LIMIT 1
      RETURNING id`, [personId, at])
    await db.query(`
      INSERT INTO event_attendances (appointment_id, person_id, touchpoint_id)
      VALUES ($1, $2, $3)`, [appointmentId, personId, tp])
  }

  test('語が在り、数え方が対で存在する', async () => {
    const metrics = await listKpiMetrics(db)
    const m = metrics.find((x) => x.key === 'event_attendees')
    assert.ok(m, 'イベント参加人数が選べる語として在る')
    assert.equal(m!.unit, '人')
    assert.notEqual(await countKpiMetric(db, 'event_attendees', seasonId), null,
      '数え方が無い語を選ばせてはいけない')
  })

  test('★ 同じ予定の同じ人は二重に数えない。別の予定なら別に数える', async () => {
    const award = await makeEvent('NEO AWARD 2032', '2032-03-10')
    const briefing = await makeEvent('説明会 2032', '2032-04-05')
    // 氏名は既定値のまま使う（テスト内に氏名リテラルを置かない）
    const a = await makePerson(db, schoolId)
    const b = await makePerson(db, schoolId)

    await attend(award, a, '2032-03-10T13:00:00+09:00')
    await attend(award, b, '2032-03-10T13:00:00+09:00')
    assert.equal(await countKpiMetric(db, 'event_attendees', seasonId), 2)

    // 同じ予定に同じ人をもう一度入れられないこと自体が重複排除の実体
    await assert.rejects(
      () => attend(award, a, '2032-03-10T13:00:00+09:00'),
      '同じ予定×同じ人は2行目を作れない',
    )
    assert.equal(await countKpiMetric(db, 'event_attendees', seasonId), 2,
      '押し直しても人数は増えない')

    await attend(briefing, a, '2032-04-05T13:00:00+09:00')
    assert.equal(await countKpiMetric(db, 'event_attendees', seasonId), 3,
      '別の予定への参加は別に数える')
  })

  test('接点の総数とは別物である（連携できていなかった箇所）', async () => {
    const touchpoints = await countKpiMetric(db, 'touchpoints', seasonId)
    const attendees = await countKpiMetric(db, 'event_attendees', seasonId)
    assert.notEqual(touchpoints, attendees,
      'イベント参加人数を接点総数で代用できない。代用できるなら語を足す意味が無い')
  })
})

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

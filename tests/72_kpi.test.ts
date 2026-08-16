import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { scalar } from '../src/db/client.ts'
import { makeSeason } from './support/fixtures.ts'
import { addKpi, archiveKpi, reviseKpi } from '../src/commands/kpi.ts'
import { listKpis } from '../src/queries/kpi.ts'

describe('期ごとのKPI（0047）', () => {
  test('追加・編集は改訂を残し、アーカイブは運用一覧からだけ外す', async () => {
    const db = await freshDb()
    const season = await makeSeason(db, { year: 2030 })
    const added = await addKpi(db, {
      seasonId: season.id, title: '説明会', variable: '参加者', value: '12', memo: '初回',
    })
    assert.equal(added.ok, true)
    if (!added.ok) return
    assert.equal((await listKpis(db, season.id))[0]!.value, '12')

    assert.equal((await reviseKpi(db, {
      kpiId: added.id, seasonId: season.id, title: '説明会', variable: '参加者',
      value: '18.5', memo: '更新',
    })).ok, true)
    assert.equal((await listKpis(db, season.id))[0]!.value, '18.5')
    assert.equal(await scalar<number>(db,
      `SELECT count(*)::int FROM kpi_revisions WHERE kpi_id = $1`, [added.id]), 2)

    assert.equal((await archiveKpi(db, added.id, season.id)).ok, true)
    assert.equal((await listKpis(db, season.id)).length, 0)
    assert.equal((await listKpis(db, season.id, true)).length, 1)
    assert.equal(await scalar<number>(db,
      `SELECT count(*)::int FROM kpi_revisions WHERE kpi_id = $1`, [added.id]), 3)
  })

  test('別の期から編集できず、空題名と数でない値を拒む', async () => {
    const db = await freshDb()
    const a = await makeSeason(db, { year: 2031 })
    const b = await makeSeason(db, { year: 2032 })
    const added = await addKpi(db, {
      seasonId: a.id, title: '応募', variable: '件', value: '10', memo: '',
    })
    assert.equal(added.ok, true)
    if (!added.ok) return
    assert.deepEqual(await reviseKpi(db, {
      kpiId: added.id, seasonId: b.id, title: '応募', variable: '件', value: '11', memo: '',
    }), { ok: false, reason: 'bad_kpi' })
    assert.deepEqual(await addKpi(db, {
      seasonId: a.id, title: '　', variable: '件', value: '1', memo: '',
    }), { ok: false, reason: 'blank_title' })
    assert.deepEqual(await addKpi(db, {
      seasonId: a.id, title: '応募', variable: '件', value: '十', memo: '',
    }), { ok: false, reason: 'bad_value' })
  })
})

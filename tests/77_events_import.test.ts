import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { planEvents } from '../src/import/events_2026.ts'

describe('2期イベントの取り込み', () => {
  test('日付と時刻範囲がある行だけを読み、複数日は分けて残す', () => {
    const rows = Array.from({ length: 4 }, () => [] as string[])
    rows.push(['', '検査イベントA', '46114', '目安 17:00~20:00', '会場', '担当者', '', ''])
    rows.push(['', '検査イベントB', '4/11,4/12', '11:30〜17:00', '', '担当者', '', ''])
    rows.push(['', '時刻なし', '46115', '', '', '担当者', '', ''])
    const plan = planEvents(rows)
    assert.equal(plan.ready.length, 2)
    assert.deepEqual(plan.ready[0]!.days, ['2026-04-02'])
    assert.deepEqual(plan.ready[1]!.days, ['2026-04-11', '2026-04-12'])
    assert.deepEqual([plan.ready[0]!.startsAt, plan.ready[0]!.endsAt], ['17:00', '20:00'])
    assert.deepEqual(plan.incomplete, [7])
  })
})

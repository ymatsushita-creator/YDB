import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  planPartners, PARTNER_COL, SHEET_PARTNERS, STATUS_CODE, emailOf,
} from '../src/import/partners_2026.ts'
import type { Workbook } from '../src/import/xlsx.ts'

/**
 * 提携団体の取り込み（C-153。依頼者の指示）。
 *
 * 依頼者の言葉（実行⑯）――「2期の団体連携は、3期にも引き継げ」。
 *
 * ★ **実在の表は使わない**（実在の団体名・担当者名をテストへ持ち込まない）。
 *   列の位置と判定だけを、組み立てた表で確かめる。
 */

const bookOf = (dataRows: string[][]): Workbook => {
  const rows: string[][] = []
  for (let i = 0; i < PARTNER_COL.headerRow; i++) rows.push([])
  const head: string[] = []
  head[PARTNER_COL.status] = '2期生推薦枠ステイタス'
  head[PARTNER_COL.name] = '団体名称'
  rows.push(head)
  rows.push(...dataRows)
  return { rows: (s: string) => (s === SHEET_PARTNERS ? rows : []) } as unknown as Workbook
}

const row = (o: Partial<Record<keyof typeof PARTNER_COL, string>>): string[] => {
  const r: string[] = []
  for (const [k, v] of Object.entries(o)) {
    r[PARTNER_COL[k as keyof typeof PARTNER_COL] as number] = v
  }
  return r
}

describe('提携団体の取り込み（C-153）', () => {
  test('団体名がある行だけを入れる（空の行は数える）', () => {
    const plan = planPartners(bookOf([
      row({ name: '検査ゼミA', contact: '担当 一郎' }),
      row({ contact: '担当 二郎' }),   // 名前が無い ―― 指す手段が無い
    ]))
    assert.equal(plan.partners.length, 1)
    assert.equal(plan.skipped, 1)
  })

  test('★ 同じ団体名は2行目を入れない（名前は一意）', () => {
    const plan = planPartners(bookOf([
      row({ name: '検査ゼミB', contact: '先に出たほう' }),
      row({ name: '検査ゼミB', contact: 'あとに出たほう' }),
    ]))
    assert.equal(plan.partners.length, 1)
    assert.equal(plan.partners[0]!.contactName, '先に出たほう',
      'あとの行で上書きすると、どちらが正かが決まらない')
    assert.equal(plan.skipped, 1)
  })

  test('推薦枠ステイタスは運営の語をそのまま対応させる', () => {
    assert.deepEqual(Object.keys(STATUS_CODE),
      ['未連絡', 'メール送信済み', 'アポ実施済み', '対象外'])
    const plan = planPartners(bookOf([
      row({ name: '検査ゼミC', status: 'アポ実施済み' }),
      row({ name: '検査ゼミD', status: '知らない語' }),
      row({ name: '検査ゼミE' }),
    ]))
    assert.equal(plan.partners[0]!.statusCode, 'met')
    assert.equal(plan.partners[1]!.statusCode, null, '知らない語を近い値へ寄せない')
    assert.equal(plan.partners[1]!.unmappedStatus, '知らない語', '捨てずに数える')
    assert.equal(plan.partners[2]!.statusCode, null)
  })

  test('連絡先の欄からメールだけを取り出す', () => {
    assert.equal(emailOf('電話 090-0000-0000 / zemi@example.test'), 'zemi@example.test')
    assert.equal(emailOf('電話のみ'), null)
  })

  test('★ 置き場所の無い値は入れず、数だけ残す', () => {
    const plan = planPartners(bookOf([
      row({ name: '検査ゼミF', actionLog: '2/3 訪問', memo: '所感', quota: '3' }),
    ]))
    const labels = plan.unplaced.map((u) => u.label)
    assert.ok(labels.includes('アクションログ'))
    assert.ok(labels.includes('メモ備考'))
    assert.ok(labels.includes('推薦可能人数'))
    // 置き場所を思いつきで作らない ―― 行の側にも生値を残していない。
    assert.equal(Object.keys(plan.partners[0]!).includes('memo'), false)
  })

  test('★ 3期用の複製を作らない（団体は期を持たない）', async () => {
    const source = await import('node:fs/promises')
      .then((fs) => fs.readFile(
        new URL('../scripts/import-partners-2026.ts', import.meta.url), 'utf8'))
    assert.doesNotMatch(source, /cohort_number = 3/,
      '3期用の団体を作ろうとしている。団体は期を持たないので複製は要らない')
    assert.match(source, /cohort_number = 2/,
      '推薦枠ステイタスは2期の事実として入れる')
  })
})

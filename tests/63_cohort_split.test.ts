import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { planApproach, APPROACH, SHEET_APPROACH } from '../src/import/approach_2026.ts'
import type { Workbook } from '../src/import/xlsx.ts'

/**
 * 期の分け方（C-149。依頼者の指示）。
 *
 * 依頼者の言葉（実行⑯）――「アプローチリストの**一番左の列**が false なのが2期、
 * true が3期だ」。
 *
 * ★ 実行⑫は同じ指示を22列目「面談実施」と読んでいた。**列を1つ間違えると、
 *   482人の分かれ方がまるごと変わる**（2期153/3期329 → 2期399/3期59）。
 *   どの列で決めたのかを、ここで固定する。
 *
 * ★ **実在の表は使わない。** 実在の氏名をテストへ持ち込まない（CLAUDE.md）。
 *   見出しと列の位置だけを写した組み立て表で確かめる。
 */

/** 見出し行までの空行と、渡された行を持つだけの表。 */
const bookOf = (dataRows: string[][]): Workbook => {
  const rows: string[][] = []
  for (let i = 0; i < APPROACH.headerRow; i++) rows.push([])
  const head: string[] = []
  head[APPROACH.referral] = 'リファラル'
  head[APPROACH.name] = '氏名'
  head[APPROACH.interviewDone] = '面談実施'
  rows.push(head)
  rows.push(...dataRows)
  return {
    rows: (sheet: string) => (sheet === SHEET_APPROACH ? rows : []),
  } as unknown as Workbook
}

/** 1行を作る。左端の値と「面談実施」の値だけを指定する。 */
const row = (referral: string, interviewDone = '', name = '検査 太郎'): string[] => {
  const r: string[] = []
  r[APPROACH.referral] = referral
  r[APPROACH.name] = name
  r[APPROACH.interviewDone] = interviewDone
  return r
}

describe('期の分け方 ―― 一番左の列（C-149）', () => {
  test('FALSE は2期、TRUE は3期', () => {
    const plan = planApproach(bookOf([
      row('FALSE', '', '検査 一郎'),
      row('TRUE', '', '検査 二郎'),
    ]))
    assert.equal(plan.people[0]!.cohort, 2)
    assert.equal(plan.people[1]!.cohort, 3)
    assert.deepEqual(plan.byCohort, { 2: 1, 3: 1, unknown: 0 })
  })

  test('★ 空欄で、表に手掛かりも無ければ、どちらにも寄せない', () => {
    // ★ C-157 で「表が書いている語があればそれで決める」に変えた。
    //   語も無ければ、やはり決めない ―― 寄せれば表に無い値の創作になる。
    const plan = planApproach(bookOf([row('', '', '検査 三郎')]))
    assert.equal(plan.people[0]!.cohort, null)
    assert.deepEqual(plan.byCohort, { 2: 0, 3: 0, unknown: 1 })
  })

  test('★ 「面談実施」は期を決めない ―― 決めるのは左端だけ', () => {
    const plan = planApproach(bookOf([
      // 左端 FALSE ・面談実施 TRUE。実行⑫の読み方なら3期になっていた行。
      row('FALSE', 'TRUE', '検査 四郎'),
      // 左端 TRUE ・面談実施 FALSE。逆向きの取り違えも塞ぐ。
      row('TRUE', 'FALSE', '検査 五郎'),
    ]))
    assert.equal(plan.people[0]!.cohort, 2, '左端 FALSE なら2期')
    assert.equal(plan.people[1]!.cohort, 3, '左端 TRUE なら3期')
  })

  test('判定に使った生値を両方とも残す（訂正の根拠になる）', () => {
    const plan = planApproach(bookOf([row('TRUE', 'FALSE', '検査 六郎')]))
    assert.equal(plan.people[0]!.referral, 'TRUE')
    assert.equal(plan.people[0]!.interviewDone, 'FALSE')
  })

  test('氏名が空の行は入れない（値があれば数える）', () => {
    const r: string[] = []
    r[APPROACH.referral] = 'FALSE'
    const plan = planApproach(bookOf([r]))
    assert.equal(plan.people.length, 0)
    assert.equal(plan.skipped, 1)
  })
})

/**
 * 空欄の期は、表自身が書いている語で決める（C-157。依頼者の指示）。
 */
describe('空欄の期は語で決める（C-157）', () => {
  const withStatus = (referral: string, status: string, statusAug = '') => {
    const r: string[] = []
    r[APPROACH.referral] = referral
    r[APPROACH.name] = '検査 太郎'
    r[APPROACH.status] = status
    r[APPROACH.statusAug] = statusAug
    return r
  }

  test('★ 空欄＋「3期生候補」なら3期', () => {
    const plan = planApproach(bookOf([withStatus('', '', '3期生候補（A）')]))
    assert.equal(plan.people[0]!.cohort, 3)
    assert.equal(plan.people[0]!.cohortSource, 'status')
  })

  test('★ 空欄＋「合格」「不合格」は2期の選考結果なので2期', () => {
    for (const s of ['合格', '不合格']) {
      const plan = planApproach(bookOf([withStatus('', s)]))
      assert.equal(plan.people[0]!.cohort, 2, `${s} が2期になっていない`)
    }
  })

  test('空欄＋手掛かり無しは、決めないまま', () => {
    const plan = planApproach(bookOf([withStatus('', '')]))
    assert.equal(plan.people[0]!.cohort, null)
    assert.equal(plan.people[0]!.cohortSource, 'none')
  })

  test('★ 左端が入っていれば、そちらが勝つ（ステータスで上書きしない）', () => {
    const plan = planApproach(bookOf([withStatus('FALSE', '', '3期生候補（A）')]))
    assert.equal(plan.people[0]!.cohort, 2, '左端の指示をステータスが覆している')
    assert.equal(plan.people[0]!.cohortSource, 'referral')
  })

  test('★ 確度の格付けを、表からそのまま読む（C-158）', () => {
    const plan = planApproach(bookOf([
      withStatus('FALSE', '', '3期生候補（S）'),
      withStatus('FALSE', '', '3期生候補(C)'),
      withStatus('FALSE', '', '対象外'),
    ]))
    assert.equal(plan.people[0]!.grade, 'S')
    assert.equal(plan.people[1]!.grade, 'C', '半角括弧で落としている')
    assert.equal(plan.people[2]!.grade, null, '無い格付けを作っている')
  })
})

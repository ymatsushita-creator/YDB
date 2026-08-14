import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseSheet, columnIndex, serialToDate } from '../src/import/xlsx.ts'

/**
 * `.xlsx` を読む道具（実行⑫。依頼者から実データの表を受領）。
 *
 * ★ 実データは `db/private/` にも置かず、リポジトリ直下の gitignore 済みの
 *   ファイルにある。**テストは実データを読まない** ―― ここでは XML を直に渡す。
 *
 * 固定したいのは4つ ――
 *   ① **自己終了のセル**（`<c r="A1"/>`）で、次のセルの値を持って行かない
 *   ② チェックボックスは TRUE / FALSE、**未設定は空**（3つを区別する）
 *   ③ 行の中の抜けた列は空で埋まり、列の位置がずれない
 *   ④ 日付の連番は 1900 年方式で読み、読めない値は作らない
 */

const shared = ['あ', 'い', 'う', 'え']

describe('xlsx を読む', () => {
  // -----------------------------------------------------------
  // ① 自己終了のセル
  // -----------------------------------------------------------
  test('★ 自己終了のセルが、次のセルの値を持って行かない', () => {
    // 実データで踏んだ形そのもの。`<c r="A2" s="83"/>` を開始タグと読むと、
    // `[^>]*` が末尾の `/` を飲み込み、B2 の値を A2 の値として拾う。
    const xml = `<sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
      <row r="2"><c r="A2" s="83"/><c r="B2" s="84" t="s"><v>2</v></c>
                 <c r="C2" s="84"/><c r="D2" t="s"><v>3</v></c></row>
    </sheetData>`
    const rows = parseSheet(xml, shared)
    assert.deepEqual(rows[0], ['あ', 'い'])
    assert.deepEqual(rows[1], ['', 'う', '', 'え'],
      'A2 は空のまま。B2 の値を持って行かない')
  })

  // -----------------------------------------------------------
  // ② チェックボックスの3つの状態
  // -----------------------------------------------------------
  test('★ TRUE・FALSE・未設定の3つを区別する', () => {
    // 一番左の欄が FALSE なら2期、TRUE なら3期、**未設定はどちらでもない**
    // （依頼者の指示。C-149）。3つを3つのまま読めることがここの前提になる。
    const xml = `<sheetData>
      <row r="1"><c r="A1" t="b"><v>1</v></c><c r="B1" t="b"><v>0</v></c><c r="C1"/>
                 <c r="D1" t="s"><v>0</v></c></row>
    </sheetData>`
    const row = parseSheet(xml, shared)[0]!
    assert.deepEqual(row, ['TRUE', 'FALSE', '', 'あ'])
    // 判定に使うのはこの3つ。**空を FALSE に丸めない。**
    assert.equal(row[0] === 'TRUE' || row[0] === 'FALSE', true)
    assert.equal(row[2] === 'TRUE' || row[2] === 'FALSE', false, '欄が無い')
  })

  /**
   * ★ この検査は C-149 で書き換えた。
   *
   * 旧: 「FALSE 以外を3期へ移す」（22列目「面談実施」で期を決めていた頃）
   * 新: **期を決めるのは一番左の欄**で、空欄はどちらへも移さない。
   *
   * 旧条文は併記しない（CLAUDE.md）。分かれ方の実測は `db/DECISIONS.md` C-149。
   */
  test('★ 訂正は「表が主張していない側」だけを打ち消す', () => {
    const source = readFileSync(new URL('../scripts/import-approach-2026.ts', import.meta.url), 'utf8')
    assert.match(source, /!claimed\.get\(key\)\?\.has\(wrongCohort\)/,
      '表が同じ氏名で主張している期を打ち消すと、打ち消し合いになる')
    assert.match(source, /hasSeason2Application \? 2 : p\.cohort/,
      '実応募がある期をチェック欄より優先する')
    assert.match(source, /effectiveCohort === null/,
      '期が決まらない人を、期にぶら下がる行から外す')
    assert.doesNotMatch(source, /needsSeason2/,
      '「FALSE 以外は3期」の判定を再び入れない')
  })

  // -----------------------------------------------------------
  // ③ 列の位置
  // -----------------------------------------------------------
  test('抜けた列は空で埋まり、位置がずれない', () => {
    const xml = `<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="E1" t="s"><v>1</v></c></row></sheetData>`
    assert.deepEqual(parseSheet(xml, shared)[0], ['あ', '', '', '', 'い'])
    assert.equal(columnIndex('A1'), 0)
    assert.equal(columnIndex('Z9'), 25)
    assert.equal(columnIndex('AA1'), 26)
    assert.equal(columnIndex('BC12'), 54)
  })

  test('空の行も1行として数える（行の番号がずれない）', () => {
    const xml = `<sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c></row>
      <row r="2"/>
      <row r="3"><c r="A3" t="s"><v>1</v></c></row>
    </sheetData>`
    const rows = parseSheet(xml, shared)
    assert.equal(rows.length, 3)
    assert.deepEqual(rows[1], [])
    assert.deepEqual(rows[2], ['い'])
  })

  // -----------------------------------------------------------
  // ④ 日付の連番
  // -----------------------------------------------------------
  test('日付の連番は 1900 年方式で読む。読めない値は作らない', () => {
    assert.equal(serialToDate('46063'), '2026-02-10')
    assert.equal(serialToDate('45292'), '2024-01-01')
    // 時刻つき（小数）も同じ日に落ちる。
    assert.equal(serialToDate('46063.68'), '2026-02-10')
    for (const bad of ['', 'あした', '0', '-5', '999999']) {
      assert.equal(serialToDate(bad), null, `読めない値を作らない: ${bad}`)
    }
  })
})

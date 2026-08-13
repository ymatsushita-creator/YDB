import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
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
    // 「FALSE になっている」と「そもそも欄が無い」は違う ――
    // この違いが、そのまま「去年か今年か」の判定に効く（依頼者の指示）。
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

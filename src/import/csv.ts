/**
 * CSV を読む最小の道具（C-164）。
 *
 * ★ xlsx と同じ判断で、依存を増やしていない（`xlsx.ts` の頭注と同じ）。
 * ★ 値は**文字列のまま**返す。日付も数値も解釈しない。
 * ★ RFC4180 ―― 二重引用符で囲まれた中では、改行もカンマも値の一部。
 *   `split(',')` で済ませると、住所や自由記述が入った瞬間に列がずれる。
 */
export function parseCsv(text: string): string[][] {
  // BOM を落とす。付いたままだと1列目の見出しが `﻿氏名` になる。
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = 0
  const push = () => { row.push(field); field = '' }
  const endRow = () => { push(); rows.push(row); row = [] }

  while (i < s.length) {
    const c = s[i]!
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue }
        quoted = false; i += 1; continue
      }
      field += c; i += 1; continue
    }
    if (c === '"') { quoted = true; i += 1; continue }
    if (c === ',') { push(); i += 1; continue }
    if (c === '\r') { i += 1; continue }
    if (c === '\n') { endRow(); i += 1; continue }
    field += c; i += 1
  }
  // 末尾に改行が無い場合の最後の行。空文字だけなら行を作らない。
  if (field !== '' || row.length > 0) endRow()
  return rows
}

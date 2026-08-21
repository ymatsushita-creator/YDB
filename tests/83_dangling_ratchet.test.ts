import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { collectRefs, findDangling, parseHeadings, ratchet } from '../scripts/decisions-refs.ts'

/**
 * 欠番のラチェット（S13）。**番号を書いたのに記録が無い**状態が増えないことを固定する。
 *
 * ★ なぜ要るか:
 *   欠番45件は、実行⑯・⑰が「コードに番号を書いて、記録を書かずに終わった」結果である。
 *   索引のずれは CI が落とせるが、**最初から書かれなかった判断**は検知しようがない。
 *   台帳に既存分を据え置き、**増分だけを落とす**のがこの仕組みである。
 *
 * ★ 判定（`ratchet`）は純粋な関数として置いてある。検査側に埋めると、
 *   条件を緩めたことをここで捕まえられない ――
 *   「文字列が含まれるか」で見ていた検査は、独立レビューに素通りされた実績がある。
 */

const LEDGER = new URL('../.consultant/DANGLING-BASELINE.txt', import.meta.url)

describe('欠番のラチェット（S13）', () => {
  test('★ 台帳に無い番号が現れたら落ちる（記録なしに番号を増やせない）', () => {
    // ★ 架空の番号は接頭辞を `A`〜`F` の外に採る（2026-08-20。C-230）。
    //   `C-` で始まる番号を書いていたため、**このフィクスチャ自身が「記録の無い C-番号」として
    //   S13 に拾われ、検査が永久に赤かった。** `ratchet` は文字列の集合を比べるだけなので
    //   接頭辞に意味は無い。検査の側を緩めずに済む直し方はこちらである。
    const r = ratchet(['C-1', 'C-2'], ['C-1', 'C-2', 'Z-900'])
    assert.equal(r.ok, false, '新しい欠番を素通りさせている ―― 欠番45件と同じ穴が開く')
    assert.deepEqual(r.added, ['Z-900'])
  })

  test('★ 埋めて減ったときも落ちる（台帳の締め忘れを許さない）', () => {
    // ★ 減ったら通す作りにすると、締め忘れた台帳が「45件のままだ」と嘘をつき、
    //   **次に増えた1件を隠す。**
    const r = ratchet(['C-1', 'C-2'], ['C-1'])
    assert.equal(r.ok, false)
    assert.deepEqual(r.filled, ['C-2'])
  })

  test('一致していれば通る', () => {
    assert.equal(ratchet(['C-1', 'D-30'], ['D-30', 'C-1']).ok, true)
  })

  test('★ 並びは接頭辞→番号（環境で揺れない）', () => {
    // 番号だけで比べると同番異接頭辞が同順位になり、`git grep` の出力順に依存する。
    const r = ratchet([], ['D-30', 'C-212', 'C-9', 'A-5'])
    assert.deepEqual(r.added, ['A-5', 'C-9', 'C-212', 'D-30'])
  })

  test('★ 台帳がいまの実測と一致している（据え置き分が動いていない）', async () => {
    const ledger = (await readFile(LEDGER, 'utf8')).split('\n')
      .map((l) => l.trim()).filter((l) => /^[A-F]-\d+$/.test(l))
    const markdown = await readFile(new URL('../db/DECISIONS.md', import.meta.url), 'utf8')
    const current = findDangling(parseHeadings(markdown), await collectRefs()).map((d) => d.id)
    const r = ratchet(ledger, current)
    assert.deepEqual({ added: r.added, filled: r.filled }, { added: [], filled: [] },
      '台帳と実測がずれている ―― `pnpm decisions:baseline` で締め直すこと')
  })

  test('★ 台帳は生成物であると名乗っている', async () => {
    const head = (await readFile(LEDGER, 'utf8')).split('\n').slice(0, 5).join('\n')
    assert.match(head, /生成物/, '手で編集される。次の生成で消える')
  })
})

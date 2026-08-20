import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { appCss } from './support/css.ts'

/**
 * 縦バー・ロゴ・横バーは、ひと続きの面である（C-192 / C-196 / C-198）。
 *
 * ★ 依頼者の指摘に3回落ちた ―― 直したつもりで直っていなかった。
 *   原因は毎回「同じセレクタを二度書き、前の指定が残っていた」こと。
 *   **見た目は見られないが、指定が生きているかは読める。** それを見張る。
 */

const css = () => appCss()

/**
 * そのセレクタの、最後に書かれた宣言ブロック（後ろが勝つため）。
 * ★ **行頭で照合する。** 部分一致だと `... .hh-brand {` のような
 *   別のセレクタまで拾い、別のブロックを見て判定を誤る（実際に誤った）。
 */
const blocks = (src: string, selector: string) => {
  const found: string[] = []
  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    // 1行で書いた指定（`sel { a: b; }`）も数える。
    const head = lines[i]!.trimEnd()
    if (head !== `${selector} {` && !head.startsWith(`${selector} { `)) continue
    const rest = lines.slice(i).join('\n')
    found.push(rest.slice(0, rest.indexOf('}')))
  }
  return found
}
const lastBlock = (src: string, selector: string) => {
  const all = blocks(src, selector)
  assert.notEqual(all.length, 0, `${selector} が無い`)
  return all[all.length - 1]!
}

describe('バーの継ぎ目（C-198 / C-207）', () => {
  test('★ 柱を送る器にしたら、親の角丸で中身を切り抜かない', async () => {
    // ★ `.hh-sidebar` に `overflow-y: auto` を足した瞬間、
    //   `.sidebar-region`（生成物）の四隅の角丸が**中身を切り抜き**、
    //   天端のロゴの右角が丸く削られた（依頼者の指摘。実画面で確認）。
    //   `.hh-brand` 側で丸みを消しても、切っているのは親なので効かない。
    const src = await css()
    const b = lastBlock(src, '.hh-sidebar')
    assert.match(b, /overflow-y:\s*auto/, '柱ごと送る形が外れている')
    assert.match(b, /border-top-right-radius:\s*0/, '親の角丸がロゴを切り抜く')
    assert.match(b, /border-bottom-right-radius:\s*0/)
  })

  test('★ ロゴの器は、右と下を丸めない（展開時）', async () => {
    const b = lastBlock(await css(), '.hh-brand')
    assert.match(b, /border-top-right-radius:\s*0/, '右上が丸いと横バーと切れて見える')
    assert.match(b, /border-bottom-right-radius:\s*0/, '右下が丸いと切れて見える')
    assert.match(b, /border-bottom-left-radius:\s*0/, '左下が丸いと縦バーと切れて見える')
  })

  test('★ 収納時も、高さは横バーと同じ（--logo-h）', async () => {
    const b = lastBlock(await css(), '.hh-frame:has(#rail-collapse:checked) .hh-brand')
    assert.match(b, /height:\s*var\(--logo-h\)/,
      'height: auto にすると縦幅がずれる（実際にずれた）')
    assert.doesNotMatch(b, /height:\s*auto/)
  })

  test('★ 同じ指定を二度書いていない（前の残骸が崩れの原因）', async () => {
    const src = await css()
    for (const sel of [
      '.hh-brand',
      '.hh-frame:has(#rail-collapse:checked) .hh-brand',
      '.hh-frame:has(#rail-collapse:checked) .hh-brand-logo',
    ]) {
      const n = blocks(src, sel).length
      assert.equal(n, 1, `${sel} が ${n} 箇所にある ―― 前の指定が残る`)
    }
  })
})

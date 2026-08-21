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

/**
 * ★ 2026-08-20 の意匠刷新（C-236）で、**継ぎ目そのものが無くなった。**
 *
 *   旧版は「浮いた黒い板を2枚、角丸で突き合わせる」形だったので、
 *   どの角を丸めてどの角を四角にするかが崩れの原因だった（C-192〜C-207。
 *   依頼者の指摘に3回落ちた）。
 *
 *   DESIGN.md の `nav-bar` / `ex-app-shell-row` は**浮いた板を指示していない**。
 *   操作柱と上の帯は canvas の面で、境目は hairline 1本である。
 *   角丸を持たないので、突き合わせる角が存在しない ――
 *   **崩れの原因を消したのであって、直したのではない。**
 *
 *   ここで見張るのは、板が戻っていないことと、寸法が1つのトークンから
 *   出ていることである（＝天端と厚みが揃う条件）。
 */
describe('バーの継ぎ目（C-198 / C-207 → C-236）', () => {
  test('★ 柱ごと送る（中で送るとタブか足元が切れる。C-205 / C-206）', async () => {
    const b = lastBlock(await css(), '.hh-sidebar')
    assert.match(b, /overflow-y:\s*auto/, '柱ごと送る形が外れている')
    assert.match(b, /position:\s*sticky/, '柱が送りに付いて動く')
  })

  test('★ 操作柱と上の帯に角丸を持たせない（突き合わせる角を作らない）', async () => {
    const src = await css()
    for (const sel of ['.hh-sidebar', '.hh-brand', '.zoom-bar']) {
      const b = lastBlock(src, sel)
      assert.doesNotMatch(b, /border-radius/,
        `${sel} が角丸を持っている ―― 板が2枚に見える形へ戻っている`)
    }
  })

  test('★ 天端は揃う（柱・ロゴ枠・帯が同じ 0 から始まる）', async () => {
    const src = await css()
    assert.match(lastBlock(src, '.hh-sidebar'), /top:\s*0/, '柱の天端が下がっている')
    assert.match(lastBlock(src, '.hh-brand'), /top:\s*0/, 'ロゴ枠の天端が下がっている')
    assert.match(lastBlock(src, '.zoom-bar'), /top:\s*0/, '帯の天端が下がっている')
  })

  test('★ 厚みは1つのトークンから出る（ロゴ枠と帯を別々に書かない）', async () => {
    const src = await css()
    for (const sel of ['.hh-brand', '.zoom-bar', '.hh-skeleton-bar']) {
      assert.match(lastBlock(src, sel), /height:\s*var\(--bar-h\)/,
        `${sel} が厚みを自分で決めている ―― 片方だけ古くなる`)
    }
  })

  test('★ 収納時も、厚みは横バーと同じ（--bar-h）', async () => {
    const b = lastBlock(await css(), '.hh-frame:has(#rail-collapse:checked) .hh-brand')
    assert.match(b, /height:\s*var\(--bar-h\)/,
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

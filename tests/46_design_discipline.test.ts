import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, access, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { appCss } from './support/css.ts'

/**
 * 意匠の規律（C-239。依頼者の指示 2026-09-09 ――
 * NEO CAMPUSの見本をYouthDBへ翻訳し、UIを一新する）。
 *
 * ★ この位置には**リキッドグラス**の契約テストが在った（実行⑫。仕様書を受領）。
 *   意匠の刷新でガラスは退役した ―― `basic/DESIGN.md`（Iridescent-Black）は
 *   ぼかした縁も追従光も指示しておらず、
 *   "Typography, spacing, geometry, and operational UI remain restrained and
 *   technical" に反する。**検査を消したのではなく、対象を差し替えた。**
 *   旧版の契約（4枚目の層・多段 inset の縁・ぼかしの予算）は Git 履歴に在る。
 *
 * いま固定するのは、DESIGN.md 本文が明示的に定めている7つである ――
 *   ① 意匠の層は **`tokens.css` と `base.css` の2枚だけ**
 *      （同じ性質を2箇所で決められる余地を作らない）
 *   ② 原典（`basic/DESIGN.md`）と生成物（`app/tokens.css`）を触っていない
 *   ③ 退役した層が復活していない（白黒の土台・ブランド線・ガラス・追従光）
 *   ④ **面をスペクトラムで塗らない。** 出るのは
 *      ブランド場面・低不透明度の場・大きな図に限る
 *   ⑤ 主操作は黄色、現在地はピンク、focusは紫。表と入力は静かな紙面
 *   ⑥ 色・余白・角丸・書体を CSS の下の階層で**作らない**（トークン経由）
 *   ⑦ 動きを減らす設定に従う
 */

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const read = (p: string) => readFile(join(ROOT, p), 'utf8')
const missing = async (p: string) => {
  try { await access(join(ROOT, p)); return false } catch { return true }
}
/** コメントを落とした本文。**注記は履歴なので数えない。** */
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

describe('意匠の規律（C-239）', () => {
  // -----------------------------------------------------------
  // ① 層は2枚
  // -----------------------------------------------------------
  test('① 意匠の層は tokens.css と base.css の2枚だけ', async () => {
    const layout = await read('app/layout.tsx')
    const layers = [...layout.matchAll(/^import '\.\/([^']+\.css)'/gm)].map((m) => m[1]!)
    assert.deepEqual(layers, ['tokens.css', 'base.css'],
      '意匠の層が増えている ―― 同じ性質を2箇所で決められるようになる')
  })

  test('① 取り込み順は番号順（カスケードの順序を崩さない）', async () => {
    const base = await read('app/base.css')
    const parts = [...base.matchAll(/@import '\.\/_styles\/([^']+)'/g)].map((m) => m[1]!)
    assert.ok(parts.length >= 4, '分割された断片が読み込まれていない')
    assert.deepEqual(parts, [...parts].sort(), '番号順に並んでいない')
    const files = (await readdir(join(ROOT, 'app/_styles'))).filter((f) => f.endsWith('.css'))
    assert.deepEqual(files.sort(), [...parts].sort(),
      '読み込まれていない断片がある（または無いものを読み込んでいる）')
  })

  // -----------------------------------------------------------
  // ② 原典と生成物
  // -----------------------------------------------------------
  test('② 生成物を手で編集していない（断り書きが残っている）', async () => {
    const tokens = await read('app/tokens.css')
    assert.match(tokens, /自動生成。編集しないこと/)
    assert.match(tokens, /出典: basic\/DESIGN\.md/)
  })

  test('② 生成物に、意匠の層のトークンを書き足していない', async () => {
    const tokens = await read('app/tokens.css')
    for (const name of ['--lg-', '--rail-', '--bar-h', '--spectrum-']) {
      assert.ok(!tokens.includes(name),
        `生成物に ${name} が書き込まれている（次の pnpm tokens で消える）`)
    }
  })

  // -----------------------------------------------------------
  // ③ 退役した層が戻っていない
  // -----------------------------------------------------------
  test('③ 白黒の土台・ブランド線・ガラス・追従光は復活していない', async () => {
    for (const p of ['app/monochrome.css', 'app/brand.css', 'app/glass.css',
                     'app/_components/glass.tsx']) {
      assert.ok(await missing(p), `${p} が戻っている`)
    }
    // コメントは履歴なので数えない（「外した」と書いてある注記に当たる）。
    const css = stripComments(await appCss())
    assert.doesNotMatch(css, /backdrop-filter/, 'ガラス（ぼかした面）が戻っている')
    assert.doesNotMatch(css, /--lg-/, 'ガラスのトークンが戻っている')
    assert.doesNotMatch(css, /brand-wave/, 'ロゴから伸びる虹色の波が戻っている')
  })

  // -----------------------------------------------------------
  // ④ 面をスペクトラムで塗らない
  // -----------------------------------------------------------
  test('④ スペクトラムを使う規則は数えられるほど少ない（85〜90% は無彩色）', async () => {
    const css = stripComments(await appCss())
    const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter((r) => r[1]!.trim() !== ':root')
      .filter((r) => /--spectrum-line|--spectrum-field|--gradient-brand-spectrum/.test(r[2]!))
      .map((r) => r[1]!.trim())
    // 現在地の印（操作柱・タブ・パンくず）・identity の面（合言葉・人の見出し）・
    // 画面ごと空のときの光。**それ以上に増えたら、比率が壊れている。**
    assert.ok(rules.length <= 8,
      `スペクトラムを使う規則が ${rules.length} 箇所ある:\n${rules.join('\n')}`)
  })

  test('④ 表・ボタン・入力の面にスペクトラムを塗っていない', async () => {
    const css = stripComments(await appCss())
    for (const rule of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const sel = rule[1]!.trim()
      const decls = rule[2]!
      // `:root` はトークンの**定義**である。使っている場所だけを見る。
      if (sel === ':root') continue
      if (!/--spectrum-field|--gradient-brand-spectrum/.test(decls)) continue
      // 光の場を敷いてよいのは、暗い面と「画面ごと空」のときだけ。
      assert.match(sel, /login-frame|person-head|hh-empty|\.empty/,
        `操作面に光の場を敷いている: ${sel}`)
    }
  })

  test('④ スペクトラムは線か、大きな進捗図に限る', async () => {
    const css = stripComments(await appCss())
    for (const rule of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const decls = rule[2]!
      const selector = rule[1]!.trim()
      if (selector === ':root') continue
      if (!/--spectrum-line/.test(decls)) continue
      if (/meter|bar-fill|kpi-viz/.test(selector)) continue
      assert.match(decls, /(height|width):\s*[234]px/,
        `進捗図でないスペクトラムに太さの指定が無い: ${selector}`)
    }
  })

  // -----------------------------------------------------------
  // ⑤ 操作の意味色
  // -----------------------------------------------------------
  test('⑤ 主ボタンは黄色の面・濃い枠・硬い影', async () => {
    const css = await appCss()
    const rules = [...css.matchAll(/\.button-primary \{([^}]*)\}/g)]
    const rule = rules.at(-1)?.[1]
    assert.ok(rule, '.button-primary の規則がある')
    assert.match(rule!, /background:\s*var\(--color-brand-yellow\)/)
    assert.match(rule!, /border:\s*3px solid var\(--color-primary\)/)
    assert.match(rule!, /box-shadow:\s*0 5px 0 var\(--color-primary\)/)
  })

  test('⑤ focus-visible は紫の輪で、色だけに頼らない', async () => {
    const css = await appCss()
    const rules = [...css.matchAll(/:focus-visible \{([^}]*)\}/g)]
    const rule = rules.at(-1)?.[1]
    assert.ok(rule, 'focus-visible の指定がある')
    assert.match(rule!, /3px solid var\(--color-brand-lavender-deep\)/)
    assert.match(rule!, /outline-offset:\s*3px/)
  })

  test('⑤ 現在地はピンクの面と濃い枠で示す', async () => {
    const css = await appCss()
    const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter((match) => match[1]!.trim() === '.sidebar-item-active')
    const rule = rules.at(-1)?.[2]
    assert.ok(rule, '.sidebar-item-active の規則がある')
    assert.match(rule!, /background:\s*var\(--color-brand-pink\)/)
    assert.match(rule!, /border-color:\s*var\(--color-primary\)/)
  })

  test('⑤ 表の見出しは太い sans、ふつうのセルに色を入れない', async () => {
    const css = stripComments(await appCss())
    const th = /table\.data thead th[^{]*\{([^}]*)\}/.exec(css)
    assert.ok(th, '表の見出しの規則がある')
    assert.match(th![1]!, /font-family:\s*var\(--font-sans\)/)
    const td = /table\.data td[^{]*\{([^}]*)\}/.exec(css)
    assert.ok(td, '表のセルの規則がある')
    assert.doesNotMatch(td![1]!, /brand-|spectrum/, 'ふつうのセルにブランド色が入っている')
  })

  // -----------------------------------------------------------
  // ⑥ 値を下の階層で作らない
  // -----------------------------------------------------------
  test('⑥ 色は直値で書かない（トークン経由。影と黒の透過だけ例外）', async () => {
    const css = stripComments(await appCss())
    const hex = [...css.matchAll(/#[0-9a-fA-F]{3,8}/g)].map((m) => m[0])
    // マスクの `#000` は色ではなく「抜くかどうか」を指す（mask-image）。
    const real = hex.filter((h) => !/^#000$/.test(h))
    assert.deepEqual(real, [],
      `色を直値で書いている: ${real.join(' ')} ―― 値は tokens.css から取る`)
  })

  test('⑥ 角丸はトークン経由（生の px を並べない）', async () => {
    const css = stripComments(await appCss())
    const radius = [...css.matchAll(/border-radius:\s*([^;]+);/g)].map((m) => m[1]!.trim())
    const rawRadius = radius.filter((v) => !/var\(--rounded-|^0$|^0 /.test(v))
    assert.deepEqual(rawRadius, [],
      `角丸を直値で書いている: ${rawRadius.join(' / ')}`)
  })

  // -----------------------------------------------------------
  // ⑦ 動きを減らす設定
  // -----------------------------------------------------------
  test('⑦ 動きを減らす設定では、流れる帯と装飾的な移動を止める', async () => {
    const css = await appCss()
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)
    const block = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(css)
    assert.ok(block, '動きを減らす設定の指定がある')
    assert.match(block![1]!, /animation:\s*none/)
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?transform:\s*none\s*!important/)
  })
})

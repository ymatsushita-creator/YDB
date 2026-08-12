import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

/**
 * リキッドグラス（実行⑫。依頼者から仕様書を受領）。
 *
 * 依頼者が決めたこと ――
 *   範囲   **浮いているものだけ**（操作柱・帯・ポップアップ・主ボタン）
 *   背景   **敷かない**（「色は線、面は黒」の意匠規定を守る。C-71）
 *   追従光 **入れる**
 *
 * ここで固定したいのは7つ ――
 *   ① ガラスは**4枚目の層**で、外せば物理ボタンに戻る（原典も生成物も触らない）
 *   ② `backdrop-filter` を使うのは**背後にコンテンツがある浮遊物だけ**
 *      （単色の面の上で使わない ―― 仕様 §9 の禁止事項）
 *   ③ ぼかしを掛ける要素は**同時可視3枚以下**（仕様 §10 の予算）
 *   ④ 縁は `border` ではなく**多段 inset box-shadow**で、上下に明度差がある
 *   ⑤ 暗い地の上のティントは**色そのものを暗色に差し替える**（透過率だけ下げない）
 *   ⑥ フォールバックが3つそろっている（`@supports` / 透過低減 / ハイコントラスト）
 *   ⑦ **ガラスの入れ子を作らない**（仕様 §9）
 */

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const read = (p: string) => readFile(join(ROOT, p), 'utf8')

/** コメントを落とした本文。**注記は履歴なので数えない。** */
const body = async (p: string) => (await read(p))
  .replace(/\/\*[\s\S]*?\*\//g, '')

describe('リキッドグラス', () => {
  // -----------------------------------------------------------
  // ① 外せば戻る層
  // -----------------------------------------------------------
  test('① ガラスは4枚目の層。原典と生成物を触っていない', async () => {
    const layout = await read('app/layout.tsx')
    // 読む順は トークン → 土台 → 白黒 → ブランド → ガラス。
    const order = ['./tokens.css', './base.css', './monochrome.css', './brand.css', './glass.css']
      .map((f) => layout.indexOf(f))
    assert.ok(order.every((n) => n >= 0), 'ガラス層が読み込まれている')
    assert.deepEqual([...order].sort((a, b) => a - b), order,
      'ガラスは一番最後に読む（外せば下の層がそのまま出る）')

    // 生成物と原典に手を入れていない。
    const tokens = await read('app/tokens.css')
    assert.match(tokens, /自動生成。編集しないこと/)
    assert.doesNotMatch(tokens, /--lg-/, 'ガラスのトークンを生成物へ書き込んでいない')
  })

  // -----------------------------------------------------------
  // ②③ ぼかしの範囲と予算
  // -----------------------------------------------------------
  test('②③ backdrop-filter は浮遊物だけ。同時可視は3枚以下', async () => {
    const css = await body('app/glass.css')

    // `backdrop-filter` を持つ規則の**セレクタ**を数える。
    //
    // ★ `:\s*(?!none)` では通ってしまう ―― `\s*` が後戻りして空幅で合い、
    //   先読みが空白の位置で成功する。**値を取り出してから見る。**
    const blurs = (decls: string): string[] =>
      [...decls.matchAll(/(?:^|[^-])backdrop-filter\s*:([^;}]*)/g)]
        .map((m) => m[1]!.trim())
        .filter((v) => v !== '' && v !== 'none')
    const selectors = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , decls]) => blurs(decls!).length > 0)
      .flatMap(([, sel]) => sel!.split(',').map((s) => s.trim()).filter(Boolean))

    assert.deepEqual([...new Set(selectors)], ['.popup-card'],
      'ぼかしを掛けるのはポップアップの器だけ（単色の面の上では掛けない）')

    // ★ 同時に見えるぼかしは1枚。ポップアップは常に1つしか開かない
    //   （開閉は URL の1つの値で決まる）。
    const page = await read('app/borderline/page.tsx')
    assert.match(page, /memoPersonId|attendanceId/,
      'ポップアップは URL の値で1つだけ開く（器が同時に2枚出ない）')
  })

  /**
   * ★★ ビルドが**プレフィックス無しの `backdrop-filter` を落とす** ★★
   *
   * 仕様書 §4 は `-webkit-` 側から `brightness()` を外した例を載せている。
   * そのまま書いたら、Lightning CSS が**プレフィックス無しのほうを消し、
   * `-webkit-` だけを残した** ―― Chromium でぼかしが1つも効かず、
   * 画面で「ぼかしを持つ要素 0 件」と出て初めて気づいた。
   *
   * **同じ値を、プレフィックス付き → 無しの順で並べる。**
   * 書いたのに効かない類の欠陥は、目で見て気づけない。
   */
  test('★ ぼかしは2つの綴りで同じ値を書く（ビルドに落とされないため）', async () => {
    const css = await body('app/glass.css')
    const value = (decls: string, prop: string) => {
      const m = decls.match(new RegExp(`(?:^|[^-])${prop}\\s*:([^;}]*)`))
      return m ? m[1]!.replace(/\s+/g, ' ').trim() : null
    }
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , d]) => /backdrop-filter/.test(d!))

    assert.ok(rules.length > 0, 'ぼかしを書いている規則がある')
    for (const [, sel, decls] of rules) {
      const plain = value(decls!, 'backdrop-filter')
      const webkit = value(decls!, '-webkit-backdrop-filter')
      assert.ok(plain !== null, `${sel!.trim()}: プレフィックス無しを書く`)
      assert.ok(webkit !== null, `${sel!.trim()}: -webkit- も書く`)
      assert.equal(plain, webkit,
        `${sel!.trim()}: 2つの値を違えない（違えるとビルドが片方を消す）`)
      // 並び順も固定する（付き → 無し）。
      assert.ok(decls!.indexOf('-webkit-backdrop-filter') < decls!.indexOf('\n  backdrop-filter')
        || decls!.indexOf('-webkit-backdrop-filter') < decls!.search(/(?:^|[^-])backdrop-filter/),
      `${sel!.trim()}: -webkit- を先に書く`)
    }
  })

  test('② ボタンにぼかしを付けていない（単色の面の上）', async () => {
    const css = await body('app/glass.css')
    const buttonRule = css.match(/\.hh-nav \.sidebar-item,[\s\S]*?\{([\s\S]*?)\}/)
    assert.ok(buttonRule, 'ボタンの規則がある')
    assert.doesNotMatch(buttonRule![1]!, /backdrop-filter/,
      '背後が単色ならぼかしても何も変わらず、コストだけ掛かる（仕様 §9）')
  })

  // -----------------------------------------------------------
  // ④ 縁
  // -----------------------------------------------------------
  test('④ 縁は border ではなく多段 inset で、上下に明度差がある', async () => {
    const css = await body('app/glass.css')
    // 4辺ぶんの inset が並んでいる規則があること。
    assert.match(css, /inset\s+0\s+1px\s+0\s+var\(--lg-rim-top/)
    assert.match(css, /inset\s+0\s+-1px\s+0\s+var\(--lg-rim-bottom/)
    assert.match(css, /inset\s+1px\s+0\s+0\s+var\(--lg-rim-side/)
    assert.match(css, /inset\s+-1px\s+0\s+0\s+var\(--lg-rim-side/)

    // 光源側と減衰側で**値が違う**こと（同じなら方向が消える）。
    const alpha = (name: string) => {
      const m = css.match(new RegExp(`${name}:\\s*rgb\\([^)]*\\/\\s*\\.(\\d+)\\)`))
      return m ? Number(`0.${m[1]}`) : null
    }
    const top = alpha('--lg-rim-top')
    const bottom = alpha('--lg-rim-bottom')
    assert.ok(top !== null && bottom !== null)
    assert.ok(top! > bottom!, `上の縁が下より明るい（${top} > ${bottom}）`)

    // ボタンは `border` を持たない（物理ボタンの1px を打ち消している）。
    const buttonRule = css.match(/\.hh-nav \.sidebar-item,[\s\S]*?\{([\s\S]*?)\}/)
    assert.match(buttonRule![1]!, /border:\s*0/)
  })

  // -----------------------------------------------------------
  // ⑤ 暗い地のティント
  // -----------------------------------------------------------
  test('⑤ 暗い地のティントは、白の透過率ではなく色を差し替えている', async () => {
    const css = await body('app/glass.css')
    const dark = css.match(/--lg-dark-tint:\s*rgb\((\d+)\s+(\d+)\s+(\d+)/)
    assert.ok(dark, '暗い地用のティントがある')
    const [r, g, b] = [Number(dark![1]), Number(dark![2]), Number(dark![3])]
    assert.ok(Math.max(r, g, b) < 96,
      `色そのものが暗い（${r} ${g} ${b}）。白のまま透過率を下げても暗くならない`)

    // 主ボタンは白いカードの上に載り、文字が白い。**面を白の半透明にしない。**
    assert.match(css, /\.button-primary[^{]*\{[^}]*background-color:\s*var\(--lg-dark-tint\)/)
  })

  // -----------------------------------------------------------
  // ⑥ フォールバック
  // -----------------------------------------------------------
  test('⑥ フォールバックが3つそろっている', async () => {
    const css = await body('app/glass.css')
    assert.match(css, /@supports not \(backdrop-filter/)
    assert.match(css, /@media \(prefers-reduced-transparency: reduce\)/)
    assert.match(css, /@media \(forced-colors: active\)/)
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)

    // 透過低減とハイコントラストでは**追従光を消す**（動く光を残さない）。
    const reduced = css.match(/@media \(prefers-reduced-transparency: reduce\)\s*\{([\s\S]*?)\n\}/)
    assert.match(reduced![1]!, /::after[\s\S]*display:\s*none/)
  })

  // -----------------------------------------------------------
  // ⑦ 入れ子にしない
  // -----------------------------------------------------------
  test('⑦ ガラスの入れ子を作っていない', async () => {
    const css = await body('app/glass.css')
    // ぼかしを持つのは `.popup-card` だけで、その中のボタン（`.popup-close`）は
    // 面と縁しか持たない ―― 2枚重ねると1枚目の合成結果を拾えず破綻する。
    const closeRule = css.match(/\.popup-close[^{,]*\{[^}]*\}/g) ?? []
    for (const rule of closeRule) {
      assert.doesNotMatch(rule, /backdrop-filter\s*:\s*(?!none)/,
        'ポップアップの中のボタンにぼかしを重ねない（仕様 §9）')
    }
  })

  // -----------------------------------------------------------
  // 追従光の部品
  // -----------------------------------------------------------
  test('追従光は座標だけを持ち、見た目を持たない', async () => {
    const src = await read('app/_components/glass.tsx')
    assert.match(src, /^'use client'/)
    assert.match(src, /--lg-mx|--lg-my/, 'CSS 変数へ座標を書く')
    // ★ 光そのものは CSS が描く。色や半径を JS に書かない。
    assert.doesNotMatch(src, /radial-gradient|rgba?\(|opacity/)
    // ★ リスナは委譲で1つだけ（対象は20枚を超える）。
    assert.match(src, /document\.addEventListener\('pointermove'/)
    const perElement = src.match(/querySelectorAll\([^)]*\)\s*\.forEach/)
    assert.equal(perElement, null, '要素ごとにリスナを付けない（仕様 §6）')
  })

  test('追従光の対象と、CSS の対象が食い違っていない', async () => {
    const tsx = await read('app/_components/glass.tsx')
    const css = await body('app/glass.css')
    const targets = [...tsx.matchAll(/'(\.[^']+)'/g)].map((m) => m[1]!)
      .filter((s) => s.startsWith('.'))
    assert.ok(targets.length >= 8, '対象が一覧になっている')
    for (const t of targets) {
      assert.ok(css.includes(t), `CSS 側にも ${t} がある（片方だけ光る状態にしない）`)
    }
  })
})

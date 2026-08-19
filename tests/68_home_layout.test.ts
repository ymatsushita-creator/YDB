import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

/**
 * ホームの枠の使い方（C-161。依頼者の指示）。
 *
 * 依頼者の言葉（実行⑯）――「ここ、面積しっかりつかって。あと、スクロールは
 * できないように。あと、上の横バーは固定して」。
 *
 * ★ 実際にブラウザで測って直した（1280×700 / 1440×900 / 1680×1200）――
 *   どの寸法でも**送りが起きず**、下の2枚が**同じ高さで下端まで**伸びる。
 *   ここでは、その形を保つ指定が消えていないことを見張る。
 */

const ROOT = fileURLToPath(new URL('../', import.meta.url))

describe('ホームは枠を使い切る（C-161）', () => {
  let css = ''
  before(async () => { css = await readFile(join(ROOT, 'app/base.css'), 'utf8') })

  test('★ Step2はflex: 0 0 autoで高さ固定、gridで並べる', () => {
    const block = /\.home-dashboard\s*\{[^}]*\}/.exec(css)?.[0] ?? ''
    assert.ok(block, '.home-dashboard の指定が無い')
    assert.doesNotMatch(block, /calc\(100vh/,
      'パンくずと見出しの実寸は数えられない。当てた分だけ灰色が残るか、器ごと送れる')
    assert.match(block, /flex:\s*0 0 auto/, 'Step2は高さを自動で確定する（縮まない）')
    assert.match(block, /display:\s*grid/, 'Step2は上下2段を並べるgridである')
  })

  test('★ ホームの器は送らない（送るのはカードの中だけ）', () => {
    assert.doesNotMatch(css, /\.hh-main:has\(> \.home-dashboard\)\s*\{[^}]*overflow:\s*hidden/,
      'ホーム専用の切断指定は廃止。汎用ルールで統一する')
    assert.match(css, /\.hh-main:not\(:has\(> \.hh-grid\)\)\s*\{\s*overflow-y:\s*auto/,
      '一覧画面は汎用ルール（.hh-grid を持たない場合）で外枠を送る')
  })

  test('★ カードは .card-base である（.panel-card ではない）', () => {
    // Card は <section class="card-base"> を出す。`.panel-card` を狙った
    // 指定は**1つも当たらず**、中身の少ないカードが伸びずに灰色が残っていた。
    assert.match(css, /\.home-dashboard \.section > \.card-base/,
      'カードの伸ばし方が当たらない選択子に戻っている')
  })

  test('上の横バーは位置を固定する', () => {
    const bar = /\.zoom-bar\s*\{[^}]*\}/.exec(css)?.[0] ?? ''
    assert.match(bar, /position:\s*sticky/)
    assert.match(bar, /top:\s*0/)
  })

  test('図の高さを画面に書き写していない（器が決める）', async () => {
    const page = await readFile(join(ROOT, 'app/page.tsx'), 'utf8')
    const m = /height=\{(\d+)\}/.exec(page)
    assert.ok(m, '推移の図に高さの指定が無い')
    // 高さそのものは viewBox の縦横比として要る。**器を超えないこと**が要件で、
    // 器側（.card-base）が伸び縮みを持つ。数字が肥大していないかだけ見る。
    assert.ok(Number(m[1]) <= 400, `図の高さ ${m[1]} が大きすぎる`)
  })
})

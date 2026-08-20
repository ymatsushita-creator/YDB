import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appCss } from './support/css.ts'

/**
 * 押した直後に出す骨組み（C-142）。
 *
 * 依頼者の指示（実行⑮）――「進んでいることを見せる」。形の選択は委ねられた。
 * こちらが選んだのは**枠と見出しだけ**である。
 *
 * ★ 灰色のカードを数字の位置へ並べない ―― まだ無いものを「ある」ように見せない
 *   （0017 の「無いことを 0 と書かない」と同じ線）。
 * ★ `'use client'` を増やさない（C-95 / C-104。表と追従光の2つだけ）。
 *   「前の画面を残したまま帯だけ光らせる」には遷移状態をクライアントで見る必要があり、
 *   3つ目の境界になる。**規律を優先した。**
 * ★ 器の寸法は `Shell` と同じトークンで描く。数値を書き写すと寸法が2箇所になる。
 */

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const read = (p: string) => readFile(join(ROOT, p), 'utf8')

/** コメントを落とした本文（コメントは履歴なので数えない。tests/45 と同じ作法）。 */
const body = async (p: string) => (await read(p)).split('\n')
  .filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//')
    && !l.trimStart().startsWith('/*') && !l.includes('{/*'))
  .join('\n')

describe('押した直後の骨組み（C-142）', () => {
  test('骨組みがある。読み込み中だという事実を、文字で言う', async () => {
    const src = await body('app/loading.tsx')
    assert.match(src, /読み込み中/, '読み込み中だと言っていない')
    assert.match(src, /role="status"/, '読み上げに拾われない（見えない人に伝わらない）')
  })

  test("★ 'use client' を増やしていない（いまは表だけ。C-95 / C-104）", async () => {
    const clients: string[] = []
    for (const dir of ['app', 'src']) {
      for (const f of await readdir(join(ROOT, dir), { recursive: true })) {
        if (typeof f !== 'string' || !(f.endsWith('.tsx') || f.endsWith('.ts'))) continue
        const src = await read(join(dir, f))
        if (/^'use client'/m.test(src.split('\n').slice(0, 3).join('\n'))) clients.push(join(dir, f))
      }
    }
    assert.deepEqual(clients.sort(), ['app/_components/sheet.tsx'],
      "'use client' が増えている")
  })

  test('★ 中身のふりをしない（数字や行の形をした箱を並べない）', async () => {
    const src = await body('app/loading.tsx')
    // 繰り返しで箱を並べていないこと。並べると「何かある」ように見える。
    assert.doesNotMatch(src, /\.map\(/, '骨組みが箱を並べている')
    assert.doesNotMatch(src, /Array\.from|repeat\(/, '骨組みが箱を並べている')
    // 数字を置いていないこと（0 を出さない。0017 と同じ線）。
    assert.doesNotMatch(src, />\s*\d+\s*</, '骨組みが数字を出している')
  })

  test('器の寸法は Shell と同じトークンで描く（数値を書き写さない）', async () => {
    const src = await body('app/loading.tsx')
    // 器の骨は Shell と同じクラスを使う（自前の幅を持たない）。
    assert.match(src, /className="hh-frame"/)
    assert.match(src, /className="hh-main"/)
    assert.doesNotMatch(src, /style=\{\{/, '骨組みが自前の寸法を持っている')

    const css = await appCss()
    const bar = /\.hh-skeleton-bar \{([^}]*)\}/.exec(css)
    assert.ok(bar, '帯の骨の規則がある')
    assert.match(bar![1]!, /height:\s*var\(--bar-h\)/, '帯の厚みを数値で書いている')
    // ★ 高さを指定した枠には flex: 0 0 auto を添える（C-66 / C-113 / C-128。**5度目**）。
    assert.match(bar![1]!, /flex:\s*0 0 auto/)
  })

  test('★ 柱に面を敷いている（敷かないと器が崩れて見える）', async () => {
    // 面の色は `.hh-sidebar` が持っており、`.sidebar-region` は角丸と余白だけ。
    // 骨組みに `.hh-sidebar` は付かないので、**同じ面を自分で敷く。**
    // 再現して撮るまで、柱が消えたまま出していた（C-142）。
    const css = await appCss()
    const side = /\.hh-skeleton-side \{([^}]*)\}/.exec(css)
    assert.ok(side, '柱の骨の規則がある')
    assert.match(side![1]!, /background:\s*var\(--rail-face\)/,
      '柱に面が無い（背景が透けて、器が崩れて見える）')
  })
})

describe('配る重さ（C-143）', () => {
  test('★ タブのアイコンは、表示の大きさに見合っている', async () => {
    // ★ 512px の原版（202KB）をタブのアイコンに渡していた。
    //   タブは 16〜32px で描くので、**表示の200倍のバイト数を毎回配っていた。**
    const layout = await body('app/layout.tsx')
    const icon = /icon:\s*'([^']+)'/.exec(layout)?.[1]
    assert.ok(icon, 'アイコンの指定が読めない')
    const { size } = await stat(join(ROOT, 'public', icon!.replace(/^\//, '')))
    assert.ok(size < 20_000, `アイコンが ${Math.round(size / 1024)}KB ある（表示は16〜32px）`)
  })

  test('★ 画面のロゴは、表示の2倍までにする', async () => {
    // 出るのは最大 360px 幅（ログインの札）。原版は 1283px で**4倍**あった。
    for (const p of ['app/_components/shell.tsx', 'app/login/page.tsx']) {
      const src = await body(p)
      const m = /src="(\/brand\/[^"]+)"/.exec(src)
      assert.ok(m, `${p} のロゴの指定が読めない`)
      const { size } = await stat(join(ROOT, 'public', m![1]!.replace(/^\//, '')))
      assert.ok(size < 50_000, `${p} のロゴが ${Math.round(size / 1024)}KB ある`)
    }
  })

  test('意匠の原版は消していない（作り替えない・捨てない）', async () => {
    // ★ 受け取った資産はこちらで作り替えない（`basic/` と同じ扱い）。
    //   小さい版を**足した**だけで、原版はそのまま残す。
    for (const p of ['public/brand/logo_gradient.png', 'public/brand/logo_ydb.png']) {
      const { size } = await stat(join(ROOT, p))
      assert.ok(size > 0, `${p} が無い`)
    }
  })
})

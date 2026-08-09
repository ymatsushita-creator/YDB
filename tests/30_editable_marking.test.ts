import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

/**
 * 「記入できる場所」と「固定の場所」の表示が、実装と食い違っていないか。
 *
 * 実行⑨で画面を2種類に塗り分けた ――
 *   記入できる領域 … `editable-region` / `editable-inline`
 *   固定の画面     … Breadcrumb の `readOnly`（「この画面は記録を映すだけ」）
 *
 * ★ この2つは**人が手で付ける印**である。フォームを1つ足した日に
 *   `readOnly` を外し忘れると、**画面が「書けません」と嘘をつく。**
 *   嘘の注記は、注記が無いより悪い（読んだ人が探すのをやめる）。
 *   人が見直す運用は必ず抜けるので、機械に見張らせる。
 */

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const APP = join(ROOT, 'app')

async function pages(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const found: string[] = []
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) found.push(...await pages(full))
    else if (e.name === 'page.tsx') found.push(full)
  }
  return found
}

const files = await pages(APP)
const sources = new Map<string, string>(
  await Promise.all(files.map(async (f) => [f.slice(ROOT.length), await readFile(f, 'utf8')] as const)),
)

const EDITABLE = /editable-region|editable-inline/
const READ_ONLY = /^\s*readOnly\s*$/m

describe('記入できる場所と固定の場所の印', () => {
  test('画面が1枚以上見つかっている（走査が壊れていない）', () => {
    assert.ok(sources.size >= 8, `page.tsx が ${sources.size} 枚しか見つからない`)
  })

  test('「記録を映すだけ」と書いた画面に、記入できる領域が無い', () => {
    const liars = [...sources]
      .filter(([, src]) => READ_ONLY.test(src) && EDITABLE.test(src))
      .map(([path]) => path)
    assert.deepEqual(liars, [],
      '固定と書いてあるのに記入できる領域がある。注記のほうが嘘になっている')
  })

  test('記入できる領域には、必ず印のクラスが付いている', () => {
    // <form action={サーバアクション}> は書き込みの入口である。
    // 検索フォーム（method="get"）は記録を書かないので対象外。
    const unmarked: string[] = []
    for (const [path, src] of sources) {
      // コメントを落としてから走査する。設計の説明として
      // `<form action={...}>` と書いてある行を、実装として数えない。
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      for (const m of code.matchAll(/<form\b[^>]*>/g)) {
        const tag = m[0]
        if (/method="get"/.test(tag)) continue
        if (!/action=\{/.test(tag)) continue
        if (!EDITABLE.test(tag)) unmarked.push(`${path}: ${tag.slice(0, 70)}`)
      }
    }
    assert.deepEqual(unmarked, [],
      '書き込むフォームに editable-region / editable-inline が付いていない')
  })
})

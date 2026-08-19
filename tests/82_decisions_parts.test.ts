import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'

import { parseHeadings, sliceEntry } from '../scripts/decisions-refs.ts'

/**
 * 設計判断は、1件ずつ開ける形になっている（`db/decisions/`）。
 *
 * ★ なぜ固定するか:
 *   `db/DECISIONS.md` は 33万トークン相当の1本で、**AIはこの層を読めない。**
 *   読めない層は参照されず、参照されない層は更新されない ―― 欠番45件はその結果である。
 *   写しが在ることではなく、**写しが本体と一致していること**が要る ――
 *   ずれた写しは、開くほうだけが古くなるので**索引より危ない。**
 *
 * ★ ここでは「一致しているか」だけを見る。生成は `pnpm decisions:parts`。
 */

const DIR = new URL('../db/decisions/', import.meta.url)
const SOURCE = new URL('../db/DECISIONS.md', import.meta.url)

const source = await readFile(SOURCE, 'utf8')
const lines = source.split('\n')
const entries = parseHeadings(source)
const ids = new Set(entries.map((e) => e.id))
const names = (await readdir(DIR)).filter((f) => f.endsWith('.md'))

describe('設計判断の1件1ファイル（db/decisions/）', () => {
  test('★ 本体の番号と、写しのファイルが1対1で対応している', () => {
    const files = new Set(names.filter((f) => f !== 'README.md').map((f) => f.replace(/\.md$/, '')))
    assert.deepEqual([...files].filter((id) => !ids.has(id)), [],
      '本体に無い番号のファイルが残っている ―― 番号を消したのに写しが残ると、参照先が在るように見える')
    assert.deepEqual([...ids].filter((id) => !files.has(id)), [],
      '本体に在る番号の写しが無い ―― `pnpm decisions:parts` で作り直すこと')
  })

  test('★ 写しの本文が、本体の本文と一字一句同じである', async () => {
    for (const e of entries) {
      const part = await readFile(new URL(`${e.id}.md`, DIR), 'utf8')
      assert.ok(part.includes(sliceEntry(lines, e)),
        `${e.id} の本文が本体とずれている ―― 開くほうだけが古い状態になっている`)
    }
  })

  test('★ すべての写しが「生成物である」と先頭で名乗っている', async () => {
    // ★ 名乗らないと、次に触る人が写しを手で直す。直した分は次の生成で消える。
    for (const name of names) {
      const head = (await readFile(new URL(name, DIR), 'utf8')).split('\n')[0] ?? ''
      assert.match(head, /生成物。手で編集しない/, `${name} が生成物と名乗っていない`)
    }
  })

  test('★ 1件のファイルは、文脈に入る大きさに収まっている', async () => {
    // ★ 分割の目的は「開ける大きさにする」ことである。**大きさを見張らないと目的が形骸化する。**
    //   実測の最大は約12KB（C-217）。20KB を超えたら、その記録は分けるべきである。
    // ★ 目次（README.md）は除く ―― 1件の記録ではなく、217件の一覧である。
    //   目次が大きいのは件数のせいで、記録の書きすぎではない。
    const LIMIT = 20 * 1024
    const over: string[] = []
    for (const name of names.filter((f) => f !== 'README.md')) {
      const size = Buffer.byteLength(await readFile(new URL(name, DIR), 'utf8'))
      if (size > LIMIT) over.push(`${name}（${(size / 1024).toFixed(1)}KB）`)
    }
    assert.deepEqual(over, [], `1件で ${LIMIT / 1024}KB を超えている ―― 記録を分けること`)
  })

  test('★ 重複した番号は、両方を1つのファイルに載せて競合を告げている', async () => {
    const dupes = [...new Set(entries.map((e) => e.id))]
      .filter((id) => entries.filter((e) => e.id === id).length > 1)
    assert.ok(dupes.length > 0, '重複が解消されたなら、この検査は消してよい（C-45 / C-46 / C-116）')
    for (const id of dupes) {
      const part = await readFile(new URL(`${id}.md`, DIR), 'utf8')
      assert.match(part, /件の判断に使われている/, `${id} が競合を告げていない`)
      for (const e of entries.filter((x) => x.id === id)) {
        assert.ok(part.includes(sliceEntry(lines, e)), `${id} の片方が落ちている`)
      }
    }
  })

  test('★ 目次から各件へ辿れる', async () => {
    const readme = await readFile(new URL('README.md', DIR), 'utf8')
    for (const id of ids) {
      assert.ok(readme.includes(`](${id}.md)`), `${id} が目次に無い`)
    }
  })
})

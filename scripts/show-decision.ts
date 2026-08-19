import { readFile } from 'node:fs/promises'
import { parseHeadings } from './decisions-refs.ts'

/**
 * 番号を指定して、その設計判断の本文だけを出す。
 *
 * ★ なぜ要るか（AI駆動開発の観点。2026-08-19）:
 *   `db/DECISIONS.md` は **496,136字 ≒ 33万トークン相当**の1本のファイルで、
 *   どの文脈長にも入らない。**AIはこの「なぜ」の層を読めない。**
 *   読めないものは参照されず、参照されないものは更新されない ――
 *   実行⑯・⑰の44件が記録されずに終わったのは、この構造と地続きである。
 *
 *   `CLAUDE.md`（封印下）が `db/DECISIONS.md` を「本体」と名指ししているため、
 *   ファイルを分割するには憲法の書き換えと再封印が要る（人間の判断）。
 *   そこで**分割せずに、開かなくて済むようにする。**
 *
 *     pnpm decisions:show C-176        1件を出す
 *     pnpm decisions:show C-165 C-206  複数まとめて
 *     pnpm decisions:show C-165..C-170 範囲で
 *
 * ★ 索引（`pnpm decisions:index`）が番号から行へ、本書が行から本文へ辿る。
 *   2つ合わせて、全文を読まずに「なぜこの形なのか」へ到達できる。
 */

const SOURCE = new URL('../db/DECISIONS.md', import.meta.url)
const markdown = await readFile(SOURCE, 'utf8')
const lines = markdown.split('\n')
const entries = parseHeadings(markdown)

const args = process.argv.slice(2).filter((a) => !a.startsWith('-'))
if (args.length === 0) {
  console.error('番号を指定する ―― 例: pnpm decisions:show C-176 / C-165..C-170')
  process.exit(1)
}

/** `C-165..C-170` を展開する。番号で参照する設計なので、範囲指定が要る。 */
function expand(arg: string): string[] {
  const range = /^([A-F])-(\d+)\.\.(?:[A-F]-)?(\d+)$/.exec(arg)
  if (!range) return [arg]
  const [, prefix, from, to] = range
  const out: string[] = []
  for (let n = Number(from); n <= Number(to); n++) out.push(`${prefix}-${n}`)
  return out
}

const wanted = args.flatMap(expand)
let missing = 0

for (const id of wanted) {
  // 同じ番号が2件の判断に使われていることがある（C-45 / C-46 / C-116）。
  // 黙って片方を出さない。**全部出して、人間に選ばせる。**
  const hits = entries.filter((e) => e.id === id)
  if (hits.length === 0) {
    console.error(`✘ ${id} ―― db/DECISIONS.md に見出しが無い`)
    console.error(`   参照元から辿るなら: pnpm decisions:missing ${id}`)
    missing++
    continue
  }
  if (hits.length > 1) {
    console.log(`※ ${id} は ${hits.length} 件の判断に使われている（参照先が定まらない）`)
    console.log('')
  }
  for (const hit of hits) {
    // 次の見出しの手前までが本文。見出しの階層は問わない（## と ### が混在する）。
    const next = entries.find((e) => e.line > hit.line)
    const end = next ? next.line - 1 : lines.length
    console.log(`─── ${hit.id} ─── db/DECISIONS.md:${hit.line}`)
    console.log(lines.slice(hit.line - 1, end).join('\n').replace(/\n+$/, ''))
    console.log('')
  }
}

if (missing > 0) process.exit(1)

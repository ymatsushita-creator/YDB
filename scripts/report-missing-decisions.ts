import { readFile } from 'node:fs/promises'
import { collectRefs, findDangling, parseHeadings, REPO } from './decisions-refs.ts'

/**
 * 欠番の下ごしらえ —— **参照元のコードが何と書いているか**を並べる。
 *
 * ★ なぜ要るか:
 *   `C-165`〜`C-212` のうち44個は、本番コードから参照されているのに
 *   `db/DECISIONS.md` に見出しが無い。AIはこれを埋められない
 *   （`CLAUDE.md`「記録にない値の創作」の禁止）。何を決めたのかを知っているのは、
 *   その判断を下した人間だけである。
 *
 *   だが**手がかりはコードの中に残っている。** `app/base.css` が
 *   「題名は画面から隠している（C-176）」と書いているなら、C-176 が何だったかはそこにある。
 *   本書はその行を集めて並べるだけで、**中身を作らない。**
 *
 * ★ 索引（`DECISIONS-INDEX.md`）には載せない。行番号と本文を含むため、
 *   無関係な編集のたびに古くなり、CI の `--check` が本題と関係なく落ちる。
 *   必要なときに `pnpm decisions:missing` で出す。
 */

const markdown = await readFile(new URL('../db/DECISIONS.md', import.meta.url), 'utf8')
const entries = parseHeadings(markdown)
const refs = await collectRefs()
const dangling = findDangling(entries, refs)

if (dangling.length === 0) {
  console.log('欠番なし。参照されている番号はすべて db/DECISIONS.md に見出しがある。')
  process.exit(0)
}

const onlyId = process.argv.find((a) => /^[A-F]-\d+$/.test(a))
const target = onlyId ? dangling.filter((d) => d.id === onlyId) : dangling

/**
 * 参照コメントに残っている「実行⑰」等の手がかり。
 *
 * ★ `docs/reports/` は**実行⑮で止まっている**（REPORT-15.1 が最後）。
 *   一方コードは実行⑯・⑰ を指している。つまり欠番は偶発的な記録漏れではなく、
 *   **2回の実行が、報告書も設計判断も残さずに終わった**結果である。
 *   まとめて思い出せるよう、実行ごとに束ねて出す。
 */
const roundOf = (refs: typeof dangling[number]['refs']): string => {
  for (const r of refs) {
    const m = /実行[①-⑳]/.exec(r.text)
    if (m) return m[0]
  }
  return '（手がかりなし）'
}

console.log(`# 欠番の下ごしらえ —— ${target.length} 件`)
console.log('')
console.log('参照元のコードが何と書いているかを並べたもの。**中身は作っていない。**')
console.log('ここから「何を決めた番号か」を思い出して `db/DECISIONS.md` に見出しを足し、')
console.log('`pnpm decisions:index` で索引を作り直すこと。')
console.log('')

{
  const byRound = new Map<string, string[]>()
  for (const d of target) {
    const k = roundOf(d.refs)
    byRound.set(k, [...(byRound.get(k) ?? []), d.id])
  }
  console.log('## 実行ごとの束')
  console.log('')
  console.log('`docs/reports/` は実行⑮で止まっている。⑯・⑰ は報告書が無い。')
  console.log('')
  for (const [round, ids] of [...byRound.entries()].sort()) {
    console.log(`- **${round}** （${ids.length} 件） ${ids.join(' ')}`)
  }
  console.log('')
}

for (const d of target) {
  console.log(`## ${d.id}`)
  console.log('')
  // 同じ行が複数回拾われることがあるので一意化する。
  const seen = new Set<string>()
  const lines = d.refs.filter((r) => {
    const key = `${r.file}:${r.line}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  for (const r of lines) {
    const path = r.file.startsWith(REPO) ? r.file.slice(REPO.length) : r.file
    console.log(`  ${path}:${r.line}`)
    console.log(`    ${r.text.trim()}`)
  }
  console.log('')
}

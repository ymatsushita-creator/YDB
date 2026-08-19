import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { collectRefs, findDangling, FOREIGN_PREFIXES, HEADING, parseHeadings } from './decisions-refs.ts'
import type { Entry } from './decisions-refs.ts'

/**
 * `db/DECISIONS.md` の索引を作る。
 *
 * ★ なぜ要るか（2026-08-19 の構成診断）:
 *   DECISIONS.md は 8,500行を超える1本のファイルで、`C-121` `C-95` という
 *   参照IDで運用する設計になっている（CLAUDE.md も REPORT も この番号で指す）。
 *   ところが索引が無いため、番号から本文へ辿る手段が grep しか無かった。
 *   人間は目次を作れるが、AIは毎回全文を読むか断片を拾うかになる。
 *   **番号で指す設計なら、番号から引ける表が要る。**
 *
 * ★ 生成物である。手で編集しない（`app/tokens.css` と同じ扱い）。
 *   `pnpm decisions:index` で作り、`--check` でずれを検知する。
 *   CI（quality.yml）が `--check` を回すので、追記して索引を更新し忘れると落ちる。
 *
 * 見出しの形が2つある。歴史的な経緯で、どちらも実在する:
 *   `### C-1. 最終ステップ判定を1箇所に畳んだ`   ← 章立てされていた頃
 *   `## C-192 KPIを期ごとの追記記録として…`      ← 後から平置きで足した分
 * 片方だけ拾うと索引が静かに欠ける。両方を拾う。
 */

const SOURCE = new URL('../db/DECISIONS.md', import.meta.url)
const INDEX = new URL('../db/DECISIONS-INDEX.md', import.meta.url)

/**
 * 同じ番号が2度以上出ている記録を返す。
 *
 * ★ ここで**止めない**。止めると索引が1枚も作れず、重複という事実ごと見えなくなる。
 *   代わりに索引の先頭へ掲げる。番号で参照する設計なのに参照先が定まらない箇所は、
 *   毎回目に入る場所に置いておくのが正しい（黙って振り直すのは、もっと悪い ――
 *   `C-45` は `app/layout.tsx` とコミットメッセージから既に参照されており、
 *   git 履歴の側は後から書き換えられない）。
 */
function findDuplicates(entries: Entry[]): Array<{ id: string; entries: Entry[] }> {
  const byId = new Map<string, Entry[]>()
  for (const e of entries) byId.set(e.id, [...(byId.get(e.id) ?? []), e])
  return [...byId.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([id, group]) => ({ id, entries: group }))
    .sort((a, b) => a.entries[0]!.number - b.entries[0]!.number)
}

const SECTIONS: Array<{ prefix: string; label: string }> = [
  { prefix: 'A', label: 'A. 動かして見つかった不具合' },
  { prefix: 'B', label: 'B. 制約として足したもの' },
  { prefix: 'C', label: 'C. 構造の整理・以後の決定' },
  { prefix: 'D', label: 'D. 確定した仕様' },
  { prefix: 'E', label: 'E. 記録漏れだった差分' },
  { prefix: 'F', label: 'F. 実行環境について' },
]

function render(
  entries: Entry[],
  dupes: ReturnType<typeof findDuplicates>,
  nearMisses: ReturnType<typeof findNearMisses>,
  dangling: Array<{ id: string; from: string[] }>,
): string {
  const out: string[] = [
    '# 設計判断の索引',
    '',
    '**この文書は生成物である。手で編集しない。**',
    '`pnpm decisions:index` で `db/DECISIONS.md` から作る。',
    'CI（`quality.yml`）が `--check` でずれを見るので、追記したら作り直すこと。',
    '',
    `対象: \`db/DECISIONS.md\` / 記録 ${entries.length} 件`,
    '',
    '`C-121` のような番号は、コード内のコメント・`CLAUDE.md`・レポートから参照される。',
    'ここで番号から本文の行へ辿れる。',
    '',
  ]

  if (dupes.length > 0) {
    out.push(
      '## ★ 番号が重複している —— 参照先が定まらない',
      '',
      `${dupes.length} 個の番号が2件以上の判断に使われている。`,
      '**番号で指す設計なのに、指した先が1つに決まらない。**',
      '',
      '振り直しはこの索引の生成側では行わない。番号はコード内のコメントと',
      'コミットメッセージからも参照されており、git 履歴の側は後から直せないからである。',
      'どちらを正とするかは人間が決めて `db/DECISIONS.md` を直すこと。',
      '',
      '| 番号 | 競合している判断 |',
      '|---|---|',
    )
    for (const d of dupes) {
      const list = d.entries.map((e) => `${e.title.replace(/\|/g, '\\|')}（L${e.line}）`).join('<br>')
      out.push(`| \`${d.id}\` | ${list} |`)
    }
    out.push('')
  }
  if (dangling.length > 0) {
    out.push(
      '## ★ 参照先が本文に無い番号',
      '',
      `${dangling.length} 個の番号が、リポジトリ内から参照されているのに \`db/DECISIONS.md\` に見出しが無い。`,
      '**「番号から本文へ辿れる」という前提が、この分だけ成立していない。**',
      '記録が抜けているのか、番号を書き間違えているのかは、人間が本文を見て決める。',
      '',
      'AIはここを埋められない（`CLAUDE.md`「記録にない値の創作」の禁止にあたる）。',
      '何を決めたのかを知っているのは、その判断を下した人間だけである。',
      '**参照元を挙げるので、コードの側から「何を決めた番号だったか」を辿ること。**',
      '',
      '| 番号 | 参照元 |',
      '|---|---|',
      // 行番号は載せない。無関係な編集で行がずれるたびに索引が古くなり、
      // CI の `--check` が本題と関係なく落ちて「検査を緩めろ」という圧力を生む。
      // ファイルまで分かれば grep で足りる。
      ...dangling.map((d) => `| \`${d.id}\` | ${d.from.map((f) => `\`${f}\``).join('<br>')} |`),
      '',
      `別の番号体系として照合から除外: \`${[...FOREIGN_PREFIXES].join('-` / `')}-\``
        + '（`docs/pilot/DEPLOY-READINESS.md` 自身の連番。`db/DECISIONS.md` に見出しは無い）',
      '',
    )
  }
  if (nearMisses.length > 0) {
    out.push(
      '## ★ 見出しの形が違って索引に載らない行',
      '',
      '番号の見出しに見えるが、`## X-9 題名` / `### X-9. 題名` の形でないため拾えていない。',
      '**形を揃えれば索引に載る。**',
      '',
      '| 行 | 記述 |',
      '|---|---|',
      ...nearMisses.map((n) => `| L${n.line} | \`${n.text.replace(/\|/g, '\\|').slice(0, 80)}\` |`),
      '',
    )
  }
  for (const { prefix, label } of SECTIONS) {
    const rows = entries.filter((e) => e.prefix === prefix).sort((a, b) => a.number - b.number)
    if (rows.length === 0) continue
    out.push(`## ${label}`, '', `${rows.length} 件`, '', '| 番号 | 判断 | 行 |', '|---|---|---|')
    for (const r of rows) {
      // 題名に `|` が入るとテーブルが壊れる。エスケープする。
      out.push(`| \`${r.id}\` | ${r.title.replace(/\|/g, '\\|')} | L${r.line} |`)
    }
    out.push('')
  }
  return out.join('\n')
}

/**
 * 拾えなかったが「番号の見出しに見える」行を返す。
 *
 * ★ 黙って捨てない（独立レビュー 2026-08-19 の指摘）。
 *   `##### C-5`（h5）・`# C-6`（h1）・`## C-1: 題名`（コロン）・`## c-12`（小文字）・
 *   題名なしの見出しは、初版では警告も出さずに索引から欠けた。
 *   0件なら「形が変わった」と気付けるが、**1本だけ違う形だと静かに欠ける。**
 */
function findNearMisses(markdown: string): Array<{ line: number; text: string }> {
  const LOOSE = /^#{1,6}\s+[A-Fa-f]-\d+/
  return markdown.split('\n').flatMap((text, i) =>
    LOOSE.test(text) && !HEADING.test(text) ? [{ line: i + 1, text: text.trim() }] : [])
}

const markdown = await readFile(SOURCE, 'utf8')
const entries = parseHeadings(markdown)

if (entries.length === 0) {
  console.error('索引の対象が1件も見つからない。DECISIONS.md の見出しの形が変わった可能性がある。')
  process.exit(1)
}

// 参照の収集は `decisions-refs.ts` に置いてある（`decisions:missing` と共有する）。
// 索引に要るのは出所のファイル名だけなので、行と本文はここで落とす。
// 行番号を索引に載せると、無関係な編集のたびに古くなり `--check` が本題と関係なく落ちる。
const repoRefs = new Map<string, Set<string>>()
for (const [id, refs] of await collectRefs()) {
  repoRefs.set(id, new Set(refs.map((r) => r.file)))
}

const nearMisses = findNearMisses(markdown)
for (const n of nearMisses) {
  console.warn(`⚠ 番号の見出しに見えるが拾えない ―― L${n.line}: ${n.text.slice(0, 60)}`)
}

const dangling = findDangling(entries, repoRefs).map((d) => ({ id: d.id, from: [...d.refs].sort() }))
if (dangling.length > 0) {
  console.warn(`⚠ 参照されているが本文に見出しが無い番号 ―― ${dangling.length} 件: `
    + `${dangling.slice(0, 8).map((d) => d.id).join(', ')}`
    + `${dangling.length > 8 ? ` ほか${dangling.length - 8}件` : ''}`)
}

const dupes = findDuplicates(entries)
for (const d of dupes) {
  // 索引には載せるが、生成のたびに端末へも出す。索引を開かない人にも届かせる。
  console.warn(`⚠ 番号の重複 ―― ${d.id}: ${d.entries.map((e) => `L${e.line}`).join(' / ')}`)
}

const built = render(entries, dupes, nearMisses, dangling)
const check = process.argv.includes('--check')

if (check) {
  const current = await readFile(INDEX, 'utf8').catch(() => null)
  if (current === built) {
    console.log(`索引は最新である（${entries.length} 件）。`)
    process.exit(0)
  }
  console.error(current === null
    ? `索引が無い ―― ${fileURLToPath(INDEX)}`
    : '索引が DECISIONS.md とずれている。')
  console.error('`pnpm decisions:index` で作り直して、生成物も一緒にコミットすること。')
  process.exit(1)
}

await writeFile(INDEX, built, 'utf8')
console.log(`索引を作った ―― ${entries.length} 件 → ${fileURLToPath(INDEX)}`)

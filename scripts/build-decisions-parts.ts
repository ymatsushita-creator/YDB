import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'

import { parseHeadings, sliceEntry } from './decisions-refs.ts'
import type { Entry } from './decisions-refs.ts'

/**
 * `db/DECISIONS.md` を、番号ごとの1件1ファイルへ展開する（`db/decisions/`）。
 *
 * ★ なぜ要るか（AI駆動開発の観点。2026-08-19）:
 *   本体は **496,136字 ≒ 33万トークン相当**の1本で、どの文脈長にも入らない。
 *   **AIはこの「なぜ」の層を読めない。** 読めないものは参照されず、
 *   参照されないものは更新されない ―― 実行⑯・⑰の44件が記録されずに
 *   終わったのは、この構造と地続きである（`.consultant/DIAGNOSIS.md`）。
 *
 *   `pnpm decisions:show` は「開かずに1件を出す」道具だが、**端末を持つ相手にしか効かない。**
 *   AIが最初にやるのは grep とファイルを開くことである。だから
 *   **ファイルの側を、1件ずつ開ける形にしておく。**
 *
 *     db/decisions/C-176.md   2.0KB   ← これを開けば済む
 *     db/DECISIONS.md       496.1KB   ← 開かない
 *
 * ★★ **生成物である。手で編集しない**（`app/tokens.css` / `db/DECISIONS-INDEX.md` と同じ扱い）。★★
 *   正典は `db/DECISIONS.md` のままである ―― `CLAUDE.md`（封印下）が
 *   そこを「設計判断の本体」と名指ししており、**憲法を書き換えずに根治する**形を採った。
 *   記録を足すのは本体へ。`pnpm decisions:parts` で写しを作り直す。
 *   CI（`quality.yml`）が `--check` でずれを落とすので、忘れると赤くなる。
 *
 * ★ 写しなので、参照元の照合からは外してある（`decisions-refs.ts` の `EXCLUDE`）。
 *   外さないと、欠番の参照元が本体と写しで二重に並ぶ。
 */

const SOURCE = new URL('../db/DECISIONS.md', import.meta.url)
const DIR = new URL('../db/decisions/', import.meta.url)

const SECTION_LABEL: Record<string, string> = {
  A: 'A. 動かして見つかった不具合',
  B: 'B. 制約として足したもの',
  C: 'C. 構造の整理・以後の決定',
  D: 'D. 確定した仕様',
  E: 'E. 記録漏れだった差分',
  F: 'F. 実行環境について',
}

/**
 * 1件のファイルの中身。
 *
 * ★ 同じ番号が2件の判断に使われていることがある（`C-45` / `C-46` / `C-116`）。
 *   **黙って片方を捨てない。** 1つのファイルに両方入れ、先頭で競合を告げる ――
 *   番号で指す設計なのに指した先が定まらないことは、開いた人に必ず見えるべきである。
 */
function renderPart(id: string, hits: Entry[], lines: readonly string[]): string {
  const out: string[] = [
    `<!-- 生成物。手で編集しない。正典は db/DECISIONS.md（pnpm decisions:parts で作る） -->`,
    '',
    `# ${id}`,
    '',
    // ★ 節（`## F. 実行環境について`）は書かない。本体は 1941行目以降が
    //   すべて F 節の中に在り、**C 番号の記録まで F に属して見える。**
    //   分類は接頭辞（`C-`）が持っている ―― 器の位置ではなく番号で言う。
    `出典: \`db/DECISIONS.md\` ${hits.map((h) => `L${h.line}`).join(' / ')}`
      + ` ・ 分類 ${SECTION_LABEL[id[0]!] ?? id[0]!}`,
    '',
  ]
  if (hits.length > 1) {
    out.push(
      `> ★ **この番号は ${hits.length} 件の判断に使われている。参照先が1つに決まらない。**`,
      '> どちらを正とするかは人間が決めて `db/DECISIONS.md` を直す。',
      '> 振り直しは生成側では行わない ―― 番号はコード内のコメントと',
      '> コミットメッセージからも参照されており、git 履歴の側は後から直せない。',
      '',
    )
  }
  for (const hit of hits) {
    out.push(sliceEntry(lines, hit), '')
  }
  return out.join('\n').replace(/\n+$/, '') + '\n'
}

const markdown = await readFile(SOURCE, 'utf8')
const lines = markdown.split('\n')
const entries = parseHeadings(markdown)

if (entries.length === 0) {
  console.error('展開の対象が1件も見つからない。DECISIONS.md の見出しの形が変わった可能性がある。')
  process.exit(1)
}

const byId = new Map<string, Entry[]>()
for (const e of entries) byId.set(e.id, [...(byId.get(e.id) ?? []), e])

const files = new Map<string, string>()
for (const [id, hits] of byId) files.set(`${id}.md`, renderPart(id, hits, lines))

// 目次。**ここには行番号を載せない** ―― 無関係な編集で古くなり、`--check` が
// 本題と関係なく落ちる（索引で同じ失敗をしている。`build-decisions-index.ts`）。
const readme: string[] = [
  '<!-- 生成物。手で編集しない。正典は db/DECISIONS.md（pnpm decisions:parts で作る） -->',
  '',
  '# 設計判断 —— 1件1ファイル',
  '',
  '**この階層は生成物である。手で編集しない。**',
  '正典は `db/DECISIONS.md`（設計判断の本体）。記録を足すのはそちらで、',
  'そのあと `pnpm decisions:parts` で作り直す。CI が `--check` でずれを見る。',
  '',
  '## なぜ在るか',
  '',
  '`db/DECISIONS.md` は 1 本で 33万トークン相当あり、**どの文脈長にも入らない。**',
  '読めない層は参照されず、参照されない層は更新されない ―― 欠番45件はその結果である。',
  '番号ごとに割ってあるので、**1件だけ開けば済む。**',
  '',
  '```',
  'db/decisions/C-176.md      1件だけ読む（AIも人も、開くのはここ）',
  'pnpm decisions:show C-176  端末から1件を出す（同じ内容）',
  'db/DECISIONS-INDEX.md      番号 → 題名の索引',
  'db/DECISIONS.md            正典。**開かない**',
  '```',
  '',
  `## 記録 ${byId.size} 件`,
  '',
]
for (const [prefix, label] of Object.entries(SECTION_LABEL)) {
  const rows = [...byId.entries()]
    .filter(([id]) => id.startsWith(`${prefix}-`))
    .sort((a, b) => Number(a[0].slice(2)) - Number(b[0].slice(2)))
  if (rows.length === 0) continue
  readme.push(`### ${label}`, '', `${rows.length} 件`, '', '| 番号 | 判断 |', '|---|---|')
  for (const [id, hits] of rows) {
    const title = hits.map((h) => h.title.replace(/\|/g, '\\|')).join(' ／ ')
    readme.push(`| [\`${id}\`](${id}.md) | ${title}${hits.length > 1 ? ' ★重複' : ''} |`)
  }
  readme.push('')
}
files.set('README.md', readme.join('\n').replace(/\n+$/, '') + '\n')

const check = process.argv.includes('--check')

if (check) {
  const present = new Set(await readdir(DIR).catch(() => [] as string[]))
  const stale = [...present].filter((f) => !files.has(f))
  const diffs: string[] = []
  for (const [name, body] of files) {
    const current = await readFile(new URL(name, DIR), 'utf8').catch(() => null)
    if (current !== body) diffs.push(name)
  }
  if (diffs.length === 0 && stale.length === 0) {
    console.log(`db/decisions/ は最新である（${byId.size} 件）。`)
    process.exit(0)
  }
  if (diffs.length > 0) {
    console.error(`✘ db/decisions/ が本体とずれている ―― ${diffs.length} 件: `
      + `${diffs.slice(0, 8).join(', ')}${diffs.length > 8 ? ` ほか${diffs.length - 8}件` : ''}`)
  }
  if (stale.length > 0) {
    console.error(`✘ 本体に無いファイルが残っている ―― ${stale.length} 件: ${stale.slice(0, 8).join(', ')}`)
  }
  console.error('`pnpm decisions:parts` で作り直すこと。**写しの側を手で直さない。**')
  process.exit(1)
}

// 作り直しは**消してから**書く。番号を消したときに古いファイルが残ると、
// 参照先が本体に無いのに開ける状態になり、**索引より写しのほうが新しく見える。**
await rm(DIR, { recursive: true, force: true })
await mkdir(DIR, { recursive: true })
for (const [name, body] of files) await writeFile(new URL(name, DIR), body)

console.log(`db/decisions/ を作った ―― ${byId.size} 件 ＋ README.md`)

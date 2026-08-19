import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

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

/** 見出し1行から拾った記録。`line` は1始まり（エディタの行番号と揃える）。 */
type Entry = { id: string; prefix: string; number: number; title: string; line: number }

/**
 * `## C-192 題名` / `### C-1. 題名` の両方を拾う。
 * 番号の直後は `.` か空白のどちらでもよいが、`C-1a` のような続きは拾わない
 * （`(?![0-9])` ではなく `[.\s]` を要求することで、`C-19` が `C-192` に化けない）。
 */
const HEADING = /^#{2,4}\s+([A-F])-(\d+)[.\s]\s*(.+?)\s*$/

function parse(markdown: string): Entry[] {
  const entries: Entry[] = []
  markdown.split('\n').forEach((text, i) => {
    const m = HEADING.exec(text)
    if (!m) return
    const [, prefix, digits, title] = m
    entries.push({
      id: `${prefix}-${digits}`,
      prefix: prefix!,
      number: Number(digits),
      // `(.+?)\s*$` で末尾空白は既に落ちている。★は「影響大」の目印なので残す。
      title: title!,
      line: i + 1,
    })
  })
  return entries
}

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
  dangling: ReturnType<typeof findDanglingRefs>,
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

/**
 * 別の番号体系。`docs/pilot/DEPLOY-READINESS.md` が自分の連番として `B-1`〜`B-7` を使い、
 * `db/DECISIONS.md` 自身がそれを「`DEPLOY-READINESS.md` B-3」と出典付きで引いている（L2571）。
 * `db/DECISIONS.md` に `B-` の見出しは**1件も無い**。欠番ではなく、別の文書の番号である。
 * 欠番として毎回掲げると、人間が本物のほうを読み飛ばす。
 */
const FOREIGN_PREFIXES = new Set(['B'])

/**
 * 本文から参照されているのに、見出しが存在しない番号を返す。
 *
 * ★「番号から本文へ辿れる」という索引の前提が、実際に成立しているかを見る。
 *
 * ★ 並び順は**接頭辞 → 番号**で決める。番号だけで比べていた初版では `D-30` が
 *   `C-165` より前に来ており、さらに同番異接頭辞（`A-256` と `C-256`）が同順位になって、
 *   Map の挿入順＝`git grep` の出力順に依存していた。**`--check` が環境で揺れる。**
 */
function findDanglingRefs(
  entries: Entry[],
  repoRefs: Map<string, Set<string>>,
): Array<{ id: string; from: string[] }> {
  const known = new Set(entries.map((e) => e.id))
  return [...repoRefs.entries()]
    .filter(([id]) => !known.has(id) && !FOREIGN_PREFIXES.has(id[0]!))
    .map(([id, from]) => ({ id, from: [...from].sort() }))
    .sort((a, b) =>
      a.id[0]!.localeCompare(b.id[0]!) || Number(a.id.slice(2)) - Number(b.id.slice(2)))
}

const markdown = await readFile(SOURCE, 'utf8')
const entries = parse(markdown)

if (entries.length === 0) {
  console.error('索引の対象が1件も見つからない。DECISIONS.md の見出しの形が変わった可能性がある。')
  process.exit(1)
}

// リポジトリ内から参照されている番号を集める（コード・文書。生成物と履歴は対象外）。
const repoRefs = new Map<string, Set<string>>()
{
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const run = promisify(execFile)

  // ★ 照合から外す経路（2026-08-19 の再検証で判明した自己参照）:
  //   `db/DECISIONS-INDEX.md`  生成物。欠番リストを本文に持つため、自分が数えた欠番を
  //                            次回の入力として読み返す。**欠番が自己維持する。**
  //   `.consultant/`           この問題を記述した診断文書。欠番の話を書き足しただけで
  //                            件数が 53→54 へ増えた。**測る対象に測定の記録が混ざる。**
  //                            境界判定を入れると、残る `A-256` は「`SHA-256` を `A-256` と
  //                            読む誤検知」と書いた一文だけになる。
  //   このファイル自身          下の docstring が `C-165`〜`C-212` を引いている。
  const EXCLUDE = [':!db/DECISIONS-INDEX.md', ':!.consultant/', ':!scripts/build-decisions-index.ts']

  try {
    // ★ `-I` でバイナリを外す。付けないと `Binary file public/brand/logo_gradient.png matches`
    //   という**行そのものが番号として索引へ入り**、`Number(id.slice(2))` が NaN になって
    //   ソートの比較子が壊れる（実測済み）。
    // ★ `-h` / `-o` は使わない。出所を捨ててしまい、欠番を埋める人間に手がかりが残らない。
    //   `-H` で（対象が1本になっても）ファイル名を必ず前置させる。
    const { stdout } = await run('git', ['grep', '-I', '-H', '-E', '[A-F]-[0-9]+', '--', '.', ...EXCLUDE],
      { cwd: fileURLToPath(new URL('..', import.meta.url)), maxBuffer: 32 * 1024 * 1024 })

    // ★ 境界はここで見る。`\b` は macOS の git（POSIX ERE）で効かないため、
    //   git 側に任せると `SHA-256` が `A-256` として拾われる。
    //   **初版はこの但し書きだけを書いて、判定を実装していなかった。**
    //   前は英数字でないこと、後ろは数字でないことを要求する。
    const REF = /(?<![0-9A-Za-z])([A-F])-([0-9]+)(?![0-9])/g
    for (const line of stdout.split('\n')) {
      const sep = line.indexOf(':')
      if (sep < 0) continue
      const file = line.slice(0, sep)
      for (const m of line.slice(sep + 1).matchAll(REF)) {
        repoRefs.set(`${m[1]}-${m[2]}`, (repoRefs.get(`${m[1]}-${m[2]}`) ?? new Set()).add(file))
      }
    }
  } catch { /* git が無い / 追跡外。参照の照合はできない */ }
}

const nearMisses = findNearMisses(markdown)
for (const n of nearMisses) {
  console.warn(`⚠ 番号の見出しに見えるが拾えない ―― L${n.line}: ${n.text.slice(0, 60)}`)
}

const dangling = findDanglingRefs(entries, repoRefs)
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

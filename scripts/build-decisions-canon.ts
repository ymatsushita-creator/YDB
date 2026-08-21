import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 正典 `db/DECISIONS.md` を、節ごとの原稿（`db/decisions-src/`）から組み立てる。
 *
 * ★ なぜ要るか（`Hitler.md` §2「1ファイル200行を超えたら分割する」。C-234）:
 *   正典は 9,600行あり、§2 の上限を **48倍**超えていた。`Hitler.md` §0 は
 *   「分割しない ―― 正典のパスを動かすと番号の参照先が全部切れる」と逸脱を宣言していた。
 *   **パスを動かさずに分割する方法がある。** 原稿を節ごとに割り、正典をその連結として
 *   生成する。`db/DECISIONS.md` は同じ場所に同じ内容で在り続けるので、
 *   git 履歴・コード内コメント・索引・`decisions:show` の参照は1つも切れない。
 *
 * ★ **書くのは原稿の側**（`db/decisions-src/NN-*.md`）。正典は生成物になった。
 *   `db/decisions/<番号>.md` は正典から作る写しで、これまでと変わらない。
 *
 * ★ 連結は**バイト単位で往復する。** 分割時の境界をそのまま繋ぐので、
 *   生成物は分割前と1バイトも変わらない（`--check` がそれを毎回確かめる）。
 *
 *     node scripts/build-decisions-canon.ts --split    原稿を作る（初回のみ）
 *     node scripts/build-decisions-canon.ts            正典を組み立て直す
 *     node scripts/build-decisions-canon.ts --check     ずれていたら落とす
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CANON = join(ROOT, 'db/DECISIONS.md')
// ★ `db/DECISIONS/` にしない。macOS の既定は大小文字を区別せず、
//   既存の `db/decisions/`（写し）と衝突する。
const SRC = join(ROOT, 'db/decisions-src')

const _HEADER = '<!-- 生成物。手で編集しない。原稿は db/decisions-src/（pnpm decisions:canon で作る） -->\n'

/** 節の境界は行頭 `## ` の最上位見出し。番号の見出し（`### A-1.`）では割らない。 */
function split(): void {
  const body = readFileSync(CANON, 'utf8')
  const lines = body.split('\n')
  const cuts: number[] = []
  // 節（`## A. …`）と、番号の見出し（`### A-1. …`）の両方で割る。
  // 節だけで割ると F 節が 6,247行になり、§2 の 200行を満たせない
  // （本体の 1941行目以降はすべて F 節の中に在る）。
  lines.forEach((l, i) => { if (/^## /.test(l) || /^### [A-G]-\d/.test(l)) cuts.push(i) })
  mkdirSync(SRC, { recursive: true })
  const parts: Array<[string, string]> = []
  const first = cuts[0] ?? lines.length
  parts.push(['00-preamble.md', lines.slice(0, first).join('\n')])
  cuts.forEach((start, n) => {
    const end = cuts[n + 1] ?? lines.length
    const title = lines[start]!.replace(/^##\s+/, '').trim()
    // 見出しから機械可読な名前を作る。節記号（`A.`）があればそれを使う。
    // 見出しの先頭語を名前にする（`## C-230 …` → `C-230`、`## A. …` → `A`）。
    const tag = (/^([A-Z])\./.exec(title)?.[1] ?? /^([A-Za-z0-9-]+)/.exec(title)?.[1] ?? 'section')
      .replace(/[^A-Za-z0-9-]/g, '')
    parts.push([`${String(n + 1).padStart(3, '0')}-${tag}.md`, lines.slice(start, end).join('\n')])
  })
  for (const [name, text] of parts) writeFileSync(join(SRC, name), text)
  console.log(`原稿 ${parts.length} 本へ割った（${SRC}）`)
}

function assemble(): string {
  const names = readdirSync(SRC).filter((f) => f.endsWith('.md')).sort()
  return names.map((f) => readFileSync(join(SRC, f), 'utf8')).join('\n')
}

const mode = process.argv[2]
if (mode === '--split') { split(); process.exit(0) }
if (!existsSync(SRC)) { console.error(`原稿が無い。まず --split を回す（${SRC}）`); process.exit(1) }

const built = assemble()
const current = existsSync(CANON) ? readFileSync(CANON, 'utf8') : ''
if (mode === '--check') {
  if (built === current) { console.log('正典は原稿と一致している'); process.exit(0) }
  console.error('`db/DECISIONS.md` が原稿とずれている ―― `pnpm decisions:canon` で組み立て直すこと。')
  console.error('（正典は生成物である。書くのは `db/decisions-src/` の側）')
  process.exit(1)
}
writeFileSync(CANON, built)
console.log(`正典を組み立てた（${built.length.toLocaleString()} 字）`)

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 構成基準 `.consultant/STRUCTURE.md` を、節ごとの原稿から組み立てる（C-235）。
 *
 * ★ なぜ要るか: `Hitler.md` §2 の「1ファイル200行」を、基準書自身が満たしていなかった
 *   （302行。§0 が「S1〜S13 を1本で持つため」として逸脱を宣言していた）。
 *   **正典 `db/DECISIONS.md` と同じ形で閉じる** —— 原稿を節ごとに割り、
 *   `.consultant/STRUCTURE.md` はその連結（生成物）にする。**パスを動かさない**ので、
 *   S11（文書と実装の一致）・`README.md`・`.claude/commands/structure.md` の参照は切れない。
 *
 *     node scripts/build-structure-canon.ts --split   原稿を作る（初回のみ）
 *     node scripts/build-structure-canon.ts           組み立て直す
 *     node scripts/build-structure-canon.ts --check    ずれていたら落とす
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CANON = join(ROOT, '.consultant/STRUCTURE.md')
const SRC = join(ROOT, '.consultant/structure-src')

function split(): void {
  const lines = readFileSync(CANON, 'utf8').split('\n')
  const cuts: number[] = []
  lines.forEach((l, i) => { if (/^## /.test(l)) cuts.push(i) })
  mkdirSync(SRC, { recursive: true })
  const parts: Array<[string, string]> = [['000-preamble.md', lines.slice(0, cuts[0] ?? lines.length).join('\n')]]
  cuts.forEach((start, n) => {
    const end = cuts[n + 1] ?? lines.length
    // 検査ID（`〔S13〕`）を名前に採る。節番号は本文中で入れ替わっているため当てにしない。
    const title = lines[start]!
    const tag = /〔(S[0-9a-b・]+)〕/.exec(title)?.[1]?.replace(/[・]/g, '-') ?? `sec${n + 1}`
    parts.push([`${String(n + 1).padStart(3, '0')}-${tag}.md`, lines.slice(start, end).join('\n')])
  })
  for (const [name, text] of parts) writeFileSync(join(SRC, name), text)
  console.log(`原稿 ${parts.length} 本へ割った（${SRC}）`)
}

const assemble = () =>
  readdirSync(SRC).filter((f) => f.endsWith('.md')).sort()
    .map((f) => readFileSync(join(SRC, f), 'utf8')).join('\n')

const mode = process.argv[2]
if (mode === '--split') { split(); process.exit(0) }
if (!existsSync(SRC)) { console.error(`原稿が無い。まず --split を回す（${SRC}）`); process.exit(1) }

const built = assemble()
const current = readFileSync(CANON, 'utf8')
if (mode === '--check') {
  if (built === current) { console.log('構成基準は原稿と一致している'); process.exit(0) }
  console.error('`.consultant/STRUCTURE.md` が原稿とずれている ―― `pnpm structure:canon` で組み立て直すこと。')
  console.error('（基準書は生成物である。書くのは `.consultant/structure-src/` の側）')
  process.exit(1)
}
writeFileSync(CANON, built)
console.log(`構成基準を組み立てた（${built.split('\n').length} 行）`)

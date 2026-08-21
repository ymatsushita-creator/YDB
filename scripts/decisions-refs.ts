import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

/**
 * `db/DECISIONS.md` の見出しと、リポジトリ内からの参照を突き合わせる部品。
 *
 * ★ なぜ切り出すか:
 *   索引の生成（`build-decisions-index.ts`）と、欠番の下ごしらえ
 *   （`report-missing-decisions.ts`）が同じ照合をする。写すと必ずどちらかが古くなる ——
 *   このリポジトリで繰り返し起きている形なので、1箇所に置く。
 */

const run = promisify(execFile)
export const REPO = fileURLToPath(new URL('..', import.meta.url))

/**
 * `## C-192 題名` / `### C-1. 題名` の両方を拾う。
 * 番号の直後は `.` か空白のどちらでもよいが、`C-1a` のような続きは拾わない
 * （`[.\s]` を要求することで、`C-19` が `C-192` に化けない）。
 */
export const HEADING = /^#{2,4}\s+([A-F])-(\d+)[.\s]\s*(.+?)\s*$/

/**
 * 参照を拾う境界。`\b` は macOS の git（POSIX ERE）で効かないので、
 * git 側に任せず取得後にここで見る。前は英数字でないこと、後ろは数字でないこと。
 * これが無いと `SHA-256` が `A-256` として拾われる。
 */
export const REF = /(?<![0-9A-Za-z])([A-F])-([0-9]+)(?![0-9])/g

/**
 * 別の番号体系。`docs/pilot/DEPLOY-READINESS.md` が自分の連番として `B-1`〜`B-7` を使い、
 * `db/DECISIONS.md` 自身がそれを「`DEPLOY-READINESS.md` B-3」と出典付きで引いている。
 * `db/DECISIONS.md` に `B-` の見出しは1件も無い。欠番ではなく、別の文書の番号である。
 */
export const FOREIGN_PREFIXES = new Set(['B'])

/**
 * 照合から外す経路（自己参照）。
 *   `db/DECISIONS-INDEX.md`  生成物。欠番リストを本文に持つため自分の出力を読み返す
 *   `db/decisions/`          生成物。`db/DECISIONS.md` の写しなので、独立した参照元ではない
 *                            （外さないと欠番の参照元が本体と写しで二重に並ぶ）
 *   `.consultant/`           この問題を記述した診断文書。書き足すと件数が動いた
 *   `docs/consultant/`       同上（診断の経緯）。`.consultant/` から出した先で、
 *                            除外し忘れて件数が 45→47 に戻った（実測）
 *   `scripts/decisions-*` `scripts/show-decision.ts`
 *                            照合そのものを実装・説明しているファイル
 *
 * ★ **番号について書いた文書は、番号の参照元ではない。** ここを1つ外すたびに
 *   件数が動く。経路を増やすときは必ずこの表に足す。
 */
export const EXCLUDE = [':!db/DECISIONS-INDEX.md', ':!db/decisions/', ':!.consultant/', ':!docs/consultant/',
  ':!scripts/build-decisions-index.ts', ':!scripts/decisions-refs.ts',
  ':!scripts/report-missing-decisions.ts', ':!scripts/show-decision.ts']

/** 見出しから拾った記録。`line` は1始まり（エディタの行番号と揃える）。 */
export type Entry = { id: string; prefix: string; number: number; title: string; line: number }

export function parseHeadings(markdown: string): Entry[] {
  const entries: Entry[] = []
  markdown.split('\n').forEach((text, i) => {
    const m = HEADING.exec(text)
    if (!m) return
    const [, prefix, digits, title] = m
    entries.push({ id: `${prefix}-${digits}`, prefix: prefix!, number: Number(digits),
      title: title!, line: i + 1 })
  })
  return entries
}

/** 参照1件。どのファイルの何行目に、どう書かれていたか。 */
export type Ref = { file: string; line: number; text: string }

/**
 * リポジトリ内から参照されている番号を集める。
 *
 * `-I` でバイナリを外す（付けないと `Binary file … matches` の行そのものが
 * 番号として入り、`Number(id.slice(2))` が NaN になってソートが壊れる）。
 * `-H -n` で出所と行を残す（`-h`/`-o` は手がかりを捨ててしまう）。
 */
export async function collectRefs(): Promise<Map<string, Ref[]>> {
  const refs = new Map<string, Ref[]>()
  try {
    const { stdout } = await run('git',
      ['grep', '-I', '-H', '-n', '-E', '[A-F]-[0-9]+', '--', '.', ...EXCLUDE],
      { cwd: REPO, maxBuffer: 64 * 1024 * 1024 })
    for (const raw of stdout.split('\n')) {
      // `path:line:content`。path に `:` は無い前提でよいが、content には有りうる。
      const first = raw.indexOf(':')
      if (first < 0) continue
      const second = raw.indexOf(':', first + 1)
      if (second < 0) continue
      const file = raw.slice(0, first)
      const line = Number(raw.slice(first + 1, second))
      const text = raw.slice(second + 1)
      if (!Number.isFinite(line)) continue
      for (const m of text.matchAll(REF)) {
        const id = `${m[1]}-${m[2]}`
        refs.set(id, [...(refs.get(id) ?? []), { file, line, text }])
      }
    }
  } catch { /* git が無い / 追跡外。参照の照合はできない */ }
  return refs
}

/**
 * 参照されているのに見出しが無い番号。
 * 並びは**接頭辞 → 番号**。番号だけで比べると同番異接頭辞が同順位になり、
 * Map の挿入順＝`git grep` の出力順に依存して結果が環境で揺れる。
 */
export function findDangling<T>(entries: Entry[], refs: Map<string, T>): Array<{ id: string; refs: T }> {
  const known = new Set(entries.map((e) => e.id))
  return [...refs.entries()]
    .filter(([id]) => !known.has(id) && !FOREIGN_PREFIXES.has(id[0]!))
    .map(([id, r]) => ({ id, refs: r }))
    .sort((a, b) =>
      a.id[0]!.localeCompare(b.id[0]!) || Number(a.id.slice(2)) - Number(b.id.slice(2)))
}

/** 節の見出し（`## A. 動かして見つかった不具合`）。番号の見出しではない。 */
export const SECTION_HEADING = /^##\s+([A-F])\.\s*(.+?)\s*$/

/**
 * 1件の本文を切り出す。
 *
 * ★ 終わりは「次の番号の見出し」だけでは足りない ―― 節の最後の記録は、
 *   次の節見出し（`## D. 確定した仕様`）まで飲み込んでしまう。
 *   番号の見出しと節の見出しの**両方**で止める。
 * ★ 末尾の区切り（`---`）と空行は落とす。記録そのものではない。
 */
export function sliceEntry(lines: readonly string[], entry: Entry): string {
  let end = lines.length
  for (let i = entry.line; i < lines.length; i++) {
    const text = lines[i]!
    if (HEADING.test(text) || SECTION_HEADING.test(text) || /^#\s/.test(text)) { end = i; break }
  }
  const body = lines.slice(entry.line - 1, end)
  while (body.length > 0 && /^(\s*|-{3,})$/.test(body[body.length - 1]!)) body.pop()
  return body.join('\n')
}

/**
 * 欠番のラチェット（S13）。台帳と現状を突き合わせる。
 *
 * ★ **判定をここに置く理由**: 検査側（`check-structure.ts`）に埋めると、
 *   条件を緩めたことをテストで捕まえられない
 *   （文字列が含まれるかで見る検査は、独立レビューに素通りされた実績がある）。
 *   純粋な関数にして、`tests/83_dangling_ratchet.test.ts` が**動作で**固定する。
 *
 * ★ 増えたら落とす。**減っても落とす** ―― 締め忘れた台帳は
 *   「45件のままだ」と嘘をつき、次に増えた1件を隠す。
 */
export function ratchet(listed: Iterable<string>, current: Iterable<string>): {
  ok: boolean; added: string[]; filled: string[]
} {
  const ledger = new Set(listed)
  const now = [...current]
  const nowSet = new Set(now)
  const byId = (a: string, b: string) =>
    a[0]!.localeCompare(b[0]!) || Number(a.slice(2)) - Number(b.slice(2))
  const added = now.filter((id) => !ledger.has(id)).sort(byId)
  const filled = [...ledger].filter((id) => !nowSet.has(id)).sort(byId)
  return { ok: added.length === 0 && filled.length === 0, added, filled }
}

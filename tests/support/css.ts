import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

/**
 * 画面のCSSを、取り込み順どおりに1本へ合成して返す。
 *
 * ★ なぜ要るか（2026-08-19）:
 *   `app/base.css` は 2,366行の1本だった。設計判断（`C-` 番号）の参照が28箇所あり、
 *   1行直すたびに全体を読むことになっていたため `app/_styles/` へ分割した。
 *   分割で `base.css` 自体は `@import` の並びになり、**規則の本体は別ファイルへ移った。**
 *
 *   テストは「この規則が在るか」を見ている。見るべきは
 *   **ブラウザが受け取る1本**であって、入口のファイルではない。
 *   ここで `@import` を解決して合成する。以後どう割り直しても、テストは追随する。
 */

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))

/** `@import './x.css';` を、書かれた順に読み替える。入れ子も辿る。 */
async function inline(path: string, seen = new Set<string>()): Promise<string> {
  if (seen.has(path)) return '' // 循環したら二度読まない
  seen.add(path)
  const body = await readFile(path, 'utf8')
  const parts: string[] = []
  let rest = body
  const RE = /@import\s+(?:url\()?['"]([^'"]+)['"]\)?\s*;/
  for (;;) {
    const m = RE.exec(rest)
    if (!m) break
    parts.push(rest.slice(0, m.index))
    parts.push(await inline(join(dirname(path), m[1]!), seen))
    rest = rest.slice(m.index + m[0].length)
  }
  parts.push(rest)
  return parts.join('\n')
}

/** `app/<name>` を合成して返す。既定は画面のCSS（`base.css`）。 */
export const appCss = (name = 'base.css') => inline(join(ROOT, 'app', name))

/** 分割された断片の一覧。「どこに書くか」を検査したいときに使う。 */
export async function styleParts(): Promise<string[]> {
  return (await readdir(join(ROOT, 'app', '_styles'))).filter((f) => f.endsWith('.css')).sort()
}

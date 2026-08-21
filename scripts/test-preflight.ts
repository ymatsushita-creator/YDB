import { readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

/**
 * テストを走らせる前に、**走る対象が実在すること**を確かめる。
 *
 * ★ なぜ要るか（独立レビュー 2026-08-19 で実証された欠陥）:
 *
 *   1. `node --test` は**対象が0件でも exit 0 を返す。**
 *      テストを全部消す・`tests/` を改名する・拡張子を変える —— いずれでもCIは緑になる。
 *      `.consultant/STRUCTURE.md` §7 が `--passWithNoTests` を禁じているのに、
 *      既定の挙動がまさにそれだった。
 *
 *   2. `tests/**\/*.test.ts` は npm が `sh` で実行する。**`sh` に globstar は無い。**
 *      `**` は `*` として扱われ、パターンは実質 `tests/*\/*.test.ts` になる。
 *      いま .test.ts は全て `tests/` 直下にあるのでマッチ0件になり、
 *      パターンが**文字列のまま node へ渡って** node 側の展開で 887 件が走っていた。
 *      つまり「たまたま」動いていた。
 *      `tests/support/` のようなサブディレクトリへテストを1本置いた瞬間、
 *      sh の展開が成功し、**既存の84本は node に渡らず静かに消える。**
 *      → `package.json` 側でグロブを**引用符で囲い**、展開を必ず node に行わせる。
 *        ここではその前提が崩れていないかを、実際に数えて確かめる。
 *
 * 数の下限は置かない（テストを減らす正当な変更を妨げるため）。
 * 見るのは「1件も無い」と「node が拾う数と実在数がずれている」の2つだけである。
 */

const TESTS = fileURLToPath(new URL('../tests', import.meta.url))

/** `tests/` 配下の `*.test.ts` を再帰的に数える。深さを問わず全部拾う。 */
function collect(dir: string): string[] {
  const found: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) found.push(...collect(path))
    else if (name.endsWith('.test.ts')) found.push(path)
  }
  return found
}

const files = collect(TESTS)

if (files.length === 0) {
  console.error('テストが1件も見つからない ―― tests/**/*.test.ts')
  console.error('`node --test` は対象0件でも成功を返す。ここで止める。')
  console.error('意図してテストを消したなら、この検査ごと消すのではなく理由を記録すること。')
  process.exit(1)
}

// サブディレクトリにテストが現れたら、グロブ展開が sh 側へ移りうる。
// `package.json` が引用符でグロブを囲っていれば安全だが、囲いが外されると
// 直下の84本が丸ごと沈黙する。囲いの有無をここで見る。
const nested = files.filter((f) => f.slice(TESTS.length + 1).includes('/'))
if (nested.length > 0) {
  const pkg = JSON.parse(
    await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../package.json', import.meta.url), 'utf8')),
  ) as { scripts?: Record<string, string> }
  const script = pkg.scripts?.test ?? ''
  const quoted = /["'][^"']*\*\*[^"']*["']/.test(script)
  if (!quoted) {
    console.error(`サブディレクトリのテストが ${nested.length} 件ある一方で、`)
    console.error('`package.json` の test スクリプトがグロブを引用符で囲っていない。')
    console.error('この状態では sh がグロブを展開し、tests/ 直下のテストが node へ渡らない。')
    console.error('（消えるのではなく「走らないまま成功する」ので、CIは緑のまま気付けない）')
    process.exit(1)
  }
}

console.log(`テスト対象 ${files.length} ファイル（うちサブディレクトリ ${nested.length}）。`)

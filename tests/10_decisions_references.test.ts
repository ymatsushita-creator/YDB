import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

/**
 * DECISIONS.md が挙げているテストが、本当に存在するかを確かめる。
 *
 * DECISIONS.md の冒頭にはこう書いてある。
 *
 *   各項目の末尾に、その判断を固定しているテストを示す。
 *   テストのない判断は、次に触る人が理由を知らないまま壊せてしまう。
 *
 * 監査でこの宣言が破れていた。B 節の11個の制約に対して
 * `→ tests/05_constraints.test.ts` と1行だけ書いてあり、
 * 実際にテストがあったのは5件だけだった。参照が嘘だと、
 * 読んだ人は「検証済み」と思って確認をやめる。記録が無いより悪い。
 *
 * 人が見直す運用に戻すと同じことが起きるので、機械が見る。
 */

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const TESTS_DIR = join(ROOT, 'tests')

const decisions = await readFile(join(ROOT, 'db/DECISIONS.md'), 'utf8')
const testFiles = (await readdir(TESTS_DIR)).filter((f) => f.endsWith('.test.ts'))
const contents = new Map<string, string>(
  await Promise.all(
    testFiles.map(async (f) => [f, await readFile(join(TESTS_DIR, f), 'utf8')] as const),
  ),
)

/** `tests/05_constraints.test.ts` の形の参照。 */
const fileRefs = [...decisions.matchAll(/`tests\/([0-9]{2}_[a-z_]+\.test\.ts)`/g)]
/** `tests/05_...`「テスト名」 と `05「テスト名」` の両方の形。 */
const namedRefs = [
  ...decisions.matchAll(/`tests\/([0-9]{2})_[a-z_]+\.test\.ts`\s*「([^」]+)」/g),
  ...decisions.matchAll(/(?:^|[|\s])([0-9]{2})「([^」]+)」/gm),
]

describe('DECISIONS.md のテスト参照', () => {
  test('参照しているテストファイルが実在する', () => {
    assert.ok(fileRefs.length > 0, '参照が1つも抽出できていない（正規表現が壊れている）')
    const missing = [...new Set(fileRefs.map((m) => m[1]!))].filter((f) => !contents.has(f))
    assert.deepEqual(missing, [], `DECISIONS.md が存在しないテストファイルを指している`)
  })

  test('参照しているテスト名が実在する', () => {
    assert.ok(namedRefs.length > 0, 'テスト名の参照が1つも抽出できていない')

    const missing: string[] = []
    for (const m of namedRefs) {
      const prefix = m[1]!
      const name = m[2]!
      const file = testFiles.find((f) => f.startsWith(`${prefix}_`))
      if (!file) {
        missing.push(`${prefix}「${name}」→ ${prefix}_*.test.ts が無い`)
        continue
      }
      // describe 名でも test 名でもよい。どちらかに出てくれば辿れる。
      if (!contents.get(file)!.includes(name)) {
        missing.push(`${prefix}「${name}」→ ${file} に見つからない`)
      }
    }
    assert.deepEqual(missing, [], 'DECISIONS.md が存在しないテストを指している')
  })

  test('B 節の制約はすべてテストを示している', () => {
    // B 節は表。各行の末尾の列にテストが入っていること。
    const section = decisions.slice(
      decisions.indexOf('## B. 制約として足したもの'),
      decisions.indexOf('## C. 構造の整理'),
    )
    const rows = section
      .split('\n')
      .filter((l) => l.startsWith('|') && !l.includes('---') && !l.includes('追加した制約'))

    assert.ok(rows.length >= 11, `B 節の表が短い（${rows.length} 行）`)
    const withoutTest = rows.filter((l) => !/[0-9]{2}「[^」]+」\s*\|?\s*$/.test(l.trim()))
    assert.deepEqual(
      withoutTest.map((l) => l.split('|')[1]?.trim()), [],
      'テストを示していない制約がある',
    )
  })
})

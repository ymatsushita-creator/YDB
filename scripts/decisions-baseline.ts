import { readFile, writeFile } from 'node:fs/promises'

import { collectRefs, findDangling, parseHeadings } from './decisions-refs.ts'

/**
 * 欠番のラチェット（`.consultant/DANGLING-BASELINE.txt`）を書き直す。
 *
 * ★ なぜ要るか（欠番45件が生まれた経路。`.consultant/DIAGNOSIS.md` 所見2）:
 *   CI は索引のずれを `--check` で落とせる。だが**最初から書かれなかった判断**は
 *   検知しようがない ―― コードに `C-220` と書いた時点では、まだ何もコミットされていない。
 *   実行⑯・⑰は、この穴を通って**報告書も設計判断も残さずに終わった。**
 *
 * ★★ **番号を増やすことは強制できないが、「増えたのに記録が無い」ことは検知できる。** ★★
 *   欠番の一覧を台帳に固定し、S13 が「台帳より増えていないこと」を見る。
 *   既存の45件は据え置き（そこはAIが埋められない）。**新しい番号は素通りできない。**
 *
 * ★ ラチェットである。減ったときも落ちる ―― 埋めたら台帳も締める。
 *   締め忘れた台帳は「45件のままだ」と嘘をつき、次に増えた1件を隠してしまう。
 *
 *     pnpm decisions:baseline    台帳を現状に合わせる（増えていないことは S13 が見る）
 */

const FILE = new URL('../.consultant/DANGLING-BASELINE.txt', import.meta.url)

const markdown = await readFile(new URL('../db/DECISIONS.md', import.meta.url), 'utf8')
const dangling = findDangling(parseHeadings(markdown), await collectRefs())

const body = [
  '# 欠番の台帳 —— 参照されているのに db/DECISIONS.md に見出しが無い番号',
  '#',
  '# ★ 生成物である。手で編集しない（`pnpm decisions:baseline` で作る）。',
  '# ★ S13（`pnpm structure`）がこの一覧と現状を突き合わせる ――',
  '#   ここに無い番号が増えていたら落ちる。**新しい番号は記録なしに素通りできない。**',
  '# ★ ラチェットである。埋めて減ったときも落ちる ―― 台帳を締め直すこと。',
  '#',
  '# 既存の分をここに据え置くのは、AIが埋められないからである',
  '# （`CLAUDE.md`「記録にない値の創作」の禁止）。埋められるのは判断を下した人間だけ。',
  '# 手がかりは `pnpm decisions:missing <番号>` が参照元のコードから集める。',
  '',
  ...dangling.map((d) => d.id),
  '',
].join('\n')

await writeFile(FILE, body)
console.log(`欠番の台帳を書いた ―― ${dangling.length} 件`)

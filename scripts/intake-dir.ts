import { existsSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 受領した実データ（応募管理表・顔写真・旧DBの原本・控え）の置き場。
 *
 * ★ **リポジトリの外に置く。** 中に置いて `.gitignore` で守る形は、ignore の
 *   1行が崩れた瞬間に追跡下へ入る。実際、`.env.local` へ書くつもりの
 *   リダイレクトが `.env.localecho` を作り、完全一致指定の ignore を素通りして
 *   APIキーがコミットされた（監査 2026-08-19 / .audit/REMEDIATION.md）。
 *
 * 既定は `<リポジトリ>/../YouthDB-private`。別の場所に置くなら YOUTHDB_INTAKE_DIR で指す。
 * ここは「どこを読むか」の指定であって、検査を外すための口ではない。
 * **リポジトリの中を指す指定は受け付けない**（下の `assertOutsideRepo`）。
 *
 * 内訳（監査 2026-08-19 D2-01 で `db/private/` から移した）:
 *   db-private/backups/                    控え（氏名・評価を含む）
 *   db-private/legacy-youthdb-2026-08-07/  旧NEO-Youthの原本
 *   資料/*.pptx                            運営から受領した説明資料
 *   2期応募管理*.xlsx / お顔データ/         受領した表と顔写真
 *
 * ★ 独立レビュー（2026-08-19）で、初版の検査が3通りで抜けることが実証された。
 *   その3つを塞いだ実装が以下である。**素朴な文字列比較では足りない。**
 *     A. cwd 依存    `scripts/` から実行すると repo が `scripts/` になり、
 *                    `<repo>/db/private` が「外」と判定されて素通りした
 *     B. シンボリックリンク  外→内へのリンク経由で、実体がリポジトリ内でも通った
 *     C. 大文字小文字  APFS は大小を同一視するため `youthdb/db/private` が通った
 */

/** リポジトリのルート。**cwd ではなくこのファイルの位置から決める。** */
const REPO = canonical(fileURLToPath(new URL('..', import.meta.url)))

/**
 * パスを実体まで解決する。
 *
 * `resolve()` は字句正規化しかせず、シンボリックリンクも大小文字も解かない。
 * `realpathSync.native` は OS に問い合わせるため、リンクを辿り、
 * 大小文字を区別しないボリュームでは**実際の綴り**へ正規化する。
 *
 * 存在しないパスには使えないので、実在する最も近い祖先まで遡って解決し、
 * 残りを継ぎ足す（受け入れ先はこれから作られることがあるため）。
 */
function canonical(input: string): string {
  let head = resolve(input)
  const tail: string[] = []
  while (!existsSync(head)) {
    const parent = dirname(head)
    if (parent === head) return head // ルートまで遡っても無い。字句解決のまま返す
    tail.unshift(head.slice(parent.length + 1))
    head = parent
  }
  return join(realpathSync.native(head), ...tail)
}

/** リポジトリの中を指していたら止める。実体で比べる。 */
function assertOutsideRepo(dir: string): void {
  if (dir !== REPO && !dir.startsWith(`${REPO}/`)) return
  console.error(`受け入れ口をリポジトリの中へ向けられない ―― ${dir}`)
  console.error(`（リポジトリ: ${REPO}）`)
  console.error('実データはリポジトリの外に置く（.audit/AUDIT_CHARTER.md / 監査 D2-01）。')
  console.error('シンボリックリンク・相対パス・大文字小文字違いでも、実体で判定している。')
  process.exit(1)
}

export function intakeDir(): string {
  const raw = process.env.YOUTHDB_INTAKE_DIR
  // 既定もリポジトリ基準にする。cwd 基準だと、親ディレクトリから実行しただけで
  // 見当違いの場所を既定にしてしまい、そこへ控えが黙って書かれる。
  const dir = canonical(raw && raw.trim() !== '' ? raw : join(REPO, '..', 'YouthDB-private'))
  assertOutsideRepo(dir)
  return dir
}

/**
 * 受領データを**書く**先。読むときと同じ外部ディレクトリの下に作る。
 *
 * ★ 置き場そのものが無い状態で黙って作らない。指定を間違えたまま
 *   実在候補者の控えが見当違いの場所へ書かれるのを防ぐ（レビュー指摘）。
 *   作るのは置き場の**下**だけで、置き場自体は人間が用意する。
 */
export function intakeWritePath(...parts: string[]): string {
  const root = intakeDir()
  if (!existsSync(root)) {
    console.error(`受領データの置き場が無い ―― ${root}`)
    console.error('ここへ実データの控えを書こうとしている。場所が正しいか確かめること。')
    console.error('置き場は人間が作る。場所を変えるなら YOUTHDB_INTAKE_DIR で指す。')
    process.exit(1)
  }
  return join(root, ...parts)
}

/** 受領データのパス。無ければ、どこを探したのかを言って止める。 */
export function intakePath(name: string): string {
  const path = join(intakeDir(), name)
  if (!existsSync(path)) {
    console.error(`受領データが無い ―― ${path}`)
    console.error('リポジトリの外に置く。場所を変えるなら YOUTHDB_INTAKE_DIR で指す。')
    process.exit(1)
  }
  return path
}

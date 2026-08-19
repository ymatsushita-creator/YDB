import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * 受領した実データ（応募管理表・顔写真）の置き場。
 *
 * ★ **リポジトリの外に置く。** 中に置いて `.gitignore` で守る形は、ignore の
 *   1行が崩れた瞬間に追跡下へ入る。実際、`.env.local` へ書くつもりの
 *   リダイレクトが `.env.localecho` を作り、完全一致指定の ignore を素通りして
 *   APIキーがコミットされた（監査 2026-08-19 / .audit/REMEDIATION.md）。
 *
 * 既定は `../YouthDB-private`。別の場所に置くなら YOUTHDB_INTAKE_DIR で指す。
 * ここは「どこを読むか」の指定であって、検査を外すための口ではない。
 */
export const intakeDir = (): string =>
  resolve(process.env.YOUTHDB_INTAKE_DIR ?? join(process.cwd(), '..', 'YouthDB-private'))

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

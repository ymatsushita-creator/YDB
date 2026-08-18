import { readFile } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { checkDeployTarget, EXPECTED } from './deploy-target.ts'

/**
 * 本番へデプロイする。**書き込み先を名乗ってから出す。**
 *
 *   pnpm deploy:production
 *
 * ★ `vercel --prod` を直に打たない理由 ―― 同じリポジトリに Vercel
 *   プロジェクトが2つあり、`vercel link` 一発で繋ぎ替わる（C-123）。
 *   繋ぎ替わったことは出力に出ないので、**約束した先かを先に照合する**（C-124）。
 *
 * ★ 判定は `scripts/deploy-target.ts` にあり、テストの下にある。
 *   ここがやるのは「読む・名乗る・渡す」だけ。
 *
 * ★ **迷ったら止める。** 読めない・違う先なら出さない。
 *
 * ★ 出す物を検査してから出す（監査ゲート）。`vercel --prod` は git の ref ではなく
 *   **作業ディレクトリ**を送るので、未コミット・未追跡のファイルも本番へ出る。
 *   何を出したのかを記録しないと、後から誰も突き合わせられない。
 */

const linkPath = join(process.cwd(), '.vercel', 'project.json')
const raw = await readFile(linkPath, 'utf8').catch(() => null)
const check = checkDeployTarget(raw)

if (!check.ok) {
  console.error(`デプロイしない ―― ${check.reason}`)
  process.exit(1)
}

console.log(`書き込み先 ―― ${check.projectName}（約束した ${EXPECTED.projectName}。C-123）`)

// 出す前の関門。送るファイルを検査し、出所（コミット・作業ツリーの汚れ・未push）を記録する。
// 通らなければ出さない。記録できなければ出さない。
const toolPath = (await readFile(join(process.cwd(), '.audit', 'TOOL_PATH'), 'utf8').catch(() => null))?.trim()
if (!toolPath) {
  console.error('デプロイしない ―― .audit/TOOL_PATH が無い。監査ツールの場所が分からない。')
  console.error('（ツールが無いことを理由に検査を飛ばさない）')
  process.exit(1)
}
const gate = spawnSync(toolPath, ['deploy-gate', '--repo', process.cwd()], { stdio: 'inherit' })
if (gate.status !== 0) {
  console.error('デプロイしない ―― 出す前の検査に通らなかった。')
  process.exit(1)
}

// 出力はそのまま流す。vercel が言うことを、こちらで要約しない。
const child = spawn('vercel', ['--prod', '--yes'], { stdio: 'inherit' })
child.on('error', (e) => {
  console.error(`vercel を起動できない: ${e.message}`)
  process.exit(1)
})
child.on('exit', (code) => process.exit(code ?? 1))

import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
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
 */

const linkPath = join(process.cwd(), '.vercel', 'project.json')
const raw = await readFile(linkPath, 'utf8').catch(() => null)
const check = checkDeployTarget(raw)

if (!check.ok) {
  console.error(`デプロイしない ―― ${check.reason}`)
  process.exit(1)
}

console.log(`書き込み先 ―― ${check.projectName}（約束した ${EXPECTED.projectName}。C-123）`)

// 出力はそのまま流す。vercel が言うことを、こちらで要約しない。
const child = spawn('vercel', ['--prod', '--yes'], { stdio: 'inherit' })
child.on('error', (e) => {
  console.error(`vercel を起動できない: ${e.message}`)
  process.exit(1)
})
child.on('exit', (code) => process.exit(code ?? 1))

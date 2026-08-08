import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { isPortOpen } from '../scripts/guard.ts'

/**
 * Pilot Deployment Readiness（実行⑧）。
 *
 * db:reset の事故防止（DEPLOY-READINESS.md B-3）は「開発サーバを起動したまま
 * 実行しない」という運用の注意だけでは守れない。実際に2回壊れている
 * （HANDOFF.md）。ポート3111が使われていれば拒否する検査そのものを固定する。
 */
describe('db:reset の事故防止（ポート衝突検査）', () => {
  test('listen しているポートは open と判定する', async () => {
    const server = createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const address = server.address()
    if (address === null || typeof address === 'string') {
      throw new Error('unexpected server address')
    }
    assert.equal(await isPortOpen(address.port), true)
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  test('誰も listen していないポートは open と判定しない', async () => {
    // 動的ポート範囲の外側に近い、まず使われていない番号を選ぶ。
    assert.equal(await isPortOpen(59991), false)
  })
})

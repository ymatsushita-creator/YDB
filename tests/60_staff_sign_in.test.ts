import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freshDb } from '../src/db/testing.ts'
import { all, one, scalar } from '../src/db/client.ts'
import { recordSignIn } from '../src/commands/staff_auth.ts'

/**
 * 入った記録（0038）と、入口の形（C-146）。
 *
 * ★★ 依頼者の判断 ――「経営層と平社員の2個パスワードがあればいい」。
 *   実行⑮でいったん**職員ごとの合言葉**を組んだが（C-144）、**外した**。
 *   入口は共有の合言葉だけで、**誰が入ったかは記録できない**（C-84 の穴は開いたまま）。
 *
 * ★ それでも入った事実は残す ―― いつ・どの層で。誰かは NULL。
 *   **分からないことを、分からないと記録する**（空欄で濁さない）。
 *
 * ★ 0038 の表と制約は**そのまま残っている**（適用済みマイグレーションは編集しない）。
 *   将来ふたたび職員ごとにするなら、記録層は待っている。
 */

const ROOT = fileURLToPath(new URL('../', import.meta.url))

describe('入った記録（0038）', () => {
  test('共有で入った記録は「誰か分からない」として残る', async () => {
    const db = await freshDb({ seeds: 'production' })
    await recordSignIn(db, { tier: 'all' })
    await recordSignIn(db, { tier: 'personal' })

    const rows = await all<{ method: string; staff_id: string | null; tier: string }>(
      db, `SELECT method, staff_id, tier FROM sign_in_events ORDER BY tier`)
    assert.deepEqual(rows, [
      { method: 'shared', staff_id: null, tier: 'all' },
      { method: 'shared', staff_id: null, tier: 'personal' },
    ])
    await db.close()
  })

  test('★ 入った記録は追記専用（消せない・直せない）', async () => {
    const db = await freshDb({ seeds: 'production' })
    await recordSignIn(db, { tier: 'all' })
    await assert.rejects(
      db.query(`UPDATE sign_in_events SET tier = 'input'`), /append|追記|reject/i)
    await assert.rejects(db.query(`DELETE FROM sign_in_events`), /append|追記|reject/i)
    await db.close()
  })

  test('名乗りと記録を食い違わせられない', async () => {
    // 「職員として入った」のに職員が居ない行、その逆も作れないこと。
    // ★ いまは共有だけだが、**制約は残す** ―― 記録層は入口の都合で緩めない。
    const db = await freshDb({ seeds: 'production' })
    await assert.rejects(db.query(`
      INSERT INTO sign_in_events (staff_id, tier, method) VALUES (NULL, 'all', 'staff')`),
      /pair/)
    await db.close()
  })

  test('定義外の層は記録できない', async () => {
    const db = await freshDb({ seeds: 'production' })
    await assert.rejects(db.query(`
      INSERT INTO sign_in_events (staff_id, tier, method)
      VALUES (NULL, 'superuser', 'shared')`), /tier/)
    await db.close()
  })

  test('いつ・何回入ったかを読める（誰かは分からないまま）', async () => {
    const db = await freshDb({ seeds: 'production' })
    const staffId = await scalar<string>(db, `
      INSERT INTO staffs (display_name) VALUES ('架空 入力者') RETURNING id`)
    await recordSignIn(db, { tier: 'all' })
    await recordSignIn(db, { tier: 'all' })

    // 共有で入った回数は、職員には紐づかない。
    const perStaff = await one<{ n: string; has: boolean }>(db, `
      SELECT sign_in_count::text AS n, has_passphrase AS has
        FROM v_staff_last_sign_in WHERE staff_id = $1`, [staffId])
    assert.equal(Number(perStaff.n), 0, '共有の入場が職員に紐づいている')
    assert.equal(perStaff.has, false, '合言葉を持つ職員が居る（いまは誰も持たない）')

    const total = await scalar<string>(db, `SELECT count(*)::text FROM sign_in_events`)
    assert.equal(Number(total), 2, '入った事実そのものは残る')
    await db.close()
  })
})

describe('入口の形（C-146）', () => {
  test('★ 欄は合言葉1つだけ（名前を聞かない）', async () => {
    const page = await readFile(join(ROOT, 'app/login/page.tsx'), 'utf8')
    const inputs = [...page.matchAll(/name="([a-zA-Z]+)"/g)].map((m) => m[1]!)
    assert.deepEqual(inputs.sort(), ['next', 'password'],
      '入口の欄が増えている（合言葉と、戻り先の hidden だけ）')
    assert.doesNotMatch(page, /<select/, '入口に一覧が出ている')
  })

  test('失敗の文言は1つだけ（理由を分けない）', async () => {
    const page = await readFile(join(ROOT, 'app/login/page.tsx'), 'utf8')
    const messages = [...page.matchAll(/login-error">([^<]+)</g)].map((m) => m[1]!)
    assert.deepEqual(messages, ['合言葉が違う'])
  })

  test('配るのは2つでよい ―― 設定しない層では誰も入れない', async () => {
    // 「経営層と平社員の2個」＝ all と personal。入力層を設定しなければ、
    // その層の合言葉は存在しないので誰も通らない（既定で閉じている）。
    const { matchTier } = await import('../src/auth/session.ts')
    const two = { all: '架空の経営層の合言葉', personal: '架空の平社員の合言葉' }
    assert.equal(matchTier(two, '架空の経営層の合言葉'), 'all')
    assert.equal(matchTier(two, '架空の平社員の合言葉'), 'personal')
    assert.equal(matchTier(two, 'どちらでもない'), null)
    // 入力層は未設定 ―― どんな合言葉でも通らない。
    assert.equal(matchTier(two, ''), null)
  })

  test('★ 使わない道具を残していない（職員ごとの合言葉の道具は消した）', async () => {
    const gone = ['src/auth/credential.ts', 'scripts/staff-passphrase.ts']
    for (const p of gone) {
      await assert.rejects(readFile(join(ROOT, p), 'utf8'), /ENOENT/,
        `${p} が残っている（使わない道具は残さない）`)
    }
    const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')) as
      { scripts: Record<string, string> }
    assert.equal('staff:passphrase' in pkg.scripts, false, '使わないコマンドが残っている')
  })

  test('0038 の表と制約は残っている（適用済みは編集しない）', async () => {
    // ★ 消したのは道具だけ。記録層は残す ―― 適用済みマイグレーションは編集しない。
    const db = await freshDb({ seeds: 'production' })
    for (const t of ['staff_credentials', 'sign_in_events']) {
      assert.equal(
        Number(await scalar(db, `SELECT count(*)::text FROM ${t}`)), 0, `${t} が無い`)
    }
    await db.close()
  })

  test("'use client' は2つのまま（入口を触っても増やしていない）", async () => {
    const clients: string[] = []
    for (const dir of ['app', 'src']) {
      for (const f of await readdir(join(ROOT, dir), { recursive: true })) {
        if (typeof f !== 'string' || !(f.endsWith('.tsx') || f.endsWith('.ts'))) continue
        const src = await readFile(join(ROOT, dir, f), 'utf8')
        if (/^'use client'/m.test(src.split('\n').slice(0, 3).join('\n'))) {
          clients.push(join(dir, f))
        }
      }
    }
    assert.deepEqual(clients.sort(), ['app/_components/glass.tsx', 'app/_components/sheet.tsx'])
  })
})

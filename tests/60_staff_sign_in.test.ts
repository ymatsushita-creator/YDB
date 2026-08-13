import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freshDb } from '../src/db/testing.ts'
import { all, one, scalar } from '../src/db/client.ts'
import {
  setStaffPassphrase, signInAsStaff, recordSignIn,
} from '../src/commands/staff_auth.ts'
import {
  newCredential, verifyCredential, derive, PBKDF2_ITERATIONS, checkNewPassphrase,
} from '../src/auth/credential.ts'
import { issueSession, verifySession } from '../src/auth/session.ts'

/**
 * 誰が入ったかを記録する（0038。依頼者の許可。実行⑮）。
 *
 * ここまでの入口は**層ごとの合言葉1つ**で、同じ層の中では誰が入ったか分からなかった
 * （C-84。引き継ぎに毎回「認証がない」と書かれてきた穴）。
 *
 * ★ ここで固定するのは4つ ――
 *   ① 合言葉は**戻せない形**でしか保存されない（平文も可逆な形も持たない）
 *   ② 失敗の理由を分けない・**居ない相手にも同じだけ時間をかける**
 *      （返り値を揃えても、応答時間が「その名前が実在するか」を漏らす）
 *   ③ 券は層と**誰か**の両方を覆って署名する（誰かを外せばなりすませる）
 *   ④ 入った記録は**追記専用**。共有で入ったら「誰か分からない」と記録に残す
 *
 * ★ **実在の職員の合言葉はここでも作らない。** 使うのは架空の職員だけ。
 */

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const SECRET = 'テスト用の署名鍵（本物ではない）'
const NOW = 1_800_000_000_000

async function world() {
  const db = await freshDb({ seeds: 'production' })
  const staffId = await scalar<string>(db, `
    INSERT INTO staffs (display_name, email)
    VALUES ('架空 入力者', 'x@example.test') RETURNING id`)
  return { db, staffId }
}

describe('合言葉の持ち方（0038）', () => {
  test('★ 平文も、元へ戻せる形も保存しない', async () => {
    const { db, staffId } = await world()
    const passphrase = 'これは架空の合言葉である'
    assert.ok(await setStaffPassphrase(db, { staffId, passphrase, tier: 'input' }))

    const row = await one<{ salt: string; hash: string; iterations: number }>(
      db, `SELECT salt, hash, iterations FROM staff_credentials WHERE staff_id = $1`, [staffId])

    // 記録のどこにも合言葉そのものが無いこと。
    assert.equal(row.hash.includes(passphrase), false, '派生鍵に合言葉が混ざっている')
    assert.equal(row.salt.includes(passphrase), false, '塩に合言葉が混ざっている')
    // 同じ合言葉でも、塩が違えば派生鍵は違う（使い回しが見えない）。
    const again = await newCredential(passphrase)
    assert.notEqual(again.hash, row.hash, '塩を引き直していない')
    // 反復回数は記録が持つ（あとで上げられる）。下限は記録層が拒む。
    assert.equal(row.iterations, PBKDF2_ITERATIONS)
    await assert.rejects(db.query(`
      INSERT INTO staff_credentials (staff_id, tier, salt, iterations, hash)
      VALUES (gen_random_uuid(), 'input', '0123456789abcdef', 1000, ${"'".concat('x'.repeat(32), "'")})`),
      /iterations|foreign key/, '弱い反復回数を記録層が拒んでいない')
    await db.close()
  })

  test('短すぎる合言葉と、定義外の層は設定できない', async () => {
    const { db, staffId } = await world()
    assert.equal(checkNewPassphrase('短い', 'input'), 'too_short')
    assert.equal(checkNewPassphrase('　　　　　　　　　　　　', 'input'), 'blank')
    assert.equal(checkNewPassphrase('十分に長い架空の合言葉である', 'superuser'), 'bad_tier')

    const r = await setStaffPassphrase(db, { staffId, passphrase: '短い', tier: 'input' })
    assert.deepEqual(r, { ok: false, reason: 'too_short' })
    assert.equal(
      Number(await scalar(db, `SELECT count(*) FROM staff_credentials`)), 0,
      '弾いたのに記録が残っている')
    await db.close()
  })

  test('入れ替えられる（思い出す道は無い）', async () => {
    const { db, staffId } = await world()
    const first = await setStaffPassphrase(
      db, { staffId, passphrase: '架空の合言葉のその一つめ', tier: 'input' })
    assert.deepEqual(first, { ok: true, created: true })
    const second = await setStaffPassphrase(
      db, { staffId, passphrase: '架空の合言葉のその二つめ', tier: 'all' })
    assert.deepEqual(second, { ok: true, created: false }, '2度目は入れ替えである')

    assert.equal((await signInAsStaff(
      db, { displayName: '架空 入力者', passphrase: '架空の合言葉のその一つめ' })).ok, false,
      '古い合言葉で入れている')
    const now = await signInAsStaff(
      db, { displayName: '架空 入力者', passphrase: '架空の合言葉のその二つめ' })
    assert.equal(now.ok, true, '入れ替えた合言葉で入れない')
    assert.equal(now.ok === true ? now.tier : null, 'all', '層も入れ替わる')
    await db.close()
  })
})

describe('名前と合言葉で入る（0038）', () => {
  test('合っていれば、その職員として入れる', async () => {
    const { db, staffId } = await world()
    await setStaffPassphrase(db, { staffId, passphrase: '架空の合言葉でありますよ', tier: 'personal' })
    const r = await signInAsStaff(
      db, { displayName: '架空 入力者', passphrase: '架空の合言葉でありますよ' })
    assert.deepEqual(r, { ok: true, tier: 'personal', staffId })
    await db.close()
  })

  test('名前の前後の空白は落として突き合わせる（表と同じ集合）', async () => {
    // 打ち方で入れ／入れないが変わらないこと（C-126 と同じ線）。
    const { db, staffId } = await world()
    await setStaffPassphrase(db, { staffId, passphrase: '架空の合言葉でありますよ', tier: 'input' })
    const r = await signInAsStaff(
      db, { displayName: '　架空 入力者　', passphrase: '架空の合言葉でありますよ' })
    assert.equal(r.ok, true, '全角空白で囲むと入れない')
    await db.close()
  })

  test('★ 居ない名前と、違う合言葉を区別しない（返り値も、かかる時間も）', async () => {
    const { db, staffId } = await world()
    await setStaffPassphrase(db, { staffId, passphrase: '架空の合言葉でありますよ', tier: 'input' })

    const t0 = performance.now()
    const absent = await signInAsStaff(
      db, { displayName: '居ない人', passphrase: '架空の合言葉でありますよ' })
    const tAbsent = performance.now() - t0

    const t1 = performance.now()
    const wrong = await signInAsStaff(
      db, { displayName: '架空 入力者', passphrase: 'ちがう架空の合言葉である' })
    const tWrong = performance.now() - t1

    assert.deepEqual(absent, { ok: false })
    assert.deepEqual(wrong, { ok: false }, '返り値が違う（理由が漏れる）')

    // ★ 居ない相手にも派生鍵を計算する（`verifyAbsent`）。
    //   片方だけ早く返ると、**名前が実在するかが応答時間に出る。**
    const ratio = Math.max(tAbsent, tWrong) / Math.max(Math.min(tAbsent, tWrong), 1)
    assert.ok(ratio < 4,
      `応答時間が ${ratio.toFixed(1)} 倍違う（居ない=${Math.round(tAbsent)}ms / ` +
      `違う=${Math.round(tWrong)}ms）。実在するかが漏れる`)
    await db.close()
  })

  test('停止した職員は入れない', async () => {
    const { db, staffId } = await world()
    await setStaffPassphrase(db, { staffId, passphrase: '架空の合言葉でありますよ', tier: 'all' })
    await db.query(`UPDATE staffs SET is_active = false WHERE id = $1`, [staffId])
    assert.deepEqual(
      await signInAsStaff(db, { displayName: '架空 入力者', passphrase: '架空の合言葉でありますよ' }),
      { ok: false })
    await db.close()
  })

  test('記録の層が壊れていたら通さない（曖昧なら閉じる）', async () => {
    const { db, staffId } = await world()
    await setStaffPassphrase(db, { staffId, passphrase: '架空の合言葉でありますよ', tier: 'all' })
    // 記録層の制約が定義外の層を拒むこと自体も確かめる。
    await assert.rejects(
      db.query(`UPDATE staff_credentials SET tier = 'superuser' WHERE staff_id = $1`, [staffId]),
      /tier/)
    await db.close()
  })
})

describe('券は「誰か」も覆って署名する（0038）', () => {
  test('券から職員が読める', async () => {
    const staffId = '11111111-2222-3333-4444-555555555555'
    const token = await issueSession(SECRET, 'personal', NOW, staffId)
    assert.deepEqual(await verifySession(SECRET, token, NOW), { tier: 'personal', staffId })
  })

  test('★ 職員の欄だけ書き換えた券は通らない（なりすませない）', async () => {
    const mine = '11111111-2222-3333-4444-555555555555'
    const other = '99999999-8888-7777-6666-555555555555'
    const token = await issueSession(SECRET, 'personal', NOW, mine)
    const parts = token.split('.')
    const forged = [parts[0], parts[1], other, parts[3]].join('.')
    assert.equal(await verifySession(SECRET, forged, NOW), null, '他人になりすませている')
  })

  test('共有で入った券は、誰かを言わない（null で返る）', async () => {
    const token = await issueSession(SECRET, 'input', NOW)
    assert.deepEqual(await verifySession(SECRET, token, NOW), { tier: 'input', staffId: null })
  })

  test('0038 より前の券も通す（作業中の全員を締め出さない）', async () => {
    // 古い形は `exp.tier.mac` の3つ。署名は当時から exp と tier を覆っている。
    // 誰かは分からないので null。期限（7日）で自然に消える。
    const exp = String(Math.floor(NOW / 1000) + 3600)
    const legacyToken = await issueSession(SECRET, 'all', NOW)      // 新しい形
    const parts = legacyToken.split('.')
    assert.equal(parts.length, 4, '新しい券は4つの欄を持つ')
    // 古い形を手で組む（当時と同じ payload を署名する）。
    const { createHmac } = await import('node:crypto')
    const mac = createHmac('sha256', SECRET).update(`${exp}.all`).digest('base64url')
    assert.deepEqual(await verifySession(SECRET, `${exp}.all.${mac}`, NOW),
      { tier: 'all', staffId: null })
  })
})

describe('入った記録（0038）', () => {
  test('職員として入った記録と、共有で入った記録を書き分ける', async () => {
    const { db, staffId } = await world()
    await recordSignIn(db, { tier: 'all', staffId })
    await recordSignIn(db, { tier: 'input' })

    const rows = await all<{ method: string; staff_id: string | null; tier: string }>(
      db, `SELECT method, staff_id, tier FROM sign_in_events ORDER BY method`)
    assert.deepEqual(rows, [
      { method: 'shared', staff_id: null, tier: 'input' },
      { method: 'staff', staff_id: staffId, tier: 'all' },
    ], '「誰か分からない」を空欄で濁している')
    await db.close()
  })

  test('★ 入った記録は追記専用（消せない・直せない）', async () => {
    const { db, staffId } = await world()
    await recordSignIn(db, { tier: 'all', staffId })
    await assert.rejects(
      db.query(`UPDATE sign_in_events SET tier = 'input'`), /append|追記|reject/i)
    await assert.rejects(db.query(`DELETE FROM sign_in_events`), /append|追記|reject/i)
    await db.close()
  })

  test('名乗りと記録を食い違わせられない', async () => {
    // 「職員として入った」のに職員が居ない行、その逆も作れないこと。
    const { db } = await world()
    await assert.rejects(db.query(`
      INSERT INTO sign_in_events (staff_id, tier, method) VALUES (NULL, 'all', 'staff')`),
      /pair/)
    await db.close()
  })

  test('誰がいつ入ったかを、職員ごとに読める', async () => {
    const { db, staffId } = await world()
    await setStaffPassphrase(db, { staffId, passphrase: '架空の合言葉でありますよ', tier: 'all' })
    await recordSignIn(db, { tier: 'all', staffId })
    await recordSignIn(db, { tier: 'all', staffId })

    const row = await one<{
      sign_in_count: string; has_passphrase: boolean; tier: string | null
    }>(db, `SELECT sign_in_count::text, has_passphrase, tier
              FROM v_staff_last_sign_in WHERE staff_id = $1`, [staffId])
    assert.equal(Number(row.sign_in_count), 2)
    assert.equal(row.has_passphrase, true)
    assert.equal(row.tier, 'all')
    await db.close()
  })
})

describe('入口の作法（0038）', () => {
  test('★ 職員の一覧を入口に出さない（氏名を並べない）', async () => {
    const page = await readFile(join(ROOT, 'app/login/page.tsx'), 'utf8')
    assert.match(page, /name="displayName"/, '名前の欄が無い')
    assert.doesNotMatch(page, /<select/, '入口に職員の一覧が出ている')
    assert.doesNotMatch(page, /listStaff|staffs/, '入口が職員を引いている')
  })

  test('失敗の文言は1つだけ（理由を分けない）', async () => {
    const page = await readFile(join(ROOT, 'app/login/page.tsx'), 'utf8')
    const messages = [...page.matchAll(/login-error">([^<]+)</g)].map((m) => m[1]!)
    assert.deepEqual(messages, ['合言葉が違う'], '失敗の文言が増えている（理由が漏れる）')
  })

  test('合言葉は引数で受け取らない（履歴と ps に残る）', async () => {
    const script = await readFile(join(ROOT, 'scripts/staff-passphrase.ts'), 'utf8')
    assert.match(script, /YOUTHDB_NEW_PASSPHRASE/, '環境変数で受け取っていない')
    // argv から合言葉を読んでいないこと。
    const argvUses = [...script.matchAll(/args\[(\d)\]/g)].map((m) => Number(m[1]))
    assert.ok(argvUses.every((i) => i <= 1), '引数の3つ目以降を読んでいる（合言葉か）')
  })

  test('設定する道具は、既定で本番を向かない（C-88 と同じ規律）', async () => {
    const script = await readFile(join(ROOT, 'scripts/staff-passphrase.ts'), 'utf8')
    assert.match(script, /const remote = process\.argv\.includes\('--remote'\)/)
    assert.match(script, /remote \? process\.env\.DATABASE_URL : undefined/,
      '--remote が無くても DATABASE_URL を向いている')
  })

  test('署名鍵が無ければ誰も入れない（開き忘れを作らない）', async () => {
    assert.equal(await verifySession('', undefined, NOW), null)
    const proxy = await readFile(join(ROOT, 'proxy.ts'), 'utf8')
    assert.match(proxy, /if \(!secret\) return toLogin/, '鍵が無いときに素通ししている')
  })
})

describe('派生鍵そのもの', () => {
  test('同じ入力からは同じ鍵、違えば違う鍵', async () => {
    const a = await derive('架空の合言葉', 'saltsaltsaltsalt', 100_000)
    const b = await derive('架空の合言葉', 'saltsaltsaltsalt', 100_000)
    const c = await derive('架空の合言葉', 'saltsaltsaltsal2', 100_000)
    const d = await derive('架空の合言葉2', 'saltsaltsaltsalt', 100_000)
    assert.equal(a, b)
    assert.notEqual(a, c, '塩が効いていない')
    assert.notEqual(a, d, '合言葉が効いていない')
  })

  test('空の合言葉では通らない', async () => {
    const cred = await newCredential('架空の合言葉であります')
    assert.equal(await verifyCredential(cred, ''), false)
  })
})

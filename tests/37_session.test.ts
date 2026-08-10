import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  issueSession, verifySession, checkPassword, constantTimeEqual,
  SESSION_COOKIE, SESSION_MAX_AGE_SECONDS,
} from '../src/auth/session.ts'

/**
 * 合言葉1つで入る仕組み（実行⑩。依頼者の指示）。
 *
 * ★★ **これは「誰が」を記録しない。** 合言葉を共有するので、
 *   入った人を見分ける手段が無い。満たすのは入口を閉じることだけ。
 */

const SECRET = 'test-secret-not-the-real-one'
const NOW = 1_800_000_000_000

describe('合言葉と引換券', () => {
  test('正しい合言葉だけが通る', () => {
    assert.equal(checkPassword('neo-example', 'neo-example'), true)
    assert.equal(checkPassword('neo-example', 'neo-Example'), false)
    assert.equal(checkPassword('neo-example', 'neo-example '), false)
    assert.equal(checkPassword('neo-example', ''), false)
  })

  test('★ 合言葉が設定されていなければ、誰も入れない', () => {
    // 「未設定なら素通し」にすると、設定を忘れた瞬間に全部が開く。
    assert.equal(checkPassword(undefined, ''), false)
    assert.equal(checkPassword(undefined, 'なんでも'), false)
    assert.equal(checkPassword('', 'なんでも'), false)
  })

  test('引換券は、自分で発行したものだけを受け付ける', async () => {
    const token = await issueSession(SECRET, NOW)
    assert.equal(await verifySession(SECRET, token, NOW), true)
    assert.equal(await verifySession('別の秘密鍵', token, NOW), false,
      '秘密鍵が違えば通らない')
  })

  test('★ 期限だけ書き換えた偽の券は通らない', async () => {
    const token = await issueSession(SECRET, NOW)
    const [, mac] = token.split('.')
    const forged = `${Math.floor(NOW / 1000) + 999_999}.${mac}`
    assert.equal(await verifySession(SECRET, forged, NOW), false)
  })

  test('期限が切れた券は通らない', async () => {
    const token = await issueSession(SECRET, NOW)
    const later = NOW + (SESSION_MAX_AGE_SECONDS + 1) * 1000
    assert.equal(await verifySession(SECRET, token, later), false)
    assert.equal(await verifySession(SECRET, token, NOW + 1000), true)
  })

  test('壊れた券・空の券は通らない', async () => {
    for (const bad of [undefined, '', '.', 'abc', 'abc.def', '.sig', '123', '12x.sig']) {
      assert.equal(await verifySession(SECRET, bad, NOW), false, String(bad))
    }
  })

  test('★ 券に合言葉そのものは入らない', async () => {
    const token = await issueSession(SECRET, NOW)
    assert.equal(token.includes(SECRET), false)
    // 中身は「いつまで有効か」と署名だけ。
    assert.match(token, /^\d+\.[A-Za-z0-9_-]+$/)
  })

  test('突き合わせは、長さが違っても早く返らない', () => {
    assert.equal(constantTimeEqual('abc', 'abc'), true)
    assert.equal(constantTimeEqual('abc', 'abcd'), false)
    assert.equal(constantTimeEqual('', ''), true)
  })
})

describe('入口の閉じ方', () => {
  const read = (p: string) =>
    readFile(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8')

  /**
   * ★★ 合言葉そのものを、このテストに書かない（C-82）。
   *
   * 最初は合言葉の文字列を直接書いて「これがソースに出ていないか」を見ていた。
   * **見張りが漏洩経路になっていた** ―― 両リモートは公開なので、
   * 「これは合言葉である」という札付きで公開されるところだった。
   *
   * 実際の値は手元の `.env.local` にしかない。**そこから読んで突き合わせる。**
   * 手元に無い環境（CI）では突き合わせる相手が無いので、
   * **黙って通さず、何を見なかったかを言う。**
   */
  test('★ 合言葉が、追跡されるファイルに書かれていない', async () => {
    const env = await readFile(fileURLToPath(new URL('../.env.local', import.meta.url)), 'utf8')
      .catch(() => null)
    const password = env?.match(/^YOUTHDB_PASSWORD=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '')
    if (!password) {
      // 相手が無いので比べられない。**通ったことにしない**ために印を残す。
      console.log('  ℹ .env.local に YOUTHDB_PASSWORD が無いので突き合わせを省いた')
      return
    }

    // git が追跡する（＝公開される）ファイルだけを見る。
    const tracked = execFileSync('git', ['ls-files', '-co', '--exclude-standard'],
      { cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8' })
      .split('\n').filter(Boolean)
    assert.ok(tracked.length > 50, `走査が壊れている（${tracked.length} ファイル）`)

    const leaked: string[] = []
    for (const p of tracked) {
      const src = await read(p).catch(() => null)
      if (src?.toLowerCase().includes(password.toLowerCase())) leaked.push(p)
    }
    // ★ 一致したファイル名だけを出す。**値は出さない。**
    assert.deepEqual(leaked, [], '合言葉が追跡されるファイルに書かれている')
  })

  test('★ 合言葉の既定値をコードに持たない', async () => {
    // 「未設定ならこれ」を書いた瞬間、それが公開された合言葉になる。
    for (const p of ['src/auth/session.ts', 'app/login/actions.ts', 'proxy.ts']) {
      const src = await read(p)
      assert.equal(/YOUTHDB_(PASSWORD|SESSION_SECRET)\s*(\?\?|\|\|)/.test(src), false,
        `${p} が環境変数に既定値を与えている`)
    }
  })

  test('★ 秘密鍵が無ければ、誰も通さない', async () => {
    const src = await read('proxy.ts')
    assert.match(src, /if \(!secret\) return toLogin/,
      '未設定のときに素通しする道があってはならない')
  })

  test('通すのは、合言葉の画面と資材だけ', async () => {
    const src = await read('proxy.ts')
    const list = src.match(/PUBLIC_PREFIXES = \[([^\]]*)\]/)?.[1] ?? ''
    const allowed = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()
    assert.deepEqual(allowed, ['/_next', '/brand', '/favicon', '/login'],
      '中身の画面を1つも通さない')
  })

  test('戻り先は自分のパスだけ（外部へ飛ばす踏み台にしない）', async () => {
    const src = await read('app/login/actions.ts')
    assert.match(src, /SAFE_NEXT/)
    assert.match(src, /startsWith\('\/\/'\)/, '`//example.com` を弾く')
  })

  test('★ 合言葉の画面に「記入できます」の札を出さない', async () => {
    // `editable-region` は**記録を編集できる場所**の印（C-47）。
    // 合言葉は記録ではない。入る前の画面に記録の札が出ていた（C-82）。
    // 見るのは `className` だけ。**注釈に語が出るのは構わない** ――
    // 付けない理由を書いた行まで禁じると、理由を残せなくなる。
    const src = await read('app/login/page.tsx')
    const classes = [...src.matchAll(/className="([^"]*)"/g)].map((m) => m[1] ?? '')
    assert.equal(classes.some((c) => c.split(/\s+/).includes('editable-region')), false,
      '合言葉のカードに記録の印が付いている')
  })

  test('Cookie は httpOnly で、名前が1箇所に決まっている', async () => {
    const src = await read('app/login/actions.ts')
    assert.match(src, /httpOnly: true/)
    assert.match(src, /sameSite: 'lax'/)
    assert.equal(SESSION_COOKIE, 'youthdb_session')
  })
})

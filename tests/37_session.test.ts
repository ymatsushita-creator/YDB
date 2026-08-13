import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  issueSession, verifySession, checkPassword, constantTimeEqual, matchTier,
  SESSION_COOKIE, SESSION_MAX_AGE_SECONDS,
} from '../src/auth/session.ts'
import { canOpen, TIER_HOME, TIERS, isTier } from '../src/auth/tiers.ts'

/**
 * 合言葉で入る仕組み（実行⑩）。実行⑪で**層ごとに分けた**（依頼者の指示）。
 *
 * ★★ **これは「誰が」を記録しない。** 合言葉を層の全員で共有するので、
 *   入った人を見分ける手段が無い。満たすのは入口を閉じることと、
 *   **層で分けること**だけ。
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
    // ★ 0038 で券が**層と誰か**を返すようになった（`{ tier, staffId }`）。
    //   職員として入っていなければ `staffId` は null（＝誰か分からない）。
    const token = await issueSession(SECRET, 'all', NOW)
    assert.deepEqual(await verifySession(SECRET, token, NOW), { tier: 'all', staffId: null })
    assert.equal(await verifySession('別の秘密鍵', token, NOW), null,
      '秘密鍵が違えば通らない')
  })

  test('★ 期限だけ書き換えた偽の券は通らない', async () => {
    const token = await issueSession(SECRET, 'all', NOW)
    const [, , staff, mac] = token.split('.')
    const forged = `${Math.floor(NOW / 1000) + 999_999}.all.${staff}.${mac}`
    assert.equal(await verifySession(SECRET, forged, NOW), null)
  })

  test('★★ 層だけ書き換えた偽の券は通らない', async () => {
    // 署名が期限しか覆っていないと、入力層の券の層名を書き換えるだけで
    // 全部が開く。**署名は期限と層の両方を覆う。**
    const token = await issueSession(SECRET, 'input', NOW)
    const [exp, , staff, mac] = token.split('.')
    assert.equal(await verifySession(SECRET, `${exp}.all.${staff}.${mac}`, NOW), null)
    assert.equal(await verifySession(SECRET, `${exp}.personal.${staff}.${mac}`, NOW), null)
    // 元の券はそのまま通る（壊したのは偽物だけ）。
    assert.deepEqual(await verifySession(SECRET, token, NOW), { tier: 'input', staffId: null })
  })

  test('期限が切れた券は通らない', async () => {
    const token = await issueSession(SECRET, 'personal', NOW)
    const later = NOW + (SESSION_MAX_AGE_SECONDS + 1) * 1000
    assert.equal(await verifySession(SECRET, token, later), null)
    assert.deepEqual(await verifySession(SECRET, token, NOW + 1000),
      { tier: 'personal', staffId: null })
  })

  test('壊れた券・空の券は通らない', async () => {
    for (const bad of [undefined, '', '.', 'abc', 'abc.def', '.sig', '123',
      '12x.sig', '123.sig', '123.nosuchtier.sig', '123.all.sig.extra',
      // 0038 で欄が4つになった。**職員の欄が uuid でも `-` でもない券**は通さない。
      '123.all.notauuid.sig', '123.all.-.sig.extra']) {
      assert.equal(await verifySession(SECRET, bad, NOW), null, String(bad))
    }
  })

  test('★ 券に合言葉そのものは入らない', async () => {
    const token = await issueSession(SECRET, 'all', NOW)
    assert.equal(token.includes(SECRET), false)
    // 中身は「いつまで有効か」「どの層か」「誰か」と署名だけ（0038）。
    assert.match(token, /^\d+\.[a-z]+\.[-0-9a-f]+\.[A-Za-z0-9_-]+$/)

    // 職員として入った券も、合言葉を含まない。
    const staffToken = await issueSession(
      SECRET, 'all', NOW, '11111111-2222-3333-4444-555555555555')
    assert.equal(staffToken.includes(SECRET), false)
  })

  test('突き合わせは、長さが違っても早く返らない', () => {
    assert.equal(constantTimeEqual('abc', 'abc'), true)
    assert.equal(constantTimeEqual('abc', 'abcd'), false)
    assert.equal(constantTimeEqual('', ''), true)
  })
})

describe('層（実行⑪。依頼者の指示）', () => {
  const PASSWORDS = { all: 'aaa', personal: 'ppp', input: 'iii' }

  test('打たれた合言葉から層が決まる', () => {
    assert.equal(matchTier(PASSWORDS, 'aaa'), 'all')
    assert.equal(matchTier(PASSWORDS, 'ppp'), 'personal')
    assert.equal(matchTier(PASSWORDS, 'iii'), 'input')
    assert.equal(matchTier(PASSWORDS, 'zzz'), null)
  })

  test('★ 設定されていない層には誰も入れない', () => {
    // 未設定を素通しにすると、設定を忘れた層が全員に開く。
    assert.equal(matchTier({ all: 'aaa' }, ''), null)
    assert.equal(matchTier({}, 'なんでも'), null)
    assert.equal(matchTier({ all: undefined, personal: '' }, ''), null)
  })

  test('★★ 同じ合言葉が2つの層に設定されていたら、どちらも通さない', () => {
    // 強いほうを採ると、入力層に配った合言葉が全部を開ける事故が
    // 「設定の重複」という気付きにくい形で起きる。**曖昧なら閉じる。**
    assert.equal(matchTier({ all: 'same', input: 'same' }, 'same'), null)
    assert.equal(matchTier({ all: 'same', personal: 'same', input: 'x' }, 'same'), null)
  })

  test('ヘッドハンティングを開けるのは all だけ', () => {
    assert.equal(canOpen('all', '/headhunting'), true)
    assert.equal(canOpen('personal', '/headhunting'), false)
    assert.equal(canOpen('input', '/headhunting'), false)
    // 配下も同じ扱い。前方一致で閉じる。
    assert.equal(canOpen('personal', '/headhunting/anything'), false)
    // 名前が似ているだけの別の道は巻き込まない。
    assert.equal(canOpen('personal', '/headhunting-notes'), true)
  })

  test('personal はヘッドハンティング以外を開ける', () => {
    for (const p of ['/borderline', '/interviews', '/approach', '/people',
      '/applications/x', '/operations', '/people/new']) {
      assert.equal(canOpen('personal', p), true, p)
    }
  })

  test('★ input が開けるのは入力の画面とホームだけ', () => {
    assert.equal(canOpen('input', '/people/new'), true)
    assert.equal(canOpen('input', '/approach/new'), true)
    // 入力者を追加（実行⑫）。表の「記録した人」の選択肢を増やす道である。
    assert.equal(canOpen('input', '/staff/new'), true)
    for (const p of ['/borderline', '/people', '/approach', '/interviews',
      '/operations', '/funnel', '/applications/x']) {
      assert.equal(canOpen('input', p), false, p)
    }
  })

  test('★ ホームは全層が開く。ただし「/」で全部が開いてはいけない', () => {
    // ホームはタブの先頭なので、開けない層があると入った直後に弾かれる。
    for (const tier of TIERS) assert.equal(canOpen(tier, '/'), true, tier)

    // ★ `under(pathname, '/')` は**全部の道に当たる。** ホームを
    //   前方一致の一覧へ混ぜると、入力層が全画面を開ける。
    //   混ざっていないことを、開いてはいけない道で確かめる。
    assert.equal(canOpen('input', '/headhunting'), false)
    assert.equal(canOpen('input', '/people'), false)
    assert.equal(canOpen('personal', '/headhunting'), false)
  })

  test('★ どの層も、自分の入口だけは必ず開ける（輪にならない）', () => {
    // 入口が開けない層があると、送られた先でまた弾かれて回り続ける。
    for (const tier of TIERS) {
      assert.equal(canOpen(tier, TIER_HOME[tier]), true, tier)
    }
  })

  test('層の名前は閉じた集合', () => {
    assert.deepEqual([...TIERS], ['all', 'personal', 'input'])
    assert.equal(isTier('all'), true)
    assert.equal(isTier('ALL'), false)
    assert.equal(isTier('admin'), false)
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
    // ★ 層が増えたら見張る合言葉も増える（実行⑪）。1つだけ見ていると、
    //   増やした層の合言葉が見張りの外で公開される。
    const passwords = [...(env ?? '').matchAll(/^YOUTHDB_PASSWORD[A-Z_]*=(.*)$/gm)]
      .map((m) => m[1]!.trim().replace(/^["']|["']$/g, ''))
      .filter((v) => v !== '')
    if (passwords.length === 0) {
      // 相手が無いので比べられない。**通ったことにしない**ために印を残す。
      console.log('  ℹ .env.local に合言葉が無いので突き合わせを省いた')
      return
    }

    // git が追跡する（＝公開される）ファイルだけを見る。
    const tracked = execFileSync('git', ['ls-files', '-co', '--exclude-standard'],
      { cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8' })
      .split('\n').filter(Boolean)
    assert.ok(tracked.length > 50, `走査が壊れている（${tracked.length} ファイル）`)

    const leaked: string[] = []
    for (const p of tracked) {
      const src = (await read(p).catch(() => null))?.toLowerCase()
      if (src && passwords.some((w) => src.includes(w.toLowerCase()))) leaked.push(p)
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

  test('★ 層の判定も入口の1箇所でやる', async () => {
    // 画面ごとに書くと、1枚でも書き忘れたところが層を無視して開く。
    const src = await read('proxy.ts')
    assert.match(src, /canOpen\(tier, req\.nextUrl\.pathname\)/)
  })

  test('★ 権限が足りないときは合言葉を聞き直さない（輪にしない）', async () => {
    // 入れているのに開けないだけなので `/login` へ送ると回り続ける。
    const src = await read('proxy.ts')
    assert.match(src, /toHome\(req, tier\)/)
    assert.match(src, /url\.pathname = TIER_HOME\[tier\]/)
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

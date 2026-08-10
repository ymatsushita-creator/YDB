/**
 * 合言葉1つで入る仕組み（依頼者の指示。実行⑩）。
 *
 * ★★ **これは「誰が」を記録しない。** ★★
 *   合言葉を全員で共有するので、入った人を見分ける手段が無い。
 *   `docs/pilot/DEPLOY-READINESS.md` が求める認証は満たさない ――
 *   「誰がプロフィールを変えたか」は、これでも記録できないままである。
 *   満たすのは**入口を閉じること**だけ。
 *
 * ★ 合言葉そのものはリポジトリに書かない（`YOUTHDB_PASSWORD`）。
 *   **両リモートは公開である。** 書いた瞬間、閉じた意味が消える。
 *
 * ★ Cookie には合言葉を入れない。**署名した引換券**を入れる。
 *   合言葉を入れると、端末に平文で残り、盗まれたら永久に使える。
 *
 * Edge でも動くよう Web Crypto だけを使う（middleware から呼ぶ）。
 */

export const SESSION_COOKIE = 'youthdb_session'

/** 引換券の有効期間。切れたらもう一度合言葉を聞く。 */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

const encoder = new TextEncoder()

const toBase64Url = (bytes: ArrayBuffer): string => {
  const b = new Uint8Array(bytes)
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const sign = async (secret: string, payload: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  return toBase64Url(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)))
}

/**
 * 長さも中身も漏らさない突き合わせ。
 *
 * `===` は先頭が違えばすぐ返るので、**当てるまでの時間が手がかりになる。**
 * 合言葉は1つしかないので、ここだけは丁寧にやる。
 */
export const constantTimeEqual = (a: string, b: string): boolean => {
  const x = encoder.encode(a)
  const y = encoder.encode(b)
  // 長さが違っても早く返さない。長いほうに合わせて全部見る。
  const n = Math.max(x.length, y.length)
  let diff = x.length ^ y.length
  for (let i = 0; i < n; i += 1) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

/** 引換券を作る。中身は「いつまで有効か」と、その署名だけ。 */
export const issueSession = async (
  secret: string, nowMs: number,
): Promise<string> => {
  const exp = String(Math.floor(nowMs / 1000) + SESSION_MAX_AGE_SECONDS)
  return `${exp}.${await sign(secret, exp)}`
}

/**
 * 引換券を確かめる。
 *
 * ★ 署名を先に確かめてから期限を見る。順を逆にすると、
 *   **期限だけ書き換えた偽の券**を「期限切れ」として扱ってしまい、
 *   本物と偽物の区別が返り値から消える。
 */
export const verifySession = async (
  secret: string, token: string | undefined, nowMs: number,
): Promise<boolean> => {
  if (!token) return false
  const dot = token.indexOf('.')
  if (dot <= 0) return false
  const exp = token.slice(0, dot)
  const mac = token.slice(dot + 1)
  if (!/^\d+$/.test(exp)) return false
  if (!constantTimeEqual(mac, await sign(secret, exp))) return false
  return Number(exp) * 1000 > nowMs
}

/**
 * 合言葉が合っているか。
 *
 * ★ 合言葉が**設定されていなければ、誰も入れない。**
 *   「未設定なら素通し」にすると、設定を忘れた瞬間に全部が開く。
 *   閉じ忘れより、開き忘れのほうが取り返しがつかない。
 */
export const checkPassword = (expected: string | undefined, given: string): boolean => {
  if (!expected) return false
  return constantTimeEqual(expected, given)
}

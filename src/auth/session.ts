/**
 * 合言葉で入る仕組み（依頼者の指示。実行⑩）。
 * 実行⑪で**層ごとに分けた**（`src/auth/tiers.ts`）。
 *
 * ★★ **これは「誰が」を記録しない。** ★★
 *   合言葉を層の全員で共有するので、入った人を見分ける手段が無い。
 *   `docs/pilot/DEPLOY-READINESS.md` が求める認証は満たさない ――
 *   「誰がプロフィールを変えたか」は、これでも記録できないままである。
 *   満たすのは**入口を閉じること**と、**層で分けること**だけ。
 *
 * ★ 合言葉そのものはリポジトリに書かない（`YOUTHDB_PASSWORD*`）。
 *   **両リモートは公開である。** 書いた瞬間、閉じた意味が消える。
 *
 * ★ Cookie には合言葉を入れない。**署名した引換券**を入れる。
 *   合言葉を入れると、端末に平文で残り、盗まれたら永久に使える。
 *
 * Edge でも動くよう Web Crypto だけを使う（middleware から呼ぶ）。
 */

import { TIERS, isTier, type Tier } from './tiers.ts'

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

/** 券が言っていること。**層だけでなく、誰かも言う**（0038）。 */
export interface SessionClaims {
  tier: Tier
  /** 職員として入ったならその id。共有の合言葉で入ったなら null（＝誰か分からない）。 */
  staffId: string | null
}

/** 職員が入っていない券の、その欄の書き方。uuid に現れない字を使う。 */
const NO_STAFF = '-'

/**
 * 引換券を作る。中身は「いつまで有効か」「どの層か」「誰か」と、その署名だけ。
 *
 * ★ 署名は**3つ全部**を覆う。どれかを署名の外に置くと、そこだけ書き換えた券が通る
 *   ―― 層を外せば `input` が `all` になり、**誰かを外せば他人になりすませる。**
 */
export const issueSession = async (
  secret: string, tier: Tier, nowMs: number, staffId: string | null = null,
): Promise<string> => {
  const exp = String(Math.floor(nowMs / 1000) + SESSION_MAX_AGE_SECONDS)
  const payload = `${exp}.${tier}.${staffId ?? NO_STAFF}`
  return `${payload}.${await sign(secret, payload)}`
}

/**
 * 引換券を確かめ、**層と誰かを返す。** 通らなければ null。
 *
 * ★ 真偽ではなく中身を返す。真偽にすると、呼ぶ側が層や職員をもう一度どこかから
 *   取り直すことになり、その経路が署名の外側になる。
 *
 * ★ 署名を先に確かめてから期限を見る。順を逆にすると、
 *   **期限だけ書き換えた偽の券**を「期限切れ」として扱ってしまい、
 *   本物と偽物の区別が返り値から消える。
 *
 * ★ 3つの欄しか無い**古い券も通す**（0038 より前に配ったもの）。
 *   誰かは分からないので `staffId` は null になる ――
 *   **通さない選択もできたが、それは作業中の全員をその場で締め出す。**
 *   古い券は期限（7日）で自然に消える。署名は当時から `exp.tier` を覆っている。
 */
export const verifySession = async (
  secret: string, token: string | undefined, nowMs: number,
): Promise<SessionClaims | null> => {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 3 && parts.length !== 4) return null
  const legacy = parts.length === 3
  const exp = parts[0]!
  const tier = parts[1]!
  const staff = legacy ? NO_STAFF : parts[2]!
  const mac = parts[legacy ? 2 : 3]!
  if (!/^\d+$/.test(exp)) return null
  if (!isTier(tier)) return null
  if (!legacy && staff !== NO_STAFF && !UUID.test(staff)) return null
  const payload = legacy ? `${exp}.${tier}` : `${exp}.${tier}.${staff}`
  if (!constantTimeEqual(mac, await sign(secret, payload))) return null
  if (Number(exp) * 1000 <= nowMs) return null
  return { tier, staffId: staff === NO_STAFF ? null : staff }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

/**
 * 打たれた合言葉が、どの層のものか。合わなければ null。
 *
 * ★ **途中で止めない。** 合った時点で返すと、層の並び順が
 *   応答時間に出る（先頭の層ほど早く返る）。全部見てから決める。
 *
 * ★ **同じ合言葉が2つ以上の層に設定されていたら、どちらも通さない。**
 *   強いほうを採ると、入力層に配った合言葉が全部を開ける事故が
 *   「設定の重複」という気付きにくい形で起きる。**曖昧なら閉じる。**
 */
export const matchTier = (
  passwords: Readonly<Partial<Record<Tier, string | undefined>>>,
  given: string,
): Tier | null => {
  const hit = TIERS.filter((t) => checkPassword(passwords[t], given))
  return hit.length === 1 ? hit[0]! : null
}

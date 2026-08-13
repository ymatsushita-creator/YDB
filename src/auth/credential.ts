import { constantTimeEqual } from './session.ts'
import { TIERS, isTier, type Tier } from './tiers.ts'

/**
 * 職員ごとの合言葉（0038。依頼者の許可。実行⑮）。
 *
 * ★ **平文も、元へ戻せる形も保存しない。** 保存するのは塩・反復回数・派生鍵で、
 *   合言葉は復元できない。忘れたら入れ替える（思い出す道は無い）。
 *
 * ★ 使うのは Web Crypto の PBKDF2 だけ ―― Edge でも Node でも同じものが動く。
 *   ネイティブ拡張（argon2 など）を入れると、動く場所が環境で変わる。
 *
 * ★ 突き合わせは `constantTimeEqual`（session.ts）を使う。
 *   `===` は先頭が違えばすぐ返るので、当てるまでの時間が手がかりになる。
 *
 * ★ 反復回数は**記録に持つ**（列）。埋め込むと、上げた瞬間に既存の全員が
 *   入れなくなる。上げるときは、新しく設定した人から順に強くなる。
 */

/** いま設定するときの回数。**下げない。** 記録層も 100000 未満を拒む（0038）。 */
export const PBKDF2_ITERATIONS = 600_000

const encoder = new TextEncoder()

const toBase64Url = (bytes: ArrayBuffer): string => {
  const b = new Uint8Array(bytes)
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface Credential {
  salt: string
  iterations: number
  hash: string
}

/** 塩と反復回数から派生鍵を作る。 */
export async function derive(
  passphrase: string, salt: string, iterations: number,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: encoder.encode(salt), iterations, hash: 'SHA-256' },
    key, 256,
  )
  return toBase64Url(bits)
}

/** 新しい合言葉を、保存できる形にする。塩は毎回引き直す。 */
export async function newCredential(passphrase: string): Promise<Credential> {
  const salt = toBase64Url(crypto.getRandomValues(new Uint8Array(16)).buffer)
  const iterations = PBKDF2_ITERATIONS
  return { salt, iterations, hash: await derive(passphrase, salt, iterations) }
}

/**
 * 打たれた合言葉が、その職員のものか。
 *
 * ★ 記録が無いときも**同じだけ時間をかける**（`verifyAbsent`）。
 *   すぐ false を返すと、**その名前の職員が居るかどうかが応答時間に出る。**
 */
export async function verifyCredential(
  cred: Credential, given: string,
): Promise<boolean> {
  if (given === '') return false
  const got = await derive(given, cred.salt, cred.iterations)
  return constantTimeEqual(cred.hash, got)
}

/**
 * 居ない相手に対しても、同じ仕事をしてから断る。
 *
 * ★ 名前が実在するかを漏らさないためだけの関数である。戻り値は常に false。
 */
export async function verifyAbsent(given: string): Promise<false> {
  await derive(given === '' ? 'x' : given, 'absent', PBKDF2_ITERATIONS)
  return false
}

/** 記録から読んだ層。定義外の値は**通さない**（曖昧なら閉じる）。 */
export const tierOf = (value: string): Tier | null => (isTier(value) ? value : null)

/** 合言葉の最低の長さ。**運営が決める値ではなく、記録層を守る下限。** */
export const PASSPHRASE_MIN_LENGTH = 12

export type PassphraseProblem = 'too_short' | 'blank' | 'bad_tier'

/** 設定してよい合言葉か。理由は**設定する人にだけ**返す（入口では分けない）。 */
export function checkNewPassphrase(
  passphrase: string, tier: string,
): PassphraseProblem | null {
  if (passphrase.trim() === '') return 'blank'
  // ★ 前後の空白を落として数えない ―― 落とすと「12文字打ったのに短い」と言われる。
  //   長さは打たれたそのままで見る（空白も合言葉の一部である）。
  if (passphrase.length < PASSPHRASE_MIN_LENGTH) return 'too_short'
  if (!TIERS.includes(tier as Tier)) return 'bad_tier'
  return null
}

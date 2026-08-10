'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import {
  SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, issueSession, matchTier,
} from '../../src/auth/session.ts'
import { canOpen, TIER_HOME } from '../../src/auth/tiers.ts'

/**
 * 合言葉を確かめて、引換券を渡す。
 *
 * ★ 合言葉そのものは Cookie に入れない。**署名した引換券**を入れる。
 * ★ 失敗の理由を分けない ―― 「合言葉が違う」以外を返すと、
 *   設定の有無まで外から分かる。**どの層が設定済みかも漏らさない。**
 *
 * ★ 層ごとに合言葉が違う（実行⑪）。**画面は1つのまま。**
 *   「あなたはどの層ですか」と聞くと、層の一覧が入る前に見える。
 *   打たれた合言葉がどの層のものかは、こちらで決める。
 */
const SAFE_NEXT = /^\/[A-Za-z0-9\-._~/?&=%[\]]*$/

export async function signInAction(formData: FormData): Promise<void> {
  const password = String(formData.get('password') ?? '')
  const raw = String(formData.get('next') ?? '')
  // 外部へ飛ばす踏み台にしない。**自分のパスだけ**を許す。
  const next = SAFE_NEXT.test(raw) && !raw.startsWith('//') ? raw : ''

  const secret = process.env.YOUTHDB_SESSION_SECRET
  // 未設定の層は `checkPassword` が誰も通さない（既定値を持たない）。
  // 普通の層は YOUTHDB_PASSWORD2 でも設定できる（依頼者が本番でこの名前を使った）。
  // 明示された PASSWORD2 を優先する。
  const tier = matchTier({
    all: process.env.YOUTHDB_PASSWORD,
    personal: process.env.YOUTHDB_PASSWORD2 ?? process.env.YOUTHDB_PASSWORD_PERSONAL,
    input: process.env.YOUTHDB_PASSWORD_INPUT,
  }, password)

  if (!secret || !tier) {
    // ★ 失敗のたびに少し待つ。合言葉は層ごとに1つで、総当たりが効く。
    //   回数を数える置き場所がサーバレスに無いので、**時間で削る。**
    //   0.5 秒でも、1秒あたりの試行が 2 回に落ちる。
    await new Promise((r) => { setTimeout(r, 500) })
    redirect(`/login?e=1${raw ? `&next=${encodeURIComponent(raw)}` : ''}`)
  }

  // ★ 見ようとしていた場所が**その層に開いていなければ、層の入口へ送る。**
  //   そのまま送ると proxy に弾かれ、入った直後に別の画面へ飛ばされる。
  const to = next && canOpen(tier, next) ? next : TIER_HOME[tier]

  const jar = await cookies()
  jar.set(SESSION_COOKIE, await issueSession(secret, tier, Date.now()), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  })
  redirect(to)
}

/** 出る。引換券を捨てるだけ。 */
export async function signOutAction(): Promise<void> {
  const jar = await cookies()
  jar.delete(SESSION_COOKIE)
  redirect('/login')
}

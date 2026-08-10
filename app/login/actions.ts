'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import {
  SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, checkPassword, issueSession,
} from '../../src/auth/session.ts'

/**
 * 合言葉を確かめて、引換券を渡す。
 *
 * ★ 合言葉そのものは Cookie に入れない。**署名した引換券**を入れる。
 * ★ 失敗の理由を分けない ―― 「合言葉が違う」以外を返すと、
 *   設定の有無まで外から分かる。
 */
const SAFE_NEXT = /^\/[A-Za-z0-9\-._~/?&=%[\]]*$/

export async function signInAction(formData: FormData): Promise<void> {
  const password = String(formData.get('password') ?? '')
  const raw = String(formData.get('next') ?? '')
  // 外部へ飛ばす踏み台にしない。**自分のパスだけ**を許す。
  const next = SAFE_NEXT.test(raw) && !raw.startsWith('//') ? raw : '/headhunting'

  const secret = process.env.YOUTHDB_SESSION_SECRET
  if (!secret || !checkPassword(process.env.YOUTHDB_PASSWORD, password)) {
    // ★ 失敗のたびに少し待つ。合言葉は1つしかなく、総当たりが効く。
    //   回数を数える置き場所がサーバレスに無いので、**時間で削る。**
    //   0.5 秒でも、1秒あたりの試行が 2 回に落ちる。
    await new Promise((r) => { setTimeout(r, 500) })
    redirect(`/login?e=1${raw ? `&next=${encodeURIComponent(raw)}` : ''}`)
  }

  const jar = await cookies()
  jar.set(SESSION_COOKIE, await issueSession(secret, Date.now()), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  })
  redirect(next)
}

/** 出る。引換券を捨てるだけ。 */
export async function signOutAction(): Promise<void> {
  const jar = await cookies()
  jar.delete(SESSION_COOKIE)
  redirect('/login')
}

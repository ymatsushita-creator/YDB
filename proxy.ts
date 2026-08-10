import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, verifySession } from './src/auth/session.ts'

/**
 * 入口を1箇所で閉じる（依頼者の指示。実行⑩）。
 *
 * ★ **画面ごとに書かない。** 1枚でも書き忘れると、そこだけ開く。
 *   ここは全部の要求を通るので、閉じ忘れが起きない。
 *
 * ★ ファイル名は `proxy.ts`。Next 16 で `middleware.ts` は非推奨になった。
 *
 * ★ 通すのは「合言葉を聞く画面」と、その画面が動くのに要るものだけ ――
 *   ロゴと Next の資材。**中身の画面は1つも通さない。**
 *
 * ★ `'use client'` は増えていない。ここはサーバ側で動く。
 */

const PUBLIC_PREFIXES = ['/login', '/_next', '/brand', '/favicon']

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next()
  }

  const secret = process.env.YOUTHDB_SESSION_SECRET
  // ★ 秘密鍵が無ければ**誰も入れない。** 設定を忘れた瞬間に全部が開く、
  //   という事故のほうが取り返しがつかない。
  if (!secret) return toLogin(req, 'unconfigured')

  return verifySession(secret, req.cookies.get(SESSION_COOKIE)?.value, Date.now())
    .then((ok) => (ok ? NextResponse.next() : toLogin(req, null)))
}

function toLogin(req: NextRequest, reason: string | null) {
  const url = req.nextUrl.clone()
  url.pathname = '/login'
  url.search = ''
  // 戻り先は**パスだけ**を持ち回る。URL をまるごと渡すと、
  // 外部へ飛ばす踏み台になる（オープンリダイレクト）。
  const back = `${req.nextUrl.pathname}${req.nextUrl.search}`
  if (back !== '/' && !back.startsWith('/login')) url.searchParams.set('next', back)
  if (reason) url.searchParams.set('why', reason)
  return NextResponse.redirect(url)
}

export const config = {
  // 画像や資材まで毎回通すと遅い。除外はここ1箇所に書く。
  matcher: ['/((?!_next/static|_next/image|favicon.ico|brand/).*)'],
}

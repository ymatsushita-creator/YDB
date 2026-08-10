import 'server-only'
import { cookies } from 'next/headers'
import { SESSION_COOKIE, verifySession } from './session.ts'
import type { Tier } from './tiers.ts'

/**
 * いま入っている層（実行⑪）。
 *
 * ★ 引換券から**読み直す。** 画面へ層を引数で配らない ――
 *   配ると、渡し忘れた画面が「層の分からない画面」になり、
 *   そこだけ全部のタブが出る。券は `proxy.ts` が確かめたものと同じである。
 *
 * ★ ここは next/headers を使うのでサーバ専用。
 *   Edge の `proxy.ts` からは呼ばない（あちらは Cookie を直接持っている）。
 */
export const currentTier = async (): Promise<Tier | null> => {
  const secret = process.env.YOUTHDB_SESSION_SECRET
  if (!secret) return null
  const jar = await cookies()
  return verifySession(secret, jar.get(SESSION_COOKIE)?.value, Date.now())
}

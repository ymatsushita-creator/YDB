import { redirect } from 'next/navigation'
import { currentTier } from '../src/auth/current.ts'
import { TIER_HOME } from '../src/auth/tiers.ts'

export const dynamic = 'force-dynamic'

/**
 * 入口。
 *
 * 実行⑨で行き先が3つになった（ヘッドハンティング / 個人アプローチ /
 * 団体アプローチ）。ここに4つ目の画面を置くと、タブに無い画面がトップに座る。
 * 先頭のタブへ送る。
 *
 * ★ 送り先は**層で違う**（実行⑪）。`/headhunting` に固定すると、
 *   ヘッドハンティングを開けない層が入った直後に弾かれる。
 *   券が無ければ `/headhunting` へ送り、proxy に合言葉を聞かせる。
 */
export default async function Home() {
  const tier = await currentTier()
  redirect(tier === null ? '/headhunting' : TIER_HOME[tier])
}

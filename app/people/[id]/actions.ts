'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { currentTier } from '../../../src/auth/current.ts'
import { getDb } from '../../../src/db/server.ts'
import { startSelection } from '../../../src/commands/decide.ts'

/**
 * 応募から選考を始める（C-210。通しの検査で見つけた穴）。
 *
 * ★ 記録層に口を作っただけでは、運用では**始められない。**
 *   応募を入れても1段目の評価行が誰にも作られず、
 *   書類選考から先へ一歩も進めない状態だった。
 *
 * ★ 入力層には開けない ―― 選考を動かす操作である。
 * ★ 冪等（コマンド側で二度押しを弾く）。
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function startSelectionAction(formData: FormData): Promise<void> {
  const personId = String(formData.get('personId') ?? '')
  const applicationId = String(formData.get('applicationId') ?? '')
  // ★ 期を持ち回る（C-216。平社員ペルソナ試験で詰まった）――
  //   戻り先から落とすと、選考を始めた直後に進行中の期へ戻り、
  //   操作柱のタブからも期が消える。**個人IDはURLへ載せて良いが**
  //   （既にパスに居る）、期は形を確かめてから足す。
  const seasonRaw = String(formData.get('season') ?? '')
  const season = UUID.test(seasonRaw) ? `&season=${seasonRaw}` : ''
  const tier = await currentTier()
  if (tier === 'input' || tier === null) {
    redirect(`/people/${personId}?result=forbidden${season}`)
  }

  const result = await startSelection(await getDb(), applicationId)
  if (result.ok) revalidatePath(`/people/${personId}`)
  redirect(`/people/${personId}?result=${result.ok ? 'started' : result.reason}${season}`)
}

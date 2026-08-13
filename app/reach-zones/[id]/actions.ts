'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getDb } from '../../../src/db/server.ts'
import {
  correctPartnerRecommendation, type CorrectRecommendationFailure,
} from '../../../src/commands/partner.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 推薦枠ステイタスを訂正する（実行⑮。C-131）。
 *
 * 判定は `src/commands/partner.ts` の `correctPartnerRecommendation`。
 * ここは受け渡しと戻り先だけ。
 *
 * ★ **置くのは表（`/approach` の「団体を直す」）、直すのはここ。**
 *   同じ操作を2箇所に置かない ―― 表は行をまとめて送るので、
 *   「直前の1件を打ち消す」という**行1つに閉じた操作**には向かない。
 *
 * ★ 打ち消す相手（出来事の ID）は画面から渡さない。コマンドが
 *   記録層の並びから引く ―― 渡すと、古い画面を開いたまま押したときに
 *   **見ていない行を打ち消せる。**
 *
 * ★ URL に載せるのは期と結果コードだけ。団体名も理由も載せない。
 */
export async function correctRecommendationAction(formData: FormData): Promise<void> {
  const partnerId = String(formData.get('partnerId') ?? '')
  const seasonId = String(formData.get('seasonId') ?? '')

  const back = (code: CorrectRecommendationFailure | 'corrected') => {
    const q = new URLSearchParams()
    if (UUID.test(seasonId)) q.set('season', seasonId)
    q.set('rec', code)
    redirect(UUID.test(partnerId) ? `/reach-zones/${partnerId}?${q}` : `/approach?${q}`)
  }

  const db = await getDb()
  const result = await correctPartnerRecommendation(db, {
    partnerId,
    seasonId,
    stateId: String(formData.get('stateId') ?? ''),
    staffId: String(formData.get('staffId') ?? ''),
    note: String(formData.get('recommendationNote') ?? ''),
  })
  if (!result.ok) return back(result.reason)

  // 同じ値が連携団体の表にも出る。片方だけ古いままにしない。
  revalidatePath('/approach')
  revalidatePath(`/reach-zones/${partnerId}`)
  back('corrected')
}

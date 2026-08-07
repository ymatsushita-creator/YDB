'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getDb } from '../../src/db/server.ts'
import {
  assignInterviewer, reassignInterviewer,
  type AssignCode, type ReassignCode,
} from '../../src/commands/assign.ts'
import { unholdEvaluation, type UnholdCode } from '../../src/commands/unhold.ts'

/**
 * 画面からの書き込み。
 *
 * ★ `'use server'` は `'use client'` の対ではない。
 *   これはサーバで動く関数の宣言であって、クライアント境界の新設ではない。
 *   このファイルにクライアント側のコードは1行も入らず、`'use client'` は
 *   引き続き0件のままである。フォームは素の `<form action={...}>` として
 *   サーバコンポーネントの中に置くので、**JavaScript を無効にしても動く。**
 *
 *   HANDOFF の「クライアント側のライブラリを採用するのはクライアント境界を
 *   新設する判断と同義」は、状態を持つ対話部品の話である。ここでやるのは
 *   HTML フォームの送信なので、その判断には触れていない。
 *
 * 検証は `src/commands/assign.ts` にある。サーバアクションは Next の実行時が
 * 要るためテストから直接呼べない。**判定を持つ側をテストできる場所に置き、
 * ここは受け渡しだけにする。**
 */

/**
 * 結果の伝え方について。
 *
 * `useActionState` で戻り値を受けるにはクライアント部品が要る。
 * 代わりに、済んだあと結果コードを付けて同じ画面へ戻す（PRG）。
 * JavaScript が無くても成立する、いちばん単純な形である。
 *
 * **コードだけを渡し、氏名や応募の id は渡さない。** URL は履歴にも
 * ログにも残るので、個人が分かる値を置く場所ではない。
 * 「誰を誰に割り当てたか」は、戻った画面のやることの一覧を見れば分かる。
 */
export async function assignAction(formData: FormData): Promise<void> {
  const evaluationId = String(formData.get('evaluationId') ?? '')
  const staffId = String(formData.get('staffId') ?? '')
  const seasonId = String(formData.get('seasonId') ?? '')

  const back = (code: AssignCode) => {
    const season = /^[0-9a-f-]{36}$/i.test(seasonId) ? `season=${seasonId}&` : ''
    redirect(`/cockpit?${season}assign=${code}`)
  }

  if (!staffId) back('no_staff')

  const db = await getDb()
  const result = await assignInterviewer(db, { evaluationId, staffId })

  if (!result.ok) back(result.reason)

  // やること・待っている人・森の集計が同時に変わる。画面ごとに別の数字が
  // 残らないよう、コックピットと森の画面をまとめて作り直す。
  revalidatePath('/cockpit')
  revalidatePath('/forests', 'layout')
  back('ok')
}


/**
 * 保留を解く。
 *
 * `assignAction` と同じ形である。判定は `src/commands/unhold.ts` にあり、
 * ここは値の受け渡しと、結果コードを付けて戻すことだけをする。
 *
 * 選ぶものが無いので `<select>` は無く、ボタン1つのフォームになる。
 */
export async function unholdAction(formData: FormData): Promise<void> {
  const evaluationId = String(formData.get('evaluationId') ?? '')
  const seasonId = String(formData.get('seasonId') ?? '')

  const back = (code: UnholdCode) => {
    const season = /^[0-9a-f-]{36}$/i.test(seasonId) ? `season=${seasonId}&` : ''
    redirect(`/cockpit?${season}unhold=${code}`)
  }

  const db = await getDb()
  const result = await unholdEvaluation(db, { evaluationId })

  if (!result.ok) back(result.reason)

  revalidatePath('/cockpit')
  revalidatePath('/forests', 'layout')
  back('unheld')
}


/**
 * 担当を替える。
 *
 * `assignAction` と同じ形。違うのは**成り立つ条件が逆**なことである
 * （あちらは担当がいないことを、こちらはいることを要求する）。
 * 判定は `src/commands/assign.ts` の `reassignInterviewer` にある。
 */
export async function reassignAction(formData: FormData): Promise<void> {
  const evaluationId = String(formData.get('evaluationId') ?? '')
  const staffId = String(formData.get('staffId') ?? '')
  const seasonId = String(formData.get('seasonId') ?? '')

  const back = (code: ReassignCode) => {
    const season = /^[0-9a-f-]{36}$/i.test(seasonId) ? `season=${seasonId}&` : ''
    redirect(`/cockpit?${season}reassign=${code}`)
  }

  if (!staffId) back('same_staff')

  const db = await getDb()
  const result = await reassignInterviewer(db, { evaluationId, staffId })

  if (!result.ok) back(result.reason)

  revalidatePath('/cockpit')
  revalidatePath('/forests', 'layout')
  back('reassigned')
}

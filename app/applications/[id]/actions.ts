'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getDb } from '../../../src/db/server.ts'
import { saveScore, type SaveScoreCode } from '../../../src/commands/score.ts'

/**
 * 1軸の点と根拠を保存する（E2）。
 *
 * `app/cockpit/actions.ts` と同じ形。判定は `src/commands/score.ts` にあり、
 * ここは受け渡しと、結果コードを付けて戻すことだけをする。
 *
 * 素の `<form action={...}>` に渡すので `'use client'` は増えない。
 * **JavaScript を無効にしても保存できる。**
 */
export async function saveScoreAction(formData: FormData): Promise<void> {
  const applicationId = String(formData.get('applicationId') ?? '')
  const evaluationId = String(formData.get('evaluationId') ?? '')
  const criteriaId = String(formData.get('criteriaId') ?? '')
  const rationale = String(formData.get('rationale') ?? '')
  // 数値の解釈だけはここでやる。判定ではなく、型の変換である。
  // 空欄や数字でない値は NaN になり、コマンド側が範囲外として弾く。
  const score = Number(formData.get('score'))

  const back = (code: SaveScoreCode) => {
    const id = /^[0-9a-f-]{36}$/i.test(applicationId) ? applicationId : ''
    // 氏名も軸の名前も URL に入れない。コードだけ（C-20 と同じ）。
    redirect(`/applications/${id}?score=${code}`)
  }

  const db = await getDb()
  const result = await saveScore(db, { evaluationId, criteriaId, score, rationale })

  if (!result.ok) back(result.reason)

  // 運転席の「n/m 軸」も変わる。画面ごとに別の数字が残らないよう両方作り直す。
  revalidatePath(`/applications/${applicationId}`)
  revalidatePath('/cockpit')
  back('saved')
}

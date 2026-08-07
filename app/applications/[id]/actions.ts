'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getDb } from '../../../src/db/server.ts'
import { saveScore, type SaveScoreCode } from '../../../src/commands/score.ts'
import {
  submitEvaluation, decideStep, type DecideCode,
} from '../../../src/commands/decide.ts'

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

  // `redirect` は例外を投げるが型には出ないので、明示的に返して絞り込む。
  if (!result.ok) return back(result.reason)

  // 運転席の「n/m 軸」も変わる。画面ごとに別の数字が残らないよう両方作り直す。
  revalidatePath(`/applications/${applicationId}`)
  revalidatePath('/cockpit')
  back('saved')
}

/**
 * 評価を確定する（E3）と、選考を判定する（D1）。
 *
 * どちらも判定は `src/commands/decide.ts` にある。ここは受け渡しだけ。
 */
export async function submitEvaluationAction(formData: FormData): Promise<void> {
  const applicationId = String(formData.get('applicationId') ?? '')
  const evaluationId = String(formData.get('evaluationId') ?? '')
  const back = (code: DecideCode) => {
    const id = /^[0-9a-f-]{36}$/i.test(applicationId) ? applicationId : ''
    redirect(`/applications/${id}?decide=${code}`)
  }

  const db = await getDb()
  const result = await submitEvaluation(db, { evaluationId })
  // `redirect` は例外を投げるが型には出ないので、明示的に返して絞り込む。
  if (!result.ok) return back(result.reason)

  revalidatePath(`/applications/${applicationId}`)
  revalidatePath('/cockpit')
  back('submitted')
}

export async function decideAction(formData: FormData): Promise<void> {
  const applicationId = String(formData.get('applicationId') ?? '')
  const staffId = String(formData.get('staffId') ?? '')
  const note = String(formData.get('note') ?? '')
  const decision = String(formData.get('decision') ?? '')

  const back = (code: DecideCode) => {
    const id = /^[0-9a-f-]{36}$/i.test(applicationId) ? applicationId : ''
    redirect(`/applications/${id}?decide=${code}`)
  }

  if (decision !== 'advance' && decision !== 'reject') return back('bad_decision')

  const db = await getDb()
  const result = await decideStep(db, {
    applicationId,
    decision: decision as 'advance' | 'reject',
    staffId,
    note,
  })
  // `redirect` は例外を投げるが型には出ないので、明示的に返して絞り込む。
  if (!result.ok) return back(result.reason)

  revalidatePath(`/applications/${applicationId}`)
  revalidatePath('/cockpit')
  // 合格・通過・不合格で、運用者に返す言葉を変える。
  back(result.decision === 'reject' ? 'rejected' : result.accepted ? 'accepted' : 'advanced')
}

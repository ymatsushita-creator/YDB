'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getDb } from '../../../src/db/server.ts'
import { saveScore, type SaveScoreCode } from '../../../src/commands/score.ts'
import {
  submitEvaluation, decideStep, correctDecision, type DecideCode,
} from '../../../src/commands/decide.ts'
import { holdEvaluation, type HoldCode } from '../../../src/commands/hold.ts'

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

/**
 * 保留にする。
 *
 * 運転席にも同じ操作があるが、あちらは**先頭のやることにしか出ない**。
 * 候補者を開いてから止めたい場面のほうが多いので、こちらにも置く（C-35）。
 * 理由は必須。空白だけの理由は `holdEvaluation` が弾く。
 */
export async function holdAction(formData: FormData): Promise<void> {
  const applicationId = String(formData.get('applicationId') ?? '')
  const evaluationId = String(formData.get('evaluationId') ?? '')
  const reason = String(formData.get('reason') ?? '')

  const back = (code: HoldCode) => {
    const id = /^[0-9a-f-]{36}$/i.test(applicationId) ? applicationId : ''
    redirect(`/applications/${id}?hold=${code}`)
  }

  const db = await getDb()
  const result = await holdEvaluation(db, { evaluationId, reason })
  if (!result.ok) return back(result.reason)

  revalidatePath(`/applications/${applicationId}`)
  revalidatePath('/cockpit')
  back('held')
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


/**
 * 判定を訂正する（D2）。打ち消し行を1行追記する。
 *
 * 記録層が最初から持っている仕組み（`corrects_history_id` /
 * `is_correction` / `v_effective_status_histories`）に入口を付けただけで、
 * 新しい概念は足していない。
 */
export async function correctDecisionAction(formData: FormData): Promise<void> {
  const applicationId = String(formData.get('applicationId') ?? '')
  const historyId = String(formData.get('historyId') ?? '')
  const staffId = String(formData.get('staffId') ?? '')
  const note = String(formData.get('note') ?? '')

  const back = (code: DecideCode) => {
    const id = /^[0-9a-f-]{36}$/i.test(applicationId) ? applicationId : ''
    redirect(`/applications/${id}?decide=${code}`)
  }

  const db = await getDb()
  const result = await correctDecision(db, { applicationId, historyId, staffId, note })
  if (!result.ok) return back(result.reason)

  revalidatePath(`/applications/${applicationId}`)
  revalidatePath('/cockpit')
  back(result.decision === 'advance' ? 'corrected_to_advance' : 'corrected_to_reject')
}

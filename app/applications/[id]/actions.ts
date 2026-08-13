'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getDb } from '../../../src/db/server.ts'
import { saveScore, correctScore, type SaveScoreCode } from '../../../src/commands/score.ts'
import {
  submitEvaluation, decideStep, correctDecision, type DecideCode,
} from '../../../src/commands/decide.ts'
import { holdEvaluation, type HoldCode } from '../../../src/commands/hold.ts'
import {
  assignInterviewer, reassignInterviewer, type AssignCode, type ReassignCode,
} from '../../../src/commands/assign.ts'
import { unholdEvaluation, type UnholdCode } from '../../../src/commands/unhold.ts'

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

  // ボーダーラインの「n/m 軸」も変わる。画面ごとに別の数字が残らないよう両方作り直す。
  revalidatePath(`/applications/${applicationId}`)
  revalidatePath('/borderline')
  back('saved')
}

/**
 * 付いている点と根拠を打ち直す（E4。実行⑮。C-133）。
 *
 * 判定は `src/commands/score.ts` の `correctScore`。ここは受け渡しだけ。
 * ボーダーラインの同じ操作（`correctScoreOnBorderlineAction`）と**同じ
 * コマンドを呼ぶ** ―― どちらから直しても同じ規則が効く。
 */
export async function correctScoreAction(formData: FormData): Promise<void> {
  const applicationId = String(formData.get('applicationId') ?? '')
  const evaluationId = String(formData.get('evaluationId') ?? '')
  const criteriaId = String(formData.get('criteriaId') ?? '')
  const rationale = String(formData.get('rationale') ?? '')
  const score = Number(formData.get('score'))

  const back = (code: SaveScoreCode) => {
    const id = /^[0-9a-f-]{36}$/i.test(applicationId) ? applicationId : ''
    redirect(`/applications/${id}?score=${code}`)
  }

  const db = await getDb()
  const result = await correctScore(db, { evaluationId, criteriaId, score, rationale })
  if (!result.ok) return back(result.reason)

  revalidatePath(`/applications/${applicationId}`)
  revalidatePath('/borderline')
  revalidatePath(`/interviews/${evaluationId}`)
  back('corrected')
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
  revalidatePath('/borderline')
  back('submitted')
}

/**
 * 保留にする。
 *
 * ボーダーラインにも同じ操作があるが、あちらは**先頭のやることにしか出ない**。
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
  revalidatePath('/borderline')
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
    decision,
    staffId,
    note,
  })
  // `redirect` は例外を投げるが型には出ないので、明示的に返して絞り込む。
  if (!result.ok) return back(result.reason)

  revalidatePath(`/applications/${applicationId}`)
  revalidatePath('/borderline')
  // 合格・通過・不合格で、運用者に返す言葉を変える。
  back(result.decision === 'reject' ? 'rejected' : result.accepted ? 'accepted' : 'advanced')
}

/**
 * 結果の並びから判定を編集する。
 *
 * **上書きではない。** 記録層は打ち消し行の追記でしか直せないので、
 * 元の判定は残り、編集した事実が1行積まれる（`corrects_history_id` /
 * `is_correction` / `v_effective_status_histories`）。
 * 画面には「編集」と出すが、記録の側では新しい概念を1つも足していない。
 *
 * 画面が見ていた判定と、いま編集できる判定がずれていたら通さない
 * （判定は `src/commands/decide.ts` が確かめる）。別の誰かが先に編集して
 * いた場合に、見ていたのとは違う行を打ち消さないため。
 */
export async function editDecisionAction(formData: FormData): Promise<void> {
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
  revalidatePath('/borderline')
  back(result.decision === 'advance' ? 'corrected_to_advance' : 'corrected_to_reject')
}

// -------------------------------------------------------------
// 担当と保留（実行⑨で app/borderline から移した）
//
// 新しいボーダーラインは一覧と日程の画面になり、1件ずつの操作を置く場所が
// 無くなった。**操作を消すのではなく、操作の対象が見えている場所へ移した。**
// 派生のやることはこの応募の画面へ飛ぶので、飛んだ先で手が止まらない。
//
// 「保留にする」はこのファイルに元からある（holdAction）。**2つ作らない。**
// -------------------------------------------------------------

/** 戻り先はこの応募の画面。氏名も判定の結果も URL に載せない（コードだけ）。 */
const appId = (formData: FormData) => {
  const id = String(formData.get('applicationId') ?? '')
  return /^[0-9a-f-]{36}$/i.test(id) ? id : ''
}

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

  const back = (code: AssignCode) => {
    redirect(`/applications/${appId(formData)}?assign=${code}`)
  }

  if (!staffId) return back('no_staff')

  const db = await getDb()
  const result = await assignInterviewer(db, { evaluationId, staffId })

  // `redirect` は例外を投げるが型には出ないので、明示的に返して絞り込む。
  if (!result.ok) return back(result.reason)

  // やること・待っている人・アプローチ可能圏の集計が同時に変わる。
  revalidatePath('/borderline')
  revalidatePath('/reach-zones', 'layout')
  back('ok')
}


/**
 * 保留にする。
 *
 * `unhold` の対である。**片道しか無かった**（C-35）。
 * 理由は必須なので、こちらだけ入力欄がある。空白だけの理由は
 * `holdEvaluation` が弾く ―― 制約は NOT NULL だけで、空白は通ってしまう。
 */


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

  const back = (code: UnholdCode) => {
    redirect(`/applications/${appId(formData)}?unhold=${code}`)
  }

  const db = await getDb()
  const result = await unholdEvaluation(db, { evaluationId })

  // `redirect` は例外を投げるが型には出ないので、明示的に返して絞り込む。
  if (!result.ok) return back(result.reason)

  revalidatePath('/borderline')
  revalidatePath('/reach-zones', 'layout')
  back('unheld')
}


/**
 * 担当を替える。
 *
 * `assignAction` と同じ形。違うのは**成り立つ条件が逆**なことである
 * （あちらは担当がいないことを、こちらはいることを要求する）。
 * 判定は `src/commands/assign.ts` の `reassignInterviewer` にある。
 */


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

  const back = (code: ReassignCode) => {
    redirect(`/applications/${appId(formData)}?reassign=${code}`)
  }

  if (!staffId) return back('same_staff')

  const db = await getDb()
  const result = await reassignInterviewer(db, { evaluationId, staffId })

  // `redirect` は例外を投げるが型には出ないので、明示的に返して絞り込む。
  if (!result.ok) return back(result.reason)

  revalidatePath('/borderline')
  revalidatePath('/reach-zones', 'layout')
  back('reassigned')
}

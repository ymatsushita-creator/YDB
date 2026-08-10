'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getDb } from '../../../src/db/server.ts'
import {
  saveInterviewSheet, type SaveInterviewCode,
} from '../../../src/commands/interview.ts'
import { saveScore, type SaveScoreCode } from '../../../src/commands/score.ts'

/**
 * 面接シートの保存（依頼者の指示。実行⑩）。
 *
 * 判定は `src/commands/interview.ts` にある。ここは受け渡しと、
 * 結果コードを付けて戻すことだけをする。
 *
 * 素の `<form action={...}>` に渡すので `'use client'` は増えない。
 * **JavaScript を無効にしても書ける。**
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const text = (form: FormData, name: string) => String(form.get(name) ?? '')

const back = (evaluationId: string, query: Record<string, string>) => {
  const id = UUID.test(evaluationId) ? evaluationId : ''
  // 氏名も記入内容も URL に載せない。コードだけ（C-20 と同じ）。
  redirect(`/interviews/${id}?${new URLSearchParams(query)}`)
}

/** 記入欄と最終判定をまとめて保存する。 */
export async function saveInterviewAction(formData: FormData): Promise<void> {
  const evaluationId = text(formData, 'evaluationId')

  const db = await getDb()
  const result = await saveInterviewSheet(db, {
    evaluationId,
    staffId: text(formData, 'staffId'),
    interviewedOn: text(formData, 'interviewedOn'),
    firstImpression: text(formData, 'firstImpression'),
    checkPointNotes: text(formData, 'checkPointNotes'),
    strengths: text(formData, 'strengths'),
    concerns: text(formData, 'concerns'),
    ownChallenge: text(formData, 'ownChallenge'),
    neoCareerLink: text(formData, 'neoCareerLink'),
    neoUsagePlan: text(formData, 'neoUsagePlan'),
    overallComment: text(formData, 'overallComment'),
    recommendation: text(formData, 'recommendation'),
    recommendationNote: text(formData, 'recommendationNote'),
  })

  const code: SaveInterviewCode = result.ok ? 'saved' : result.reason
  if (result.ok) {
    revalidatePath(`/interviews/${evaluationId}`)
    // 同じ面接の点と所見は、応募の画面と採点レイヤーにも出る。
    // 片方だけ古いままにしない。
    revalidatePath('/borderline')
    revalidatePath(`/applications/${text(formData, 'applicationId')}`)
    revalidatePath(`/people/${text(formData, 'personId')}`)
  }
  back(evaluationId, { sheet: code })
}

/**
 * 1軸の点と根拠を保存する。
 *
 * ★ **記入欄とは別の入口にしてある。** 点の単位は記録層で
 *   `(evaluation_id, criteria_id)` の1行で、面接の途中で1つだけ
 *   書き留められることに意味がある（`src/commands/score.ts`）。
 *   記入欄と一緒に送ると、根拠が1つ空いているだけで全部保存できなくなる。
 */
export async function saveInterviewScoreAction(formData: FormData): Promise<void> {
  const evaluationId = text(formData, 'evaluationId')
  // 数値の解釈だけここでやる。判定ではなく型の変換である。
  const score = Number(formData.get('score'))

  const db = await getDb()
  const result = await saveScore(db, {
    evaluationId,
    criteriaId: text(formData, 'criteriaId'),
    score,
    rationale: text(formData, 'rationale'),
  })

  const code: SaveScoreCode = result.ok ? 'saved' : result.reason
  if (result.ok) {
    revalidatePath(`/interviews/${evaluationId}`)
    revalidatePath('/borderline')
    revalidatePath(`/applications/${text(formData, 'applicationId')}`)
  }
  back(evaluationId, { score: code })
}

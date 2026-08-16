'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { currentTier } from '../../src/auth/current.ts'
import { getDb } from '../../src/db/server.ts'
import { listAiPreAssessmentTargets } from '../../src/queries/ai_pre_assessment.ts'
import { listAiPreLabels, recordAiPreAssessment } from '../../src/commands/ai_pre_assessment.ts'
import { assessApplication, SCALE_MAX } from '../../src/ai/pre_assessment.ts'

const t = (f: FormData, key: string) => String(f.get(key) ?? '').trim()

function back(seasonId: string, result: string, again = false): never {
  const p = new URLSearchParams({ result })
  if (/^[0-9a-f-]{36}$/i.test(seasonId)) p.set('season', seasonId)
  if (again) p.set('again', '1')
  redirect(`/ai?${p}`)
}

/** 入力された鍵はこの関数のローカル変数だけに置き、保存もURLへの転記もしない。 */
export async function runAiPreAssessmentAction(formData: FormData): Promise<void> {
  const seasonId = t(formData, 'seasonId')
  const again = t(formData, 'again') === '1'
  if (await currentTier() !== 'all') back(seasonId, 'forbidden', again)
  const apiKey = t(formData, 'apiKey')
  if (!apiKey) back(seasonId, 'key_required', again)

  const db = await getDb()
  const [target] = await listAiPreAssessmentTargets(db, seasonId, again)
  if (!target) back(seasonId, 'empty', again)
  const labels = await listAiPreLabels(db)

  try {
    const got = await assessApplication({
      labels,
      // 設問と回答の切り分けを推測せず、応募フォーム本文をそのまま渡す。
      answers: [{ question: '応募フォームの回答', answer: target.body }],
    }, { apiKey })
    const saved = await recordAiPreAssessment(db, {
      personId: target.person_id, seasonId,
      selectionStepId: target.selection_step_id,
      labelCode: got.label, rationale: got.rationale, model: got.model,
      source: 'person_notes（応募フォーム）',
      viewpoints: got.viewpoints.map((v) => ({ ...v, scaleMax: SCALE_MAX })),
    })
    if (!saved.ok) back(seasonId, 'record_failed', again)
    revalidatePath('/headhunting')
    back(seasonId, 'saved', again)
  } catch (error) {
    const status = typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status?: unknown }).status) : 0
    back(seasonId, status === 401 ? 'bad_key' : 'api_failed', again)
  }
}

'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { currentTier } from '../../src/auth/current.ts'
import { getDb } from '../../src/db/server.ts'
import { listAiPreAssessmentTargets } from '../../src/queries/ai_pre_assessment.ts'
import { listAiPreLabels, recordAiPreAssessment } from '../../src/commands/ai_pre_assessment.ts'
import { assessApplication, SCALE_MAX } from '../../src/ai/pre_assessment.ts'
import { loadAnthropicApiKey, saveAnthropicApiKey } from '../../src/secrets/anthropic.ts'

const t = (f: FormData, key: string) => String(f.get(key) ?? '').trim()

function back(seasonId: string, personId: string, result: string, again = false): never {
  const p = new URLSearchParams({ result })
  if (/^[0-9a-f-]{36}$/i.test(seasonId)) p.set('season', seasonId)
  if (/^[0-9a-f-]{36}$/i.test(personId)) p.set('person', personId)
  if (again) p.set('again', '1')
  redirect(`/ai?${p}`)
}

export async function saveAnthropicApiKeyAction(formData: FormData): Promise<void> {
  const seasonId = t(formData, 'seasonId')
  const personId = t(formData, 'personId')
  if (await currentTier() !== 'all') back(seasonId, personId, 'forbidden')
  const result = await saveAnthropicApiKey(
    await getDb(), t(formData, 'apiKey'), process.env.YOUTHDB_SESSION_SECRET)
  back(seasonId, personId, result.ok ? 'key_saved' : result.reason)
}

/** 登録済みの鍵を復号し、その実行だけAIクライアントへ渡す。 */
export async function runAiPreAssessmentAction(formData: FormData): Promise<void> {
  const seasonId = t(formData, 'seasonId')
  const personId = t(formData, 'personId')
  const again = t(formData, 'again') === '1'
  if (await currentTier() !== 'all') back(seasonId, personId, 'forbidden', again)
  const db = await getDb()
  const apiKey = await loadAnthropicApiKey(db, process.env.YOUTHDB_SESSION_SECRET)
  if (!apiKey) back(seasonId, personId, 'key_required', again)
  const [target] = await listAiPreAssessmentTargets(db, seasonId, again, personId)
  if (!target) back(seasonId, personId, 'empty', again)
  const labels = await listAiPreLabels(db)

  let outcome = 'saved'
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
    if (!saved.ok) outcome = 'record_failed'
    else revalidatePath('/headhunting')
  } catch (error) {
    const status = typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status?: unknown }).status) : 0
    outcome = status === 401 ? 'bad_key' : 'api_failed'
  }
  back(seasonId, personId, outcome, again)
}

import { maybeOne, all, type Db } from '../db/client.ts'

/**
 * AI分析の事前ステータスを記録する（0044。C-164）。
 *
 * ★ 追記専用。同じ人・同じ期・同じ段に既にあれば、**打ち消し行で置き換える**
 *   （0039 の確度と同じ形）。再分析しても前の分析は消えない。
 *
 * ★ **`evaluation_scores` へは書かない。** ここが分かれ道である ――
 *   依頼者の指示：「通常の成績としては扱わない」。
 */

export type RecordAiPreAssessmentResult =
  | { ok: true; assessmentId: string; previousId: string | null }
  | { ok: false; reason: RecordAiPreAssessmentFailure }

export type RecordAiPreAssessmentFailure =
  | 'person_not_found'
  | 'person_deleted'
  | 'season_not_found'
  | 'step_not_found'
  | 'label_not_found'
  | 'rationale_required'
  | 'rationale_too_long'
  | 'model_required'
  | 'source_required'

export const RATIONALE_MAX = 2000

/** ★ C-132 と同じ穴を塞ぐ。同着すると現在値が id（乱数）で決まる。 */
const AFTER_LAST = `greatest(now(),
    (SELECT max(occurred_at) + interval '1 microsecond'
       FROM ai_pre_assessments
      WHERE person_id = $1 AND season_id = $2 AND selection_step_id = $3))`

export interface AiPreLabel { id: string; code: string; definition: string }

export const listAiPreLabels = (db: Db): Promise<AiPreLabel[]> =>
  all<AiPreLabel>(db, `
    SELECT id, code, definition FROM ai_pre_labels
     WHERE is_active ORDER BY sort_order`)

export async function recordAiPreAssessment(
  db: Db,
  input: {
    personId: string
    seasonId: string
    selectionStepId: string
    labelCode: string
    rationale: string
    model: string
    source: string
  },
): Promise<RecordAiPreAssessmentResult> {
  const rationale = (input.rationale ?? '').trim()
  if (!rationale) return { ok: false, reason: 'rationale_required' }
  if (rationale.length > RATIONALE_MAX) return { ok: false, reason: 'rationale_too_long' }
  const model = (input.model ?? '').trim()
  if (!model) return { ok: false, reason: 'model_required' }
  const source = (input.source ?? '').trim()
  if (!source) return { ok: false, reason: 'source_required' }

  const person = await maybeOne<{ deleted_at: Date | null }>(db,
    `SELECT deleted_at FROM persons WHERE id = $1`, [input.personId])
  if (!person) return { ok: false, reason: 'person_not_found' }
  if (person.deleted_at !== null) return { ok: false, reason: 'person_deleted' }

  const season = await maybeOne<{ id: string }>(db,
    `SELECT id FROM seasons WHERE id = $1`, [input.seasonId])
  if (!season) return { ok: false, reason: 'season_not_found' }

  // 段は**その期のもの**でなければならない。期を跨いだ段に付けると、
  // 一覧が「この期の書類選考」で拾えなくなる。
  const step = await maybeOne<{ id: string }>(db,
    `SELECT id FROM selection_steps WHERE id = $1 AND season_id = $2`,
    [input.selectionStepId, input.seasonId])
  if (!step) return { ok: false, reason: 'step_not_found' }

  const label = await maybeOne<{ id: string }>(db,
    `SELECT id FROM ai_pre_labels WHERE code = $1 AND is_active`, [input.labelCode])
  if (!label) return { ok: false, reason: 'label_not_found' }

  const current = await maybeOne<{ id: string }>(db, `
    SELECT id FROM v_effective_ai_pre_assessments
     WHERE person_id = $1 AND season_id = $2 AND selection_step_id = $3
     ORDER BY occurred_at DESC, created_at DESC, id DESC LIMIT 1`,
  [input.personId, input.seasonId, input.selectionStepId])

  const inserted = current
    ? await maybeOne<{ id: string }>(db, `
        INSERT INTO ai_pre_assessments
          (person_id, season_id, selection_step_id, label_id, rationale, model,
           source, occurred_at, is_correction, corrects_assessment_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, ${AFTER_LAST}, true, $8) RETURNING id`,
    [input.personId, input.seasonId, input.selectionStepId, label.id,
      rationale, model, source, current.id])
    : await maybeOne<{ id: string }>(db, `
        INSERT INTO ai_pre_assessments
          (person_id, season_id, selection_step_id, label_id, rationale, model,
           source, occurred_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, ${AFTER_LAST}) RETURNING id`,
    [input.personId, input.seasonId, input.selectionStepId, label.id,
      rationale, model, source])

  return { ok: true, assessmentId: inserted!.id, previousId: current?.id ?? null }
}

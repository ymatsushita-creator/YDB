import { maybeOne, all, type Db } from '../db/client.ts'
import { REQUIRED_VIEWPOINT } from '../ai/pre_assessment.ts'

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
  /** 観点が1つも無い。点だけあって内訳が無い状態を作らない。 */
  | 'viewpoints_required'
  /** 観点の名前が空、または同じ観点が2度出た。 */
  | 'bad_viewpoint'
  /** ★ 論理性の観点が無い（依頼者の指示：「少なくとも論理性だけは」）。 */
  | 'logic_viewpoint_required'
  /** 点が整数でない、負、または満点超え。 */
  | 'score_out_of_range'

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

export interface ViewpointInput {
  viewpoint: string
  score: number
  finding: string
  scaleMax?: number
}

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
    /** 観点ごとの点と所見（0045）。**空では受け付けない。** */
    viewpoints: ViewpointInput[]
  },
): Promise<RecordAiPreAssessmentResult> {
  const rationale = (input.rationale ?? '').trim()
  if (!rationale) return { ok: false, reason: 'rationale_required' }
  if (rationale.length > RATIONALE_MAX) return { ok: false, reason: 'rationale_too_long' }
  const model = (input.model ?? '').trim()
  if (!model) return { ok: false, reason: 'model_required' }
  const source = (input.source ?? '').trim()
  if (!source) return { ok: false, reason: 'source_required' }

  // ★ 観点は**親を入れる前に**すべて検証する。
  //   途中で弾かれると、点の無い分析だけが台帳に残る ―― 追記専用なので消せない。
  const viewpoints = input.viewpoints ?? []
  if (viewpoints.length === 0) return { ok: false, reason: 'viewpoints_required' }
  const seen = new Set<string>()
  for (const v of viewpoints) {
    const name = (v.viewpoint ?? '').trim()
    if (!name || seen.has(name)) return { ok: false, reason: 'bad_viewpoint' }
    seen.add(name)
    if (!(v.finding ?? '').trim()) return { ok: false, reason: 'bad_viewpoint' }
    const max = v.scaleMax ?? 4
    if (!Number.isInteger(max) || max <= 0) return { ok: false, reason: 'score_out_of_range' }
    if (!Number.isInteger(v.score) || v.score < 0 || v.score > max) {
      return { ok: false, reason: 'score_out_of_range' }
    }
  }
  // ★ 論理性は必ず要る。AI側でも見ているが、**記録層の手前でもう一度見る**
  //   （CLAUDE.md：必須値をコマンド側で再検証する）。
  if (!seen.has(REQUIRED_VIEWPOINT)) {
    return { ok: false, reason: 'logic_viewpoint_required' }
  }

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

  // 観点の内訳。**検証済みなので、ここで弾かれる余地は無い。**
  for (const [i, v] of viewpoints.entries()) {
    await db.query(`
      INSERT INTO ai_pre_viewpoints
        (assessment_id, viewpoint, score, scale_max, finding, sort_order)
      VALUES ($1, $2, $3, $4, $5, $6)`,
    [inserted!.id, v.viewpoint.trim(), v.score, v.scaleMax ?? 4,
      v.finding.trim(), i + 1])
  }

  return { ok: true, assessmentId: inserted!.id, previousId: current?.id ?? null }
}

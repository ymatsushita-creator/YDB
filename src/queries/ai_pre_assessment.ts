import { all, type Db } from '../db/client.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface AiPreAssessmentTarget {
  person_id: string
  selection_step_id: string
  body: string
}

/** 氏名・連絡先を含めず、応募フォーム本文だけをAI分析の待ち行列へ出す。 */
export const listAiPreAssessmentTargets = (
  db: Db, seasonId: string | undefined, again = false, personId?: string,
): Promise<AiPreAssessmentTarget[]> => {
  if (!seasonId || !UUID.test(seasonId)) return Promise.resolve([])
  if (personId && !UUID.test(personId)) return Promise.resolve([])
  return all<AiPreAssessmentTarget>(db, `
    SELECT n.person_id, s.id AS selection_step_id,
           string_agg(n.body, E'\\n\\n' ORDER BY n.involvement) AS body
      FROM person_notes n
      JOIN persons p ON p.id = n.person_id AND p.deleted_at IS NULL
      JOIN applications a ON a.person_id = n.person_id AND a.season_id = $1
                         AND a.voided_at IS NULL AND a.deleted_at IS NULL
      JOIN selection_steps s ON s.season_id = $1 AND s.name = '書類選考'
     WHERE n.involvement LIKE '%応募フォーム%'
       AND ($2::uuid IS NULL OR n.person_id = $2)
       ${again ? '' : `AND NOT EXISTS (
         SELECT 1 FROM v_ai_pre_assessment x
          WHERE x.person_id = n.person_id AND x.season_id = $1
            AND x.selection_step_id = s.id)`}
     GROUP BY n.person_id, s.id
     ORDER BY n.person_id`, [seasonId, personId || null])
}

export interface CompletedAiPreAssessment {
  person_id: string
  family_name: string
  given_name: string
  school: string
  label: string
  definition: string
  rationale: string
  occurred_at: Date
}

/** 本期で既にAI分析が完了している一覧を取得する。 */
export const listCompletedAiPreAssessments = (
  db: Db, seasonId: string | undefined,
): Promise<CompletedAiPreAssessment[]> => {
  if (!seasonId || !UUID.test(seasonId)) return Promise.resolve([])
  return all<CompletedAiPreAssessment>(db, `
    SELECT x.person_id, p.family_name, p.given_name,
           coalesce(sc.name, '') AS school,
           x.label, x.definition, x.rationale, x.occurred_at
      FROM v_ai_pre_assessment x
      JOIN persons p ON p.id = x.person_id AND p.deleted_at IS NULL
      LEFT JOIN schools sc ON sc.id = p.school_id
     WHERE x.season_id = $1
     ORDER BY x.occurred_at DESC`, [seasonId])
}

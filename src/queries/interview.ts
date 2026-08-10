import { all, maybeOne, type Db } from '../db/client.ts'

/**
 * 面接シートの問い合わせ（依頼者の指示。実行⑩）。
 *
 * 集計の定義はビュー `v_interview_sheets`（0022）に置き、
 * ここは呼んで並べるだけ。**画面に SQL を書かせない**（CLAUDE.md）。
 *
 * ★ シートが**まだ無い**評価も返す。無いことは「書いていない」であって
 *   「面接が存在しない」ではない。返さないと、画面に書き始める入口が出ない。
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface InterviewCriterion {
  criteria_id: string
  criteria_name: string
  scale_max: number
  applies_to: string
  score: number | null
  rationale: string | null
}

export interface InterviewSheet {
  evaluation_id: string
  application_id: string
  person_id: string
  person_name: string
  person_kana: string | null
  photo_data_url: string | null
  school: string
  season_id: string
  enrollment_year: number
  cohort_number: number | null
  step_name: string
  step_order: number
  attempt: number
  evaluation_state: string
  interviewer_name: string | null
  /** シートがまだ無ければ null。 */
  sheet_id: string | null
  interviewed_on: Date | null
  first_impression: string | null
  check_point_notes: string | null
  strengths: string | null
  concerns: string | null
  own_challenge: string | null
  neo_career_link: string | null
  neo_usage_plan: string | null
  overall_comment: string | null
  recommendation: string | null
  recommendation_note: string | null
  updated_at: Date | null
  revision_count: number
  /** 評価軸と、付いている点。**軸は年度ごとの登録で、数も名前も違う。** */
  criteria: InterviewCriterion[]
}

/**
 * 1つの面接（＝1つの評価）のシート。
 *
 * ★ 評価から引く。応募と段からではない ―― 面接官が2人なら評価が2件あり、
 *   **シートも面接官ごとに1枚**である（`interview_sheets` の UNIQUE）。
 */
export const getInterviewSheet = async (
  db: Db, evaluationId: string | undefined,
): Promise<InterviewSheet | null> => {
  if (!evaluationId || !UUID.test(evaluationId)) return null

  const head = await maybeOne<Omit<InterviewSheet, 'criteria'>>(db, `
    SELECT e.id AS evaluation_id, a.id AS application_id, p.id AS person_id,
           p.family_name || ' ' || p.given_name AS person_name,
           nullif(btrim(coalesce(p.family_name_kana, '') || ' '
                        || coalesce(p.given_name_kana, '')), '') AS person_kana,
           p.photo_data_url, sc.name AS school,
           a.season_id, se.enrollment_year, se.cohort_number,
           ss.name AS step_name, ss.sort_order AS step_order,
           e.attempt, e.state AS evaluation_state,
           stf.display_name AS interviewer_name,
           s.id AS sheet_id, s.interviewed_on,
           s.first_impression, s.check_point_notes, s.strengths, s.concerns,
           s.own_challenge, s.neo_career_link, s.neo_usage_plan, s.overall_comment,
           s.recommendation, s.recommendation_note, s.updated_at,
           coalesce((SELECT count(*)::int FROM interview_sheet_revisions r
                      WHERE r.sheet_id = s.id), 0) AS revision_count
      FROM evaluations e
      JOIN applications a ON a.id = e.application_id AND a.deleted_at IS NULL
      JOIN persons p ON p.id = a.person_id AND p.deleted_at IS NULL
      JOIN schools sc ON sc.id = p.school_id
      JOIN seasons se ON se.id = a.season_id
      JOIN selection_steps ss ON ss.id = e.selection_step_id
      LEFT JOIN staffs stf ON stf.id = e.interviewer_staff_id
      -- ★ シートがまだ無い評価も返す。無いことは「書いていない」である。
      LEFT JOIN interview_sheets s ON s.evaluation_id = e.id
     WHERE e.id = $1`, [evaluationId])
  if (!head) return null

  // 適用の規則はトリガ evaluation_scores_applicability と同じもの。
  // あちらは書き込みを拒否し、こちらは何を書くべきかを出す（tests/19 が一致を固定）。
  const criteria = await all<InterviewCriterion>(db, `
    SELECT ec.id AS criteria_id, ec.name AS criteria_name, ec.scale_max, ec.applies_to,
           es.score, es.rationale
      FROM evaluations e
      JOIN applications a ON a.id = e.application_id
      JOIN evaluation_criteria ec ON ec.selection_step_id = e.selection_step_id
      LEFT JOIN evaluation_scores es
             ON es.evaluation_id = e.id AND es.criteria_id = ec.id
     WHERE e.id = $1
       AND (ec.applies_to = 'all'
            OR (ec.applies_to = 'reapplicant_only' AND a.is_reapplication))
     ORDER BY ec.sort_order`, [evaluationId])

  return { ...head, criteria }
}

export interface InterviewRevision {
  revision_number: number
  changed_at: Date
  changed_by: string | null
  interviewed_on: Date | null
  first_impression: string | null
  check_point_notes: string | null
  strengths: string | null
  concerns: string | null
  own_challenge: string | null
  neo_career_link: string | null
  neo_usage_plan: string | null
  overall_comment: string | null
  recommendation: string | null
  recommendation_note: string | null
}

/**
 * 変更ログ。**書いた後の全体像**が版ごとに積んである。
 *
 * 新しい順に返す。いま何が書いてあるかは現在値で読めるので、
 * ここを見る人が知りたいのは「その前は何だったか」である。
 */
export const listInterviewRevisions = (db: Db, evaluationId: string | undefined) => {
  if (!evaluationId || !UUID.test(evaluationId)) return Promise.resolve([])
  return all<InterviewRevision>(db, `
    SELECT r.revision_number, r.changed_at, stf.display_name AS changed_by,
           r.interviewed_on, r.first_impression, r.check_point_notes,
           r.strengths, r.concerns, r.own_challenge,
           r.neo_career_link, r.neo_usage_plan, r.overall_comment,
           r.recommendation, r.recommendation_note
      FROM interview_sheet_revisions r
      LEFT JOIN staffs stf ON stf.id = r.changed_by_staff_id
     WHERE r.evaluation_id = $1
     ORDER BY r.revision_number DESC`, [evaluationId])
}

export interface PersonInterview {
  evaluation_id: string
  application_id: string
  season_id: string
  enrollment_year: number
  cohort_number: number | null
  step_name: string
  step_order: number
  attempt: number
  evaluation_state: string
  interviewer_name: string | null
  interviewed_on: Date | null
  recommendation: string | null
  /** シートが1度でも保存されているか。 */
  has_sheet: boolean
  /** 付いている点の数と、適用される軸の数。 */
  scored_criteria: number
  total_criteria: number
}

/**
 * その人の面接の一覧（詳細画面から面接画面へ行くための入口）。
 *
 * ★ 期で絞らない。**詳細画面は年度をまたいだその人の記録**であり、
 *   再応募した人の前年度の面接も、ここから開ける必要がある。
 *   絞りたい画面は呼び出し側で絞る。
 */
export const listPersonInterviews = (db: Db, personId: string | undefined) => {
  if (!personId || !UUID.test(personId)) return Promise.resolve([])
  return all<PersonInterview>(db, `
    SELECT e.id AS evaluation_id, a.id AS application_id,
           a.season_id, se.enrollment_year, se.cohort_number,
           ss.name AS step_name, ss.sort_order AS step_order,
           e.attempt, e.state AS evaluation_state,
           stf.display_name AS interviewer_name,
           s.interviewed_on, s.recommendation,
           (s.id IS NOT NULL) AS has_sheet,
           (SELECT count(*)::int FROM evaluation_scores es
             WHERE es.evaluation_id = e.id) AS scored_criteria,
           (SELECT count(*)::int
              FROM evaluation_criteria ec
             WHERE ec.selection_step_id = e.selection_step_id
               AND (ec.applies_to = 'all'
                    OR (ec.applies_to = 'reapplicant_only' AND a.is_reapplication)))
             AS total_criteria
      FROM evaluations e
      JOIN applications a ON a.id = e.application_id AND a.deleted_at IS NULL
      JOIN persons p ON p.id = a.person_id AND p.deleted_at IS NULL
      JOIN seasons se ON se.id = a.season_id
      JOIN selection_steps ss ON ss.id = e.selection_step_id
      LEFT JOIN staffs stf ON stf.id = e.interviewer_staff_id
      LEFT JOIN interview_sheets s ON s.evaluation_id = e.id
     WHERE a.person_id = $1
     ORDER BY se.enrollment_year DESC, ss.sort_order, e.attempt, e.assigned_at`,
  [personId])
}

export interface SeasonInterview extends PersonInterview {
  person_name: string
  photo_data_url: string | null
  school: string
}

/**
 * その期の面接をすべて（面接タブの一覧）。
 *
 * ★ 段で絞らない。**面接の一覧は選考の一覧ではない。**
 *   どの段の面接も、書いた／書いていないの区別なく並べる ――
 *   書いていないものが見えないと、書き漏れに気づけない。
 *
 * 並びは「まだ書いていないものが先」。書き終えたシートは読み返す用で、
 * この画面で急ぐのは**空いているシート**である。
 */
export const listSeasonInterviews = (db: Db, seasonId: string | undefined) => {
  if (!seasonId || !UUID.test(seasonId)) return Promise.resolve([])
  return all<SeasonInterview>(db, `
    SELECT e.id AS evaluation_id, a.id AS application_id,
           a.season_id, se.enrollment_year, se.cohort_number,
           p.family_name || ' ' || p.given_name AS person_name,
           p.photo_data_url, sc.name AS school,
           ss.name AS step_name, ss.sort_order AS step_order,
           e.attempt, e.state AS evaluation_state,
           stf.display_name AS interviewer_name,
           s.interviewed_on, s.recommendation,
           (s.id IS NOT NULL) AS has_sheet,
           (SELECT count(*)::int FROM evaluation_scores es
             WHERE es.evaluation_id = e.id) AS scored_criteria,
           (SELECT count(*)::int
              FROM evaluation_criteria ec
             WHERE ec.selection_step_id = e.selection_step_id
               AND (ec.applies_to = 'all'
                    OR (ec.applies_to = 'reapplicant_only' AND a.is_reapplication)))
             AS total_criteria
      FROM evaluations e
      JOIN applications a ON a.id = e.application_id AND a.deleted_at IS NULL
      JOIN persons p ON p.id = a.person_id AND p.deleted_at IS NULL
      JOIN schools sc ON sc.id = p.school_id
      JOIN seasons se ON se.id = a.season_id
      JOIN selection_steps ss ON ss.id = e.selection_step_id
      LEFT JOIN staffs stf ON stf.id = e.interviewer_staff_id
      LEFT JOIN interview_sheets s ON s.evaluation_id = e.id
     WHERE a.season_id = $1
     ORDER BY (s.id IS NOT NULL), ss.sort_order, e.assigned_at, p.id`,
  [seasonId])
}

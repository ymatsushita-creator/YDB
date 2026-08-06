import { all, maybeOne, type Db } from '../db/client.ts'

/**
 * ダッシュボードが必要とする問い合わせ。
 *
 * SQL はここに集める。画面コンポーネントの中に SQL を書くと、
 * 同じ数字を出す別々のクエリが増えて、そのうち食い違う。
 *
 * 集計の定義そのものはビューと関数（db/migrations）にあり、
 * ここはそれを呼ぶだけに留める。
 */

/** 林のアクティブ判定窓。運用時に決定する値。 */
export const ACTIVE_WINDOW_DAYS = 90

/**
 * ドライバは date / timestamptz を JS の Date で返す（PGlite も node-postgres も）。
 * 型を string と書くと、実行時に .slice が無くて落ちる。実態に合わせる。
 */
export interface Season {
  id: string
  enrollment_year: number
  outreach_start_date: Date
  application_open_date: Date
  application_close_date: Date
  selection_end_date: Date
  capacity: number | null
  target_application_count: number | null
  /** 今日が選考期間の中にあるか。 */
  is_live: boolean
}

export const listSeasons = (db: Db) =>
  all<Season>(db, `
    SELECT s.*, (jst_today() BETWEEN s.outreach_start_date AND s.selection_end_date) AS is_live
      FROM seasons s ORDER BY s.enrollment_year DESC`)

export const getSeason = (db: Db, seasonId: string) =>
  maybeOne<Season>(db, `
    SELECT s.*, (jst_today() BETWEEN s.outreach_start_date AND s.selection_end_date) AS is_live
      FROM seasons s WHERE s.id = $1`, [seasonId])

// -------------------------------------------------------------
// (1) 全体サマリとファネル
// -------------------------------------------------------------

export interface FunnelPoint {
  as_of: Date
  relative_day: number
  identified_person_cum: number
  applicant_cum: number
  accepted_cum: number
  net_accepted_cum: number
  rejected_cum: number
  withdrawn_cum: number
}

/**
 * 日次断面。今日より後の日付は返さない。
 * 未来の日付に0が並ぶと、折れ線が右端で床に落ちて「急減した」ように見える。
 */
export const getFunnel = (db: Db, seasonId: string, windowDays = ACTIVE_WINDOW_DAYS) =>
  all<FunnelPoint>(db, `
    SELECT as_of, relative_day, identified_person_cum, applicant_cum,
           accepted_cum, net_accepted_cum, rejected_cum, withdrawn_cum
      FROM f_funnel_daily($2)
     WHERE season_id = $1 AND as_of <= jst_today()
     ORDER BY as_of`, [seasonId, windowDays])

export interface SeasonSummary {
  identified_person: number
  applicant: number
  accepted: number
  net_accepted: number
  rejected: number
  withdrawn: number
  in_progress: number
  reapplicant: number
}

/**
 * 現時点の断面。ファネルの最終行を取るのではなく、その日の値を直接引く。
 * 選考が終わった年度では最終日、進行中の年度では今日になる。
 */
export const getSummary = (db: Db, seasonId: string, windowDays = ACTIVE_WINDOW_DAYS) =>
  maybeOne<SeasonSummary>(db, `
    WITH latest AS (
      SELECT * FROM f_funnel_daily($2)
       WHERE season_id = $1 AND as_of <= jst_today()
       ORDER BY as_of DESC LIMIT 1
    )
    SELECT
      COALESCE(l.identified_person_cum, 0) AS identified_person,
      COALESCE(l.applicant_cum, 0)         AS applicant,
      COALESCE(l.accepted_cum, 0)          AS accepted,
      COALESCE(l.net_accepted_cum, 0)      AS net_accepted,
      COALESCE(l.rejected_cum, 0)          AS rejected,
      COALESCE(l.withdrawn_cum, 0)         AS withdrawn,
      (SELECT count(*) FROM v_application_state a
        WHERE a.season_id = $1
          AND NOT a.is_accepted AND NOT a.is_rejected AND NOT a.is_withdrawn) AS in_progress,
      (SELECT count(*) FROM v_application_state a
        WHERE a.season_id = $1 AND a.is_reapplication) AS reapplicant
      FROM latest l`, [seasonId, windowDays])

export interface StepFlow {
  sort_order: number
  name: string
  reached: number
  passed: number
}

/**
 * ステップごとの通過状況。どこで落ちているかを見る。
 *
 * 「到達」は、そのステップの評価行が作られたこと。遷移ログではなく
 * evaluations を見るのは、評価行の生成がステップ到達の定義だから。
 *
 * 「通過」は、そのステップを対象とする有効な advance。訂正で取り消された
 * 通過は含まれない。
 *
 * 不合格の内訳をステップ別に出していない。reject は selection_step_id を
 * 持たないため、どのステップで落ちたかは「直前に割り当てられた評価」から
 * 推測するしかない。推測を集計値として出すと、根拠のない数字が
 * 一人歩きする。必要になったら reject にステップを持たせるほうが正しい。
 */
export const getStepFlow = (db: Db, seasonId: string) =>
  all<StepFlow>(db, `
    SELECT ss.sort_order, ss.name,
           count(DISTINCT e.application_id)   AS reached,
           count(DISTINCT adv.application_id) AS passed
      FROM selection_steps ss
      LEFT JOIN evaluations e ON e.selection_step_id = ss.id
      LEFT JOIN v_effective_status_histories adv
             ON adv.selection_step_id = ss.id AND adv.transition_type = 'advance'
     WHERE ss.season_id = $1
     GROUP BY ss.sort_order, ss.name
     ORDER BY ss.sort_order`, [seasonId])

export interface ChannelRow {
  channel: string
  self_report_group: string | null
  identified: number
  applicants: number
  accepted: number
}

/**
 * チャネル別の成果。初回接触アトリビューションで見る。
 * 3方式のうち初回を既定にするのは、集客の投資判断に使う指標だから。
 */
export const getChannelPerformance = (db: Db, seasonId: string) =>
  all<ChannelRow>(db, `
    SELECT c.name AS channel, c.self_report_group,
           count(DISTINCT af.person_id)                                     AS identified,
           count(DISTINCT a.application_id)                                 AS applicants,
           count(DISTINCT a.application_id) FILTER (WHERE a.is_accepted)    AS accepted
      FROM v_attribution_first af
      JOIN channels c ON c.id = af.channel_id
      LEFT JOIN v_application_state a
             ON a.person_id = af.person_id AND a.season_id = $1
     WHERE af.season_id = $1
     GROUP BY c.name, c.self_report_group
     ORDER BY identified DESC`, [seasonId])

export interface WithdrawReasonRow {
  label: string
  count: number
}

/** 辞退理由の分布。チャネルの質を表す指標として(4)で読む。 */
export const getWithdrawReasons = (db: Db, seasonId: string) =>
  all<WithdrawReasonRow>(db, `
    SELECT wr.label, count(*) AS count
      FROM v_effective_status_histories sh
      JOIN v_countable_applications a ON a.id = sh.application_id
      JOIN withdraw_reasons wr ON wr.id = sh.withdraw_reason_id
     WHERE a.season_id = $1 AND sh.transition_type = 'withdraw'
     GROUP BY wr.label ORDER BY count DESC`, [seasonId])

// -------------------------------------------------------------
// (2) 選考オペレーション
// -------------------------------------------------------------

export interface PendingEvaluation {
  evaluation_id: string
  applicant_name: string
  step_name: string
  step_order: number
  interviewer: string | null
  assigned_at: Date
  waiting_days: number
  sla_days: number | null
  over_sla: boolean
}

/**
 * 判断待ちの評価。
 *
 * 滞留の起点は assigned_at（ステップ到達時に評価行が生成される時刻）。
 * 基準日は jst_today()。CURRENT_DATE を使うと接続のタイムゾーン次第で
 * 滞留日数が1日ずれる。
 */
export const getPendingEvaluations = (db: Db, seasonId: string) =>
  all<PendingEvaluation>(db, `
    SELECT e.id AS evaluation_id,
           p.family_name || ' ' || p.given_name AS applicant_name,
           ss.name AS step_name, ss.sort_order AS step_order,
           st.display_name AS interviewer,
           e.assigned_at,
           (jst_today() - jst_date(e.assigned_at)) AS waiting_days,
           ss.sla_days,
           (ss.sla_days IS NOT NULL
            AND (jst_today() - jst_date(e.assigned_at)) > ss.sla_days) AS over_sla
      FROM evaluations e
      JOIN selection_steps ss ON ss.id = e.selection_step_id
      JOIN v_countable_applications a ON a.id = e.application_id
      JOIN persons p ON p.id = a.person_id
      LEFT JOIN staffs st ON st.id = e.interviewer_staff_id
     WHERE ss.season_id = $1 AND e.state = 'pending'
     ORDER BY over_sla DESC, waiting_days DESC, ss.sort_order`, [seasonId])

export interface HeldEvaluation {
  evaluation_id: string
  applicant_name: string
  step_name: string
  interviewer: string | null
  hold_reason: string
  waiting_days: number
}

/** 保留。理由が必須なので、必ず読める形で出る。 */
export const getHeldEvaluations = (db: Db, seasonId: string) =>
  all<HeldEvaluation>(db, `
    SELECT e.id AS evaluation_id,
           p.family_name || ' ' || p.given_name AS applicant_name,
           ss.name AS step_name, st.display_name AS interviewer,
           e.hold_reason,
           (jst_today() - jst_date(e.assigned_at)) AS waiting_days
      FROM evaluations e
      JOIN selection_steps ss ON ss.id = e.selection_step_id
      JOIN v_countable_applications a ON a.id = e.application_id
      JOIN persons p ON p.id = a.person_id
      LEFT JOIN staffs st ON st.id = e.interviewer_staff_id
     WHERE ss.season_id = $1 AND e.state = 'held'
     ORDER BY waiting_days DESC`, [seasonId])

export interface InterviewerLoad {
  interviewer: string
  pending: number
  submitted: number
  held: number
  /** numeric はドライバが文字列で返す。 */
  avg_turnaround_days: string | null
}

/** 面接官別の負荷。偏りがあれば滞留の原因になる。 */
export const getInterviewerLoad = (db: Db, seasonId: string) =>
  all<InterviewerLoad>(db, `
    SELECT st.display_name AS interviewer,
           count(*) FILTER (WHERE e.state = 'pending')   AS pending,
           count(*) FILTER (WHERE e.state = 'submitted') AS submitted,
           count(*) FILTER (WHERE e.state = 'held')      AS held,
           round(avg(EXTRACT(epoch FROM (e.submitted_at - e.assigned_at)) / 86400)
                 FILTER (WHERE e.state = 'submitted'), 1) AS avg_turnaround_days
      FROM evaluations e
      JOIN selection_steps ss ON ss.id = e.selection_step_id
      JOIN staffs st ON st.id = e.interviewer_staff_id
     WHERE ss.season_id = $1
     GROUP BY st.display_name
     ORDER BY pending DESC, interviewer`, [seasonId])

export interface ConflictRow {
  applicant_name: string
  interviewer: string
  step_name: string
  conflict_type: string
  state: string
}

/** 利益相反。紹介者が面接官、または面接官が応募者本人。 */
export const getConflicts = (db: Db, seasonId: string) =>
  all<ConflictRow>(db, `
    SELECT p.family_name || ' ' || p.given_name AS applicant_name,
           st.display_name AS interviewer,
           ss.name AS step_name,
           coi.conflict_type,
           e.state
      FROM v_conflict_of_interest coi
      JOIN evaluations e ON e.id = coi.evaluation_id
      JOIN selection_steps ss ON ss.id = e.selection_step_id
      JOIN applications a ON a.id = coi.application_id
      JOIN persons p ON p.id = coi.applicant_person_id
      JOIN staffs st ON st.id = coi.interviewer_staff_id
     WHERE a.season_id = $1
     ORDER BY ss.sort_order`, [seasonId])

export interface UnassignedRow {
  count: number
  oldest_days: number | null
}

/** 担当未割当。第1ステップは面接官なしで評価行が生成される。 */
export const getUnassignedSummary = (db: Db, seasonId: string) =>
  maybeOne<UnassignedRow>(db, `
    SELECT count(*) AS count,
           max(jst_today() - jst_date(e.assigned_at)) AS oldest_days
      FROM evaluations e
      JOIN selection_steps ss ON ss.id = e.selection_step_id
     WHERE ss.season_id = $1 AND e.interviewer_staff_id IS NULL AND e.state = 'pending'`,
    [seasonId])

import { all, type Db } from '../db/client.ts'
import type { Tier } from '../auth/tiers.ts'

/**
 * 統合タスク一覧（Phase 4 Step 1）。
 *
 * 6種のタスクを1つの判別共用体で表し、SLA期限超過 → 待機日数降順 →
 * 選考段階昇順 → 安定したID の順で返す。
 *
 * ★ v_open_tasks（既存4種）は変更しない。ここは v_open_tasks を
 *   読み取り、start_selection と decide を足して、0軸応募受付を
 *   正しく振り分ける。
 *
 * ★ tier は呼び出し側が必須で渡す。'input' 層はタスクを持たないため
 *   空配列を即時返す（SQL を実行しない）。
 */

// ----------------------------------------------------------------
// 型
// ----------------------------------------------------------------

export interface TaskOwnerOption {
  id: string
  label: string
}

export type TaskType =
  | 'start_selection'
  | 'reassign'
  | 'unhold'
  | 'assign'
  | 'evaluate'
  | 'decide'

/** v_open_tasks が持つ既存4種。 */
export type EvalTaskType = 'reassign' | 'unhold' | 'assign' | 'evaluate'

/**
 * やることの所有形態。
 *   team       … チーム共通（start_selection / decide）
 *   unassigned … 未割当（assign）
 *   staff      … 特定の担当（reassign / unhold / evaluate）
 */
export type OwnerScope = 'team' | 'unassigned' | 'staff'

/** 6種に共通するフィールド。 */
interface TaskCommon {
  task_key: string
  season_id: string
  application_id: string
  person_id: string
  person_name: string
  selection_step_id: string
  step_name: string
  step_order: number
  waiting_days: number
  sla_days: number | null
  is_overdue: boolean
  overdue_days: number | null
  owner_staff_id: string | null
  owner_name: string | null
  owner_scope: OwnerScope
  criteria_total: number
  criteria_scored: number
  source_id: string
  cohort_number: number | null
  enrollment_year: number
  since: Date
  detail: string | null
}

/** 選考を始める。評価行がまだ無い、または0軸応募受付が未完了。 */
export interface StartSelectionTask extends TaskCommon {
  kind: 'start_selection'
}

/** 既存4種。v_open_tasks の評価から導出される。 */
export interface EvalTask extends TaskCommon {
  kind: EvalTaskType
}

/** 判定する。全評価が提出済みで、遷移が未記録。 */
export interface DecideTask extends TaskCommon {
  kind: 'decide'
  submitted_evaluations: number
}

/**
 * 統合タスク。判別共用体。
 *
 * `kind` で判別する:
 *   task.kind === 'start_selection' → StartSelectionTask
 *   task.kind === 'decide'          → DecideTask
 *   それ以外                        → EvalTask
 */
export type UnifiedTask = StartSelectionTask | EvalTask | DecideTask

// ----------------------------------------------------------------
// 問い合わせ
// ----------------------------------------------------------------

/** SQL の生の行。parse で判別共用体へ変換する。 */
interface RawRow {
  kind: string
  task_key: string
  source_id: string
  season_id: string
  application_id: string
  person_id: string
  person_name: string
  selection_step_id: string
  step_name: string
  step_order: number
  waiting_days: number
  sla_days: number | null
  is_overdue: boolean
  overdue_days: number | null
  owner_staff_id: string | null
  owner_name: string | null
  owner_scope: string
  detail: string | null
  criteria_total: number
  criteria_scored: number
  submitted_evaluations: number | null
  cohort_number: number | null
  enrollment_year: number
  since: Date
}

const EVAL_TYPES = new Set<string>(['reassign', 'unhold', 'assign', 'evaluate'])

function parseRow(r: RawRow): UnifiedTask {
  const common: TaskCommon = {
    task_key: r.task_key,
    season_id: r.season_id,
    application_id: r.application_id,
    person_id: r.person_id,
    person_name: r.person_name,
    selection_step_id: r.selection_step_id,
    step_name: r.step_name,
    step_order: Number(r.step_order),
    waiting_days: Number(r.waiting_days),
    sla_days: r.sla_days != null ? Number(r.sla_days) : null,
    is_overdue: r.is_overdue,
    overdue_days: r.overdue_days != null ? Number(r.overdue_days) : null,
    owner_staff_id: r.owner_staff_id,
    owner_name: r.owner_name,
    owner_scope: r.owner_scope as OwnerScope,
    criteria_total: Number(r.criteria_total),
    criteria_scored: Number(r.criteria_scored),
    source_id: r.source_id,
    cohort_number: r.cohort_number != null ? Number(r.cohort_number) : null,
    enrollment_year: Number(r.enrollment_year),
    since: r.since,
    detail: r.detail,
  }

  if (r.kind === 'start_selection') {
    return { ...common, kind: 'start_selection' }
  }
  if (r.kind === 'decide') {
    return {
      ...common,
      kind: 'decide',
      submitted_evaluations: Number(r.submitted_evaluations),
    }
  }
  if (EVAL_TYPES.has(r.kind)) {
    return {
      ...common,
      kind: r.kind as EvalTaskType,
    }
  }
  throw new Error(`unknown task kind: ${r.kind}`)
}

/**
 * 担当者の選択肢。
 *
 * 有効な職員（is_active = true）をdisplay_name順に返す。
 */
export function listTaskOwners(db: Db): Promise<TaskOwnerOption[]> {
  return all<{ id: string; display_name: string }>(
    db,
    `
    SELECT id, display_name
      FROM staffs
     WHERE is_active = true
     ORDER BY display_name
  `
  ).then((rows) =>
    rows.map((r) => ({
      id: r.id,
      label: r.display_name,
    }))
  )
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 指定期に選考段階が存在するか。
 *
 * 壊れたUUIDを受け取った場合はfalseを返す。
 */
export function hasSelectionSteps(db: Db, seasonId: string): Promise<boolean> {
  if (!UUID.test(seasonId)) return Promise.resolve(false)
  return all<{ exists: boolean }>(
    db,
    `
    SELECT EXISTS(
      SELECT 1 FROM selection_steps WHERE season_id = $1 LIMIT 1
    ) AS exists
  `,
    [seasonId]
  ).then((rows) => rows[0]?.exists ?? false)
}

/**
 * 統合タスク一覧。
 *
 * 並び: SLA期限超過 → 待機日数降順 → 選考段階昇順 → 安定したID（契約 #2）。
 * task kind に根拠のない重みを付けない。
 *
 * ★ 0軸応募受付（評価軸が0件の初段評価）は既存4種から除き、
 *   start_selection として出す。0軸応募受付由来の decide も出さない
 *   （契約 #3）。
 *
 * ★ v_open_tasks の既存利用は壊さない（契約 #10）。
 *   v_open_tasks を直接読む既存のコードは従来どおり動く。
 *
 * ★ 'input' 層はタスクを持たない。空配列を即時返す。
 */
export function getWorkTasks(db: Db, args: { seasonId: string; tier: Tier }): Promise<UnifiedTask[]> {
  if (args.tier === 'input') return Promise.resolve([])
  return all<RawRow>(db, `
    WITH
    -- 各期の初段（特別選考を除く）
    first_steps AS (
      SELECT DISTINCT ON (season_id)
             id, season_id, name, sort_order, sla_days
        FROM selection_steps
       WHERE name <> '特別選考'
       ORDER BY season_id, sort_order
    ),
    -- 0軸応募受付の評価（step名が '応募受付' かつ state pending/held かつ適用criteria 0件）
    zero_axis_evals AS (
      SELECT e.id          AS evaluation_id,
             e.application_id,
             e.selection_step_id,
             e.state,
             e.hold_reason
        FROM evaluations e
        JOIN v_active_applications a ON a.id = e.application_id
        JOIN selection_steps ss ON ss.id = e.selection_step_id
       WHERE ss.name = '応募受付'
         AND e.state IN ('pending', 'held')
         AND NOT EXISTS (
               SELECT 1 FROM evaluation_criteria ec
                WHERE ec.selection_step_id = ss.id
                  AND (ec.applies_to = 'all'
                       OR (ec.applies_to = 'reapplicant_only'
                           AND a.is_reapplication))
             )
    )
    ---------------------------------------------------------------
    -- Part 1: 既存4種（0軸応募受付の評価を除く）
    ---------------------------------------------------------------
    SELECT t.kind                                        AS kind,
           t.kind || ':' || t.source_id::text            AS task_key,
           t.source_id::text                             AS source_id,
           t.season_id::text,
           t.application_id::text,
           t.person_id::text,
           p.family_name || ' ' || p.given_name          AS person_name,
           t.selection_step_id::text,
           t.step_name,
           t.step_order,
           t.waiting_days,
           t.sla_days,
           t.is_overdue,
           CASE WHEN t.sla_days IS NULL THEN NULL
                ELSE GREATEST(t.waiting_days - t.sla_days, 0)::int
                END                                      AS overdue_days,
           t.owner_staff_id::text,
           st.display_name                               AS owner_name,
           CASE WHEN t.kind = 'assign' OR t.owner_staff_id IS NULL
                THEN 'unassigned'
                ELSE 'staff' END                         AS owner_scope,
           t.detail,
           (SELECT count(*) FROM evaluation_criteria ec
             WHERE ec.selection_step_id = t.selection_step_id
               AND (ec.applies_to = 'all'
                    OR (ec.applies_to = 'reapplicant_only'
                        AND a.is_reapplication)))::int   AS criteria_total,
           (SELECT count(*) FROM evaluation_scores es
             WHERE es.evaluation_id = t.source_id)::int  AS criteria_scored,
           NULL::int                                     AS submitted_evaluations,
           s.cohort_number,
           s.enrollment_year,
           t.since
      FROM v_open_tasks t
      JOIN persons p       ON p.id = t.person_id
      JOIN applications a  ON a.id = t.application_id
      JOIN seasons s       ON s.id = t.season_id
      LEFT JOIN staffs st  ON st.id = t.owner_staff_id
     WHERE t.season_id = $1
       AND ($2::text = 'all' OR t.step_name <> '特別選考')
       AND t.source_id NOT IN (SELECT evaluation_id FROM zero_axis_evals)

    UNION ALL

    ---------------------------------------------------------------
    -- Part 2a: start_selection（評価行なし）
    ---------------------------------------------------------------
    SELECT 'start_selection'                             AS kind,
           'start_selection:' || a.id::text              AS task_key,
           a.id::text                                    AS source_id,
           fs.season_id::text,
           a.id::text                                    AS application_id,
           a.person_id::text,
           p.family_name || ' ' || p.given_name          AS person_name,
           fs.id::text                                   AS selection_step_id,
           fs.name                                       AS step_name,
           fs.sort_order                                 AS step_order,
           (jst_today() - jst_date(a.submitted_at))::int AS waiting_days,
           fs.sla_days,
           (fs.sla_days IS NOT NULL
            AND (jst_today() - jst_date(a.submitted_at))
                > fs.sla_days)                           AS is_overdue,
           CASE WHEN fs.sla_days IS NULL THEN NULL
                ELSE GREATEST(
                       (jst_today() - jst_date(a.submitted_at)) - fs.sla_days,
                       0)::int END                       AS overdue_days,
           NULL::text                                    AS owner_staff_id,
           NULL::text                                    AS owner_name,
           'team'                                        AS owner_scope,
           NULL::text                                    AS detail,
           0                                             AS criteria_total,
           0                                             AS criteria_scored,
           NULL::int                                     AS submitted_evaluations,
           s.cohort_number,
           s.enrollment_year,
           a.submitted_at                                AS since
      FROM v_active_applications a
      JOIN persons p      ON p.id = a.person_id
      JOIN first_steps fs ON fs.season_id = a.season_id
      JOIN seasons s      ON s.id = a.season_id
     WHERE a.season_id = $1
       AND NOT EXISTS (
             SELECT 1 FROM evaluations e WHERE e.application_id = a.id)

    UNION ALL

    ---------------------------------------------------------------
    -- Part 2b: start_selection（0軸応募受付の評価あり）
    ---------------------------------------------------------------
    SELECT 'start_selection'                             AS kind,
           'start_selection:' || a.id::text              AS task_key,
           a.id::text                                    AS source_id,
           a.season_id::text,
           a.id::text                                    AS application_id,
           a.person_id::text,
           p.family_name || ' ' || p.given_name          AS person_name,
           ss.id::text                                   AS selection_step_id,
           ss.name                                       AS step_name,
           ss.sort_order                                 AS step_order,
           (jst_today() - jst_date(a.submitted_at))::int AS waiting_days,
           ss.sla_days,
           (ss.sla_days IS NOT NULL
            AND (jst_today() - jst_date(a.submitted_at))
                > ss.sla_days)                           AS is_overdue,
           CASE WHEN ss.sla_days IS NULL THEN NULL
                ELSE GREATEST(
                       (jst_today() - jst_date(a.submitted_at)) - ss.sla_days,
                       0)::int END                       AS overdue_days,
           NULL::text                                    AS owner_staff_id,
           NULL::text                                    AS owner_name,
           'team'                                        AS owner_scope,
           CASE WHEN ze.state = 'held' THEN ze.hold_reason
                ELSE NULL END                            AS detail,
           0                                             AS criteria_total,
           0                                             AS criteria_scored,
           NULL::int                                     AS submitted_evaluations,
           s.cohort_number,
           s.enrollment_year,
           a.submitted_at                                AS since
      FROM (SELECT DISTINCT ON (ze.application_id) ze.*
              FROM zero_axis_evals ze
             ORDER BY ze.application_id) ze
      JOIN v_active_applications a  ON a.id = ze.application_id
      JOIN persons p                ON p.id = a.person_id
      JOIN selection_steps ss       ON ss.id = ze.selection_step_id
      JOIN seasons s                ON s.id = a.season_id
     WHERE a.season_id = $1

    UNION ALL

    ---------------------------------------------------------------
    -- Part 3: decide（判定可能ステップ。0軸ステップを除く）
    ---------------------------------------------------------------
    SELECT 'decide'                                      AS kind,
           'decide:' || d.application_id::text
             || ':' || d.selection_step_id::text         AS task_key,
           d.application_id::text                        AS source_id,
           d.season_id::text,
           d.application_id::text,
           d.person_id::text,
           p.family_name || ' ' || p.given_name          AS person_name,
           d.selection_step_id::text,
           d.step_name,
           d.step_order,
           (jst_today()
            - jst_date(d.last_submitted_at))::int        AS waiting_days,
           d.sla_days,
           (d.sla_days IS NOT NULL
            AND (jst_today() - jst_date(d.last_submitted_at))
                > d.sla_days)                            AS is_overdue,
           CASE WHEN d.sla_days IS NULL THEN NULL
                ELSE GREATEST(
                       (jst_today() - jst_date(d.last_submitted_at))
                       - d.sla_days, 0)::int END         AS overdue_days,
           NULL::text                                    AS owner_staff_id,
           NULL::text                                    AS owner_name,
           'team'                                        AS owner_scope,
           NULL::text                                    AS detail,
           (SELECT count(*)
              FROM evaluations e2
              JOIN evaluation_criteria ec
                ON ec.selection_step_id = e2.selection_step_id
               AND (ec.applies_to = 'all'
                    OR (ec.applies_to = 'reapplicant_only'
                        AND a.is_reapplication))
             WHERE e2.application_id = d.application_id
               AND e2.selection_step_id = d.selection_step_id)::int AS criteria_total,
           (SELECT count(*)
              FROM evaluations e2
              JOIN evaluation_scores es ON es.evaluation_id = e2.id
             WHERE e2.application_id = d.application_id
               AND e2.selection_step_id = d.selection_step_id)::int AS criteria_scored,
           d.submitted_evaluations,
           s.cohort_number,
           s.enrollment_year,
           d.last_submitted_at                           AS since
      FROM (SELECT DISTINCT ON (v.application_id) v.*
              FROM v_decidable_steps v
             WHERE v.season_id = $1
             ORDER BY v.application_id, v.step_order) d
      JOIN persons p      ON p.id = d.person_id
      JOIN applications a ON a.id = d.application_id
      JOIN seasons s      ON s.id = d.season_id
     WHERE ($2::text = 'all' OR d.step_name <> '特別選考')
       -- 0軸応募受付の判定は start_selection が担う
       AND NOT EXISTS (
             SELECT 1 FROM zero_axis_evals ze
              WHERE ze.application_id = d.application_id
                AND ze.selection_step_id = d.selection_step_id)

    ORDER BY is_overdue DESC, waiting_days DESC,
             step_order ASC, task_key ASC
  `, [args.seasonId, args.tier]).then((rows) => rows.map(parseRow))
}

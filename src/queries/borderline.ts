import { all, maybeOne, type Db } from '../db/client.ts'

/**
 * ボーダーライン画面の問い合わせ（実行⑨）。
 *
 * 依頼者から届いた画面画像の各枠に1対1で対応する。
 * 集計の定義はビュー（0016 / 0017 / 0019 / 0020）に置き、
 * ここは呼んで並べ替えるだけ。**画面に SQL を書かせない**（CLAUDE.md 4節）。
 *
 * ★ 画像にあって、ここに無いもの
 *
 *   評価サマリーの4軸       … 実際の軸は年度ごとの登録で、名前も数も違う
 *   通知（🔔）              … 記録層が無い
 *   アカウント・ログアウト  … 認証が無い
 */

// -------------------------------------------------------------
// 1. やること（画像 上段）
// -------------------------------------------------------------

/**
 * やることは2つの出どころがある。
 *
 *   derived … 選考の事実から導く（評価する・担当を決める・替える・保留を解く）
 *   manual  … 人が作る（0020）
 *
 * **記録層を1つに畳んでいない。** 導出できるものを記録層へ写すと、
 * 選考の事実とやることが二重管理になり、必ずずれる（C-17）。
 * 合流させるのはここ（画面へ渡す直前）だけである。
 */
export type TaskOrigin = 'derived' | 'manual'

/** 画面が色を選ぶための事実の名前。**画面で期限を比べ直さない。** */
export type TaskUrgency = 'overdue' | 'due' | 'in_progress' | 'later'

export interface BorderlineTask {
  origin: TaskOrigin
  /** 一覧の鍵。導出は評価の id、手作りはタスクの id。 */
  key: string
  title: string
  person_id: string | null
  person_name: string | null
  owner: string | null
  urgency: TaskUrgency
  /** 期限の日。導出のものは「待ち日数と目安」から出せないので null。 */
  due_on: Date | null
  /** 時刻まで決まっているときだけ入る。**無いことを 00:00 と読み替えない。** */
  due_time: string | null
  /** 導出のやることだけが持つ。何日待たせているか。 */
  waiting_days: number | null
}

export const listManualTasks = (db: Db, seasonId: string) =>
  all<{
    manual_task_id: string; title: string; person_id: string | null
    person_name: string | null; owner_name: string | null
    urgency: 'in_progress' | 'due' | 'later'; is_overdue: boolean
    due_on: Date; due_time: string | null
  }>(db, `
    SELECT t.manual_task_id, t.title, t.person_id,
           p.family_name || ' ' || p.given_name AS person_name,
           t.owner_name, t.urgency, t.is_overdue, t.due_on, t.due_time
      FROM v_manual_tasks t
      LEFT JOIN persons p ON p.id = t.person_id
     WHERE t.season_id = $1
     ORDER BY t.is_overdue DESC, t.due_on, t.due_time NULLS LAST, t.title`,
  [seasonId])

export const listDerivedTasks = (db: Db, seasonId: string) =>
  all<{
    source_id: string; kind: string; person_id: string; person_name: string
    step_name: string; owner: string | null; waiting_days: number
    sla_days: number | null; is_overdue: boolean
  }>(db, `
    SELECT t.source_id, t.kind, t.person_id,
           p.family_name || ' ' || p.given_name AS person_name,
           t.step_name, st.display_name AS owner,
           t.waiting_days, t.sla_days, t.is_overdue
      FROM v_open_tasks t
      JOIN persons p ON p.id = t.person_id
      LEFT JOIN staffs st ON st.id = t.owner_staff_id
     WHERE t.season_id = $1
     ORDER BY t.is_overdue DESC, t.waiting_days DESC, t.step_order`,
  [seasonId])

export interface TaskTotals {
  /** 開いているやること（導出＋手作り）の件数。**人数ではない。** */
  open_tasks: number
  overdue: number
  manual: number
  derived: number
}

// -------------------------------------------------------------
// 2. 候補者リスト（画像 中段）
// -------------------------------------------------------------

export interface CandidateRow {
  person_id: string
  person_name: string
  person_kana: string | null
  photo_data_url: string | null
  school: string
  faculty: string | null
  /** 確度。規則が未登録なら null（0 ではない）。 */
  confidence_ratio: number | null
  rank_in_season: number | null
  rank_delta: number | null
  has_previous_run: boolean
  last_touchpoint_on: Date | null
  approach_code: string | null
  approach_label: string | null
}

export interface CandidatePage {
  rows: CandidateRow[]
  /** 母集団の総数。ページ送りの注記に出す。 */
  total: number
}

/**
 * 確度順の候補者リスト。
 *
 * ★ 母集団は「その年度のヘッドハンティング対象者」で、順位は 0017 が
 *   凍結時に決めている。**ここで絞り直さない**（絞り直すと順位と母集団が
 *   食い違い、「1位が居ないのに2位が居る」一覧になる）。
 *
 * 確度が無い人（凍結の対象外だった人）は後ろへ回す。
 */
export async function listCandidatesByConfidence(
  db: Db, seasonId: string, opts: { limit: number; offset: number },
): Promise<CandidatePage> {
  const rows = await all<CandidateRow>(db, `
    SELECT h.person_id,
           p.family_name || ' ' || p.given_name AS person_name,
           nullif(btrim(coalesce(p.family_name_kana, '') || ' '
                        || coalesce(p.given_name_kana, '')), '') AS person_kana,
           p.photo_data_url,
           sc.name AS school, p.faculty,
           c.confidence_ratio, c.rank_in_season, c.rank_delta,
           coalesce(c.has_previous_run, false) AS has_previous_run,
           (SELECT max(jst_date(t.occurred_at)) FROM v_touchpoint_season t
             WHERE t.person_id = h.person_id AND t.season_id = h.season_id)
             AS last_touchpoint_on,
           h.approach_code, h.approach_label
      FROM v_headhunting_list h
      JOIN persons p ON p.id = h.person_id
      JOIN schools sc ON sc.id = p.school_id
      LEFT JOIN v_candidate_confidence_latest c
             ON c.person_id = h.person_id AND c.season_id = h.season_id
     WHERE h.season_id = $1
     ORDER BY c.rank_in_season NULLS LAST, h.state_since DESC, p.id
     LIMIT $2 OFFSET $3`, [seasonId, opts.limit, opts.offset])

  const total = await maybeOne<{ n: number }>(db,
    `SELECT count(*)::int AS n FROM v_headhunting_list WHERE season_id = $1`, [seasonId])

  return { rows, total: total?.n ?? 0 }
}

export interface StepTab {
  selection_step_id: string
  step_name: string
  sort_order: number
  /** そのステップで動いている応募の数。**人数ではなく応募の数。** */
  open_applications: number
}

/**
 * 年度の選考ステップと、そこで止まっている応募の数。
 *
 * ★ 「そのステップに居る」の定義は、**まだ提出されていない評価がそのステップに
 *   ある**こと。`v_open_tasks` が「やること」を出すときと同じ見方である。
 *   記録層に「現在のステップ」という列は無く、作ってもいない
 *   （選考の位置は評価の状態から導けるので、物理保存すると二重管理になる）。
 *
 * 1つの応募に同じステップの評価が2件ある（面接官が2人）ことがあるので、
 * 応募を数えるときは必ず DISTINCT を通す。**件と応募数を混同しない。**
 */
export const listStepTabs = (db: Db, seasonId: string) =>
  all<StepTab>(db, `
    SELECT ss.id AS selection_step_id, ss.name AS step_name, ss.sort_order,
           count(DISTINCT a.id)::int AS open_applications
      FROM selection_steps ss
      LEFT JOIN evaluations e
             ON e.selection_step_id = ss.id AND e.state <> 'submitted'
      LEFT JOIN v_active_applications a ON a.id = e.application_id
     WHERE ss.season_id = $1
     GROUP BY ss.id, ss.name, ss.sort_order
     ORDER BY ss.sort_order`, [seasonId])

export interface StepCandidateRow {
  application_id: string
  person_id: string
  person_name: string
  photo_data_url: string | null
  school: string
  faculty: string | null
  /** 100点換算。受けた軸だけで割った達成率。 */
  score_100: number | null
  scored_criteria: number
  waiting_days: number
  owner: string | null
}

/**
 * あるステップで止まっている応募。
 *
 * 確度ではなく**成績**で並べる。ステップのタブは選考の話なので、
 * 声を掛ける確度ではなく、受けた評価の結果が答えになる。
 */
export const listCandidatesByStep = (db: Db, seasonId: string, stepId: string) =>
  all<StepCandidateRow>(db, `
    WITH scored AS (
        SELECT a.id AS application_id,
               sum(es.score) AS earned, sum(ec.scale_max) AS possible,
               count(*)::int AS scored_criteria
          FROM v_countable_applications a
          JOIN evaluations e ON e.application_id = a.id AND e.state = 'submitted'
          JOIN evaluation_scores es ON es.evaluation_id = e.id
          JOIN evaluation_criteria ec ON ec.id = es.criteria_id
         WHERE a.season_id = $1
         GROUP BY a.id
    )
    SELECT DISTINCT ON (a.id)
           a.id AS application_id, a.person_id,
           p.family_name || ' ' || p.given_name AS person_name,
           p.photo_data_url, sc.name AS school, p.faculty,
           CASE WHEN s.possible > 0
                THEN round(s.earned::numeric / s.possible * 100, 1) END AS score_100,
           coalesce(s.scored_criteria, 0) AS scored_criteria,
           (jst_today() - jst_date(e.assigned_at))::int AS waiting_days,
           stf.display_name AS owner
      FROM v_active_applications a
      JOIN evaluations e
        ON e.application_id = a.id AND e.selection_step_id = $2
       AND e.state <> 'submitted'
      JOIN persons p ON p.id = a.person_id
      JOIN schools sc ON sc.id = p.school_id
      LEFT JOIN scored s ON s.application_id = a.id
      LEFT JOIN staffs stf ON stf.id = e.interviewer_staff_id
     WHERE a.season_id = $1
     -- 同じ応募に同じステップの評価が2件あることがある（面接官が2人）。
     -- 一覧は応募の単位なので、待ちの長いほうを代表にして1行へ畳む。
     ORDER BY a.id, e.assigned_at`,
  [seasonId, stepId])

// -------------------------------------------------------------
// 3. 日程（画像 右下）
// -------------------------------------------------------------

export interface Appointment {
  appointment_id: string
  kind_code: string
  kind_label: string
  title: string
  person_id: string | null
  person_name: string | null
  starts_at: Date
  ends_at: Date
  starts_on: Date
  owner_name: string
}

/**
 * ある週の予定。
 *
 * 期間は呼ぶ側が決める。ここで「今週」を組み立てると、
 * 画面が別の週を出したくなった瞬間に定義が2つになる。
 */
export const listAppointments = (db: Db, seasonId: string, fromOn: string, toOn: string) =>
  all<Appointment>(db, `
    SELECT a.appointment_id, a.kind_code, a.kind_label, a.title,
           a.person_id,
           p.family_name || ' ' || p.given_name AS person_name,
           a.starts_at, a.ends_at, a.starts_on, a.owner_name
      FROM v_appointments a
      LEFT JOIN persons p ON p.id = a.person_id
     WHERE a.season_id = $1
       AND a.starts_on BETWEEN $2::date AND $3::date
     ORDER BY a.starts_at, a.appointment_id`, [seasonId, fromOn, toOn])

// -------------------------------------------------------------
// 4. 候補者パネル（画像 右上）
// -------------------------------------------------------------

export interface BorderlinePanel {
  person_id: string
  person_name: string
  person_kana: string | null
  photo_data_url: string | null
  school: string
  faculty: string | null
  email: string
  phone: string | null
  birth_date: Date
  /** 生年月日から出した満年齢。学年という概念は存在しない（期で数える）。 */
  age: number
  note: string | null
  last_touchpoint_on: Date | null
  approach_code: string | null
  approach_label: string | null
  confidence_ratio: number | null
  rank_in_season: number | null
  score_100: number | null
}

export const getBorderlinePanel = (db: Db, personId: string, seasonId: string) =>
  maybeOne<BorderlinePanel>(db, `
    SELECT p.id AS person_id,
           p.family_name || ' ' || p.given_name AS person_name,
           nullif(btrim(coalesce(p.family_name_kana, '') || ' '
                        || coalesce(p.given_name_kana, '')), '') AS person_kana,
           p.photo_data_url, sc.name AS school, p.faculty, p.email, p.phone,
           p.birth_date,
           extract(year from age(jst_today(), p.birth_date))::int AS age,
           p.note,
           (SELECT max(jst_date(t.occurred_at)) FROM v_touchpoint_season t
             WHERE t.person_id = p.id AND t.season_id = $2) AS last_touchpoint_on,
           a.approach_code, a.approach_label,
           c.confidence_ratio, c.rank_in_season,
           (SELECT round(sum(es.score)::numeric / sum(ec.scale_max) * 100, 1)
              FROM v_countable_applications ap
              JOIN evaluations e ON e.application_id = ap.id AND e.state = 'submitted'
              JOIN evaluation_scores es ON es.evaluation_id = e.id
              JOIN evaluation_criteria ec ON ec.id = es.criteria_id
             WHERE ap.person_id = p.id AND ap.season_id = $2) AS score_100
      FROM persons p
      JOIN schools sc ON sc.id = p.school_id
      LEFT JOIN v_person_approach_state a
             ON a.person_id = p.id AND a.season_id = $2
      LEFT JOIN v_candidate_confidence_latest c
             ON c.person_id = p.id AND c.season_id = $2
     WHERE p.id = $1 AND p.deleted_at IS NULL`, [personId, seasonId])

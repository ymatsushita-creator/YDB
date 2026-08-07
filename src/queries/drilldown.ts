import { all, maybeOne, type Db } from '../db/client.ts'
import { ACTIVE_WINDOW_DAYS } from './dashboard.ts'

/**
 * 個人1人・応募1件を引く問い合わせ。
 *
 * ダッシュボードの問い合わせ（dashboard.ts）はすべて年度単位の集計で、
 * 「この人はいまどこにいて、誰が何を評価したのか」に答えられない。
 * CLAUDE.md の問い①②に直接効くのがここ。
 *
 * 集計と個別で、守る規律が1つだけ違う。
 *
 *   集計は「数えてよいものだけ」を数える（v_countable_applications）
 *   個別は「起きた事実」を落とさず出し、数えるかどうかを列で示す
 *
 * 無効化された応募を個別の画面からも消すと、そこにぶら下がった評価と
 * 遷移が画面のどこにも出ないまま記録層に残る。集計の都合で事実を
 * 隠すことになるので、ここでは分けている。
 *
 * 逆に、個人情報削除（deleted_at）は個別からも消す。集計から外すだけでは
 * 削除の依頼（資料9-2）に応えたことにならない。氏名の見える窓を残さない。
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * URL の /people/<id> と /applications/<id> はユーザが自由に書ける。
 * UUID でない文字列をそのまま WHERE に渡すと invalid input syntax で 500 になる。
 * 「知らない id」と「壊れた入力」はどちらも「見つからない」でよい。
 */
const asId = (id: string | string[] | undefined): string | null => {
  const v = Array.isArray(id) ? id[0] : id
  return v && UUID.test(v) ? v : null
}

// -------------------------------------------------------------
// 個人を探す
// -------------------------------------------------------------

export interface PersonHit {
  person_id: string
  family_name: string
  given_name: string
  school_name: string
  /** 年度を指定したときだけ埋まる。指定しなければ null。 */
  current_level: string | null
  in_active_window: boolean | null
  application_count: number | null
  last_touch_at: Date | null
  has_ever_applied: boolean
  has_ever_been_accepted: boolean
  lifetime_application_count: number
}

export interface PersonSearch {
  /** 氏名・かな・メール・学校名の部分一致。空なら絞らない。 */
  q?: string | string[]
  /** 指定すると、その年度の段と接点の鮮度が付く。段での絞り込みもできる。 */
  seasonId?: string | string[]
  level?: string | string[]
  windowDays?: number
  limit?: number
}

/**
 * クエリ文字列の1つ目を取り、空白だけなら「指定なし」に倒す。
 *
 * フォームの <select> は「すべての段」を空文字で送ってくる。空文字を
 * そのまま WHERE に渡すと `current_level = ''` になり、一覧を開いただけで
 * 該当0件になる。「指定なし」と「空文字という指定」は別物として扱わない。
 */
const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v)?.trim() || null

/**
 * 個人の検索。
 *
 * 段（level）で絞れるのは年度を指定したときだけ。段は年度に対する
 * 相対的な位置なので、年度を決めずに「木の人」を出すことはできない。
 */
export const searchPersons = (db: Db, opts: PersonSearch = {}) => {
  const q = one(opts.q)
  const seasonId = asId(opts.seasonId)
  const level = seasonId ? one(opts.level) : null
  return all<PersonHit>(db, `
    -- AS MATERIALIZED は必須。これが無いと、年度を指定した検索で
    -- f_person_season_state が外側の Person 1行ごとに評価し直される。
    -- 実測で、年度なし 0.6 秒に対して年度あり 444 秒だった。
    -- 氏名で絞ると速く見えるのは、外側が数行に減って再評価が数回で
    -- 済むからで、直っているわけではない（A-8 と同じ構造）。
    WITH season_state AS MATERIALIZED (
      SELECT person_id, current_level, in_active_window, application_count
        FROM f_person_season_state($4)
       WHERE $2::uuid IS NOT NULL AND season_id = $2::uuid
    )
    SELECT p.id AS person_id, p.family_name, p.given_name, sc.name AS school_name,
           ps.current_level, ps.in_active_window, ps.application_count,
           ls.last_touch_at, ls.has_ever_applied, ls.has_ever_been_accepted,
           ls.application_count AS lifetime_application_count
      FROM persons p
      JOIN schools sc ON sc.id = p.school_id
      -- 削除済みを返さない。集計から外すだけでは削除の依頼に応えたことにならない。
      JOIN v_person_lifetime_summary ls ON ls.person_id = p.id
      LEFT JOIN season_state ps ON ps.person_id = p.id
     WHERE p.deleted_at IS NULL
       AND ($1::text IS NULL OR
            p.family_name || p.given_name ILIKE '%' || $1 || '%' OR
            p.family_name || ' ' || p.given_name ILIKE '%' || $1 || '%' OR
            COALESCE(p.family_name_kana || p.given_name_kana, '') ILIKE '%' || $1 || '%' OR
            p.email ILIKE '%' || $1 || '%' OR
            sc.name ILIKE '%' || $1 || '%')
       AND ($2::uuid IS NULL OR ps.person_id IS NOT NULL)
       AND ($3::text IS NULL OR ps.current_level = $3)
     ORDER BY ls.last_touch_at DESC NULLS LAST, p.family_name, p.given_name, p.id
     LIMIT $5`,
    [q, seasonId, level, opts.windowDays ?? ACTIVE_WINDOW_DAYS, opts.limit ?? 50])
}

export interface LevelBreakdownRow {
  current_level: string
  persons: number
  /** そのうち、年度サマリの林に数えられている人。 */
  in_active_window: number
}

/**
 * 選んだ年度の、段ごとの人数と接点の鮮度。
 *
 * 一覧の絞り込みに何人いるかを出すためだが、目的はもう一つある。
 * in_active_window の縦計が、その年度のダッシュボードの林と一致する。
 * 一覧と年度サマリが同じ事実から作られていることを、画面の上で
 * 確かめられるようにしておく（0010 のコメント、tests/12）。
 */
export const getSeasonLevelBreakdown = (
  db: Db, seasonId: string, windowDays = ACTIVE_WINDOW_DAYS,
) =>
  all<LevelBreakdownRow>(db, `
    SELECT current_level, count(*) AS persons,
           count(*) FILTER (WHERE in_active_window) AS in_active_window
      FROM f_person_season_state($2)
     WHERE season_id = $1
     GROUP BY current_level
     ORDER BY CASE current_level
                WHEN 'accepted' THEN 1 WHEN 'applicant' THEN 2 ELSE 3 END`,
    [seasonId, windowDays])

// -------------------------------------------------------------
// 個人1人
// -------------------------------------------------------------

export interface PersonDetail {
  person_id: string
  family_name: string
  given_name: string
  family_name_kana: string | null
  given_name_kana: string | null
  birth_date: Date
  school_name: string
  faculty: string | null
  email: string
  phone: string | null
  line_user_id: string | null
  note: string | null
  identified_at: Date
  anonymized_at: Date | null
  /** 紹介者。利益相反の検出に効くので、名前まで引いて出す（資料3-4）。 */
  referrer_person_id: string | null
  referrer_name: string | null
  /** 卒業生スタッフなら埋まる。面接官として選考に関わりうる。 */
  staff_display_name: string | null
  has_ever_applied: boolean
  has_ever_been_accepted: boolean
  application_count: number
  last_touch_at: Date | null
  touchpoint_count: number
  /** 紹介した人数。この人がハブになっているかが分かる。 */
  referred_count: number
}

export const getPerson = (db: Db, personId: string | string[] | undefined) => {
  const id = asId(personId)
  if (!id) return Promise.resolve(null)
  return maybeOne<PersonDetail>(db, `
    SELECT p.id AS person_id, p.family_name, p.given_name,
           p.family_name_kana, p.given_name_kana, p.birth_date,
           sc.name AS school_name, p.faculty, p.email, p.phone, p.line_user_id, p.note,
           ls.identified_at, p.anonymized_at,
           p.referrer_person_id,
           -- 紹介者が削除済みなら名前を出さない。削除は連鎖する。
           CASE WHEN r.deleted_at IS NULL
                THEN r.family_name || ' ' || r.given_name END AS referrer_name,
           st.display_name AS staff_display_name,
           ls.has_ever_applied, ls.has_ever_been_accepted, ls.application_count,
           ls.last_touch_at,
           (SELECT count(*) FROM touchpoints t WHERE t.person_id = p.id) AS touchpoint_count,
           (SELECT count(*) FROM persons ref
             WHERE ref.referrer_person_id = p.id AND ref.deleted_at IS NULL) AS referred_count
      FROM persons p
      JOIN schools sc ON sc.id = p.school_id
      JOIN v_person_lifetime_summary ls ON ls.person_id = p.id
      LEFT JOIN persons r ON r.id = p.referrer_person_id
      LEFT JOIN staffs st ON st.person_id = p.id
     WHERE p.id = $1 AND p.deleted_at IS NULL`, [id])
}

export interface PersonSeasonRow {
  season_id: string
  enrollment_year: number
  current_level: string
  is_accepted_in_season: boolean
  has_applied_in_season: boolean
  application_count: number
  as_of: Date
  last_touch_at: Date | null
  in_active_window: boolean
}

/**
 * 年度ごとの現在地。
 *
 * current_level（段）と in_active_window（接点の鮮度）は直交する。
 * 木や幹になった人も、接点を持てば年度サマリの林に数えられている。
 * 段ごとに数えて足すと年度サマリと合わないが、段を問わず窓の内側を
 * 数えれば一致する（0010 のコメント、tests/12）。
 */
export const getPersonSeasonStates = (
  db: Db, personId: string | string[] | undefined, windowDays = ACTIVE_WINDOW_DAYS,
) => {
  const id = asId(personId)
  if (!id) return Promise.resolve([])
  return all<PersonSeasonRow>(db, `
    SELECT season_id, enrollment_year, current_level, is_accepted_in_season,
           has_applied_in_season, application_count, as_of, last_touch_at, in_active_window
      FROM f_person_season_state($2)
     WHERE person_id = $1
     ORDER BY enrollment_year DESC`, [id, windowDays])
}

/**
 * 応募の結末。定義は v_application_outcome（0011）にある。
 *
 * 画面がこれを自前で組み立てると、同じ応募の結末が画面ごとに変わる。
 * 実際、実行③の画面2枚は同じラダーを別々に書いており、遷移が1行も
 * 無い応募をどちらも「選考中」にしていた（A-14）。
 */
export type ApplicationOutcome =
  'accepted' | 'withdrawn' | 'rejected' | 'voided' | 'in_selection'

export const OUTCOME_LABEL: Record<ApplicationOutcome, { label: string; cls: string }> = {
  accepted:     { label: '幹（合格）', cls: 'badge-tag-green' },
  withdrawn:    { label: '辞退',       cls: 'badge-tag-orange' },
  rejected:     { label: '不合格',     cls: 'badge-tag-gray' },
  voided:       { label: '無効化',     cls: 'badge-tag-gray' },
  in_selection: { label: '選考中',     cls: 'badge-tag-blue' },
}

export interface PersonApplicationRow {
  application_id: string
  season_id: string
  enrollment_year: number
  submitted_at: Date
  is_reapplication: boolean
  outcome: ApplicationOutcome
  /** いま誰かが判断すべき状態にあるか。結末が付いていれば偽。 */
  is_in_selection: boolean
  is_voided: boolean
  voided_at: Date | null
  void_reason_label: string | null
  /** 無効化理由が「代替の応募が生まれない」側かどうか。集計に数えるかを決める。 */
  is_countable: boolean
  is_accepted: boolean | null
  is_rejected: boolean | null
  is_withdrawn: boolean | null
  evaluation_count: number
  history_count: number
}

/**
 * 応募の一覧。無効化されたものも返す。
 *
 * v_application_state で作ると、代替が生まれる無効化（名寄せ誤り）の応募が
 * 消える。消えた応募に評価や遷移がぶら下がっていると、記録層にはあるのに
 * 画面のどこにも出ない状態になる。集計に数えるかどうかは列で示す。
 */
export const getPersonApplications = (db: Db, personId: string | string[] | undefined) => {
  const id = asId(personId)
  if (!id) return Promise.resolve([])
  return all<PersonApplicationRow>(db, `
    SELECT a.id AS application_id, a.season_id, se.enrollment_year, a.submitted_at,
           a.is_reapplication,
           o.outcome, (o.outcome = 'in_selection') AS is_in_selection,
           -- v_application_state.is_voided を読む。集計に数えつつ無効化されて
           -- いる応募（取り下げ）は、この列でしか区別できない（E-4）。
           COALESCE(s.is_voided, a.voided_at IS NOT NULL) AS is_voided,
           a.voided_at, vr.label AS void_reason_label,
           (s.application_id IS NOT NULL) AS is_countable,
           s.is_accepted, s.is_rejected, s.is_withdrawn,
           (SELECT count(*) FROM evaluations e WHERE e.application_id = a.id)
             AS evaluation_count,
           (SELECT count(*) FROM status_histories sh WHERE sh.application_id = a.id)
             AS history_count
      FROM applications a
      JOIN persons p ON p.id = a.person_id AND p.deleted_at IS NULL
      JOIN seasons se ON se.id = a.season_id
      JOIN v_application_outcome o ON o.application_id = a.id
      LEFT JOIN void_reasons vr ON vr.id = a.void_reason_id
      LEFT JOIN v_application_state s ON s.application_id = a.id
     WHERE a.person_id = $1 AND a.deleted_at IS NULL
     ORDER BY se.enrollment_year DESC, a.submitted_at DESC`, [id])
}

export interface PersonTouchpointRow {
  touchpoint_id: string
  occurred_at: Date
  channel: string
  partner_name: string | null
  /** 年度帰属。どの年度にも属さない接点は null（(4)で「未割当」として出るもの）。 */
  enrollment_year: number | null
  is_self_reported: boolean
  is_scout: boolean
  applied_at: Date | null
  attended_at: Date | null
  note: string | null
}

/** 接点の時系列。集客の経緯そのもの。 */
export const getPersonTouchpoints = (db: Db, personId: string | string[] | undefined) => {
  const id = asId(personId)
  if (!id) return Promise.resolve([])
  return all<PersonTouchpointRow>(db, `
    SELECT t.id AS touchpoint_id, t.occurred_at, c.name AS channel,
           pa.name AS partner_name, se.enrollment_year,
           t.is_self_reported, t.is_scout, t.applied_at, t.attended_at, t.note
      FROM touchpoints t
      JOIN persons p ON p.id = t.person_id AND p.deleted_at IS NULL
      JOIN channels c ON c.id = t.channel_id
      LEFT JOIN partners pa ON pa.id = t.partner_id
      -- 年度帰属の定義は v_touchpoint_season にある。ここで書き直さない。
      LEFT JOIN v_touchpoint_season ts ON ts.touchpoint_id = t.id
      LEFT JOIN seasons se ON se.id = ts.season_id
     WHERE t.person_id = $1
     ORDER BY t.occurred_at DESC, t.id DESC`, [id])
}

// -------------------------------------------------------------
// 応募1件
// -------------------------------------------------------------

export interface ApplicationDetail {
  application_id: string
  person_id: string
  applicant_name: string
  school_name: string
  season_id: string
  enrollment_year: number
  submitted_at: Date
  form_response_id: string | null
  is_reapplication: boolean
  outcome: ApplicationOutcome
  is_in_selection: boolean
  is_voided: boolean
  voided_at: Date | null
  void_reason_label: string | null
  is_countable: boolean
  is_accepted: boolean | null
  is_rejected: boolean | null
  is_withdrawn: boolean | null
  /** 年度の最終ステップ名。「幹になる」の定義そのもの。 */
  final_step_name: string
}

export const getApplication = (db: Db, applicationId: string | string[] | undefined) => {
  const id = asId(applicationId)
  if (!id) return Promise.resolve(null)
  return maybeOne<ApplicationDetail>(db, `
    SELECT a.id AS application_id, a.person_id,
           p.family_name || ' ' || p.given_name AS applicant_name,
           sc.name AS school_name,
           a.season_id, se.enrollment_year, a.submitted_at, a.form_response_id,
           a.is_reapplication,
           o.outcome, (o.outcome = 'in_selection') AS is_in_selection,
           COALESCE(s.is_voided, a.voided_at IS NOT NULL) AS is_voided,
           a.voided_at, vr.label AS void_reason_label,
           (s.application_id IS NOT NULL) AS is_countable,
           s.is_accepted, s.is_rejected, s.is_withdrawn,
           fs.selection_step_name AS final_step_name
      FROM applications a
      JOIN persons p ON p.id = a.person_id AND p.deleted_at IS NULL
      JOIN schools sc ON sc.id = p.school_id
      JOIN seasons se ON se.id = a.season_id
      JOIN v_final_selection_step fs ON fs.season_id = a.season_id
      JOIN v_application_outcome o ON o.application_id = a.id
      LEFT JOIN void_reasons vr ON vr.id = a.void_reason_id
      LEFT JOIN v_application_state s ON s.application_id = a.id
     WHERE a.id = $1 AND a.deleted_at IS NULL`, [id])
}

export interface TimelineRow {
  history_id: string
  transition_type: string
  occurred_at: Date
  step_name: string | null
  step_order: number | null
  changed_by: string
  withdraw_reason_label: string | null
  note: string | null
  is_correction: boolean
  corrects_history_id: string | null
  /** この行を打ち消した訂正行。あれば「取り消された」ことが分かる。 */
  corrected_by_history_id: string | null
  /** 訂正チェーンを解いた結果、いま有効か（深さ偶数）。 */
  is_effective: boolean
}

/**
 * 状態遷移の全履歴。有効なものだけに絞らない。
 *
 * v_effective_status_histories だけを出すと、「不合格の連絡をしたのに
 * なぜ合格しているのか」を画面から説明できない。②（誰が何を根拠に
 * 判断したか）に効くのは、結論ではなく経緯のほうである。
 *
 * 訂正の訂正まで戻ると元の記録が有効に戻る（会計の逆仕訳）。
 * 打ち消し行があることと、いま有効かどうかは別の列で示す。
 * 「訂正された = 無効」だと思って取り消し線を引くと、深さ2の行で嘘になる。
 */
export const getApplicationTimeline = (db: Db, applicationId: string | string[] | undefined) => {
  const id = asId(applicationId)
  if (!id) return Promise.resolve([])
  return all<TimelineRow>(db, `
    SELECT sh.id AS history_id, sh.transition_type, sh.occurred_at,
           ss.name AS step_name, ss.sort_order AS step_order,
           st.display_name AS changed_by,
           wr.label AS withdraw_reason_label, sh.note,
           sh.is_correction, sh.corrects_history_id,
           (SELECT c.id FROM status_histories c WHERE c.corrects_history_id = sh.id)
             AS corrected_by_history_id,
           EXISTS (SELECT 1 FROM v_effective_status_histories e WHERE e.id = sh.id)
             AS is_effective
      FROM status_histories sh
      JOIN applications a ON a.id = sh.application_id AND a.deleted_at IS NULL
      JOIN persons p ON p.id = a.person_id AND p.deleted_at IS NULL
      JOIN staffs st ON st.id = sh.changed_by_staff_id
      -- reject と withdraw は selection_step_id を持たない。
      -- 「直前に割り当てられた評価のステップ」で埋めない。推測を事実の
      -- 隣に並べると、根拠のない情報が一人歩きする（getStepFlow と同じ判断）。
      LEFT JOIN selection_steps ss ON ss.id = sh.selection_step_id
      LEFT JOIN withdraw_reasons wr ON wr.id = sh.withdraw_reason_id
     WHERE sh.application_id = $1
     ORDER BY sh.occurred_at, sh.created_at, sh.id`, [id])
}

export interface EvaluationScore {
  criteria_name: string
  score: number
  scale_max: number
  rationale: string
  applies_to: string
}

/**
 * まだ点が付いていない評価軸。
 *
 * 「評価する」と言われた人が**何を評価するのか**を出すために要る。
 * これが無いと、応募の画面は「判断がまだ下りていないため、点も根拠も無い」
 * としか言えず、次の一手が画面から読めない（E1、C-24）。
 */
export interface PendingCriterion {
  criteria_name: string
  scale_max: number
  applies_to: string
}

export interface EvaluationRow {
  evaluation_id: string
  step_name: string
  step_order: number
  attempt: number
  interviewer: string | null
  state: string
  assigned_at: Date
  submitted_at: Date | null
  hold_reason: string | null
  handover_note: string | null
  /** 利益相反の種別。無ければ null。 */
  conflict_type: string | null
  scores: EvaluationScore[]
  /** 適用される軸のうち、まだ点が付いていないもの。 */
  pending_criteria: PendingCriterion[]
}

/**
 * 評価とスコア。②に答えるのはここ。
 *
 * pending や held の評価も返す。判断が下りていないことも事実なので、
 * 落とすと「いま誰の判断待ちか」が応募の画面から消える。
 *
 * スコアは別の問い合わせで引いて TS で束ねる。SQL 側で json に畳むと
 * ドライバごとに文字列で返るか構造で返るかが変わり、型が実態とずれる。
 */
export const getApplicationEvaluations = async (
  db: Db, applicationId: string | string[] | undefined,
): Promise<EvaluationRow[]> => {
  const id = asId(applicationId)
  if (!id) return []

  const evaluations = await all<Omit<EvaluationRow, 'scores'>>(db, `
    SELECT e.id AS evaluation_id, ss.name AS step_name, ss.sort_order AS step_order,
           e.attempt, st.display_name AS interviewer, e.state,
           e.assigned_at, e.submitted_at, e.hold_reason, e.handover_note,
           (SELECT coi.conflict_type FROM v_conflict_of_interest coi
             WHERE coi.evaluation_id = e.id LIMIT 1) AS conflict_type
      FROM evaluations e
      JOIN applications a ON a.id = e.application_id AND a.deleted_at IS NULL
      JOIN persons p ON p.id = a.person_id AND p.deleted_at IS NULL
      JOIN selection_steps ss ON ss.id = e.selection_step_id
      LEFT JOIN staffs st ON st.id = e.interviewer_staff_id
     WHERE e.application_id = $1
     ORDER BY ss.sort_order, e.attempt, e.assigned_at`, [id])
  if (evaluations.length === 0) return []

  const scores = await all<EvaluationScore & { evaluation_id: string }>(db, `
    SELECT es.evaluation_id, ec.name AS criteria_name, es.score, ec.scale_max,
           es.rationale, ec.applies_to
      FROM evaluation_scores es
      JOIN evaluation_criteria ec ON ec.id = es.criteria_id
      JOIN evaluations e ON e.id = es.evaluation_id
     WHERE e.application_id = $1
     ORDER BY ec.sort_order`, [id])

  // まだ点が付いていない軸。適用の判定は「軸の applies_to」と
  // 「その応募が再応募か」の2つの事実だけで決まる（トリガ
  // evaluation_scores_applicability と同じ規則。あちらは書き込みを拒否し、
  // こちらは何を書くべきかを出す。規則が2箇所にあるので、
  // tests/19 が両者の一致を固定している）。
  const pending = await all<PendingCriterion & { evaluation_id: string }>(db, `
    SELECT e.id AS evaluation_id, ec.name AS criteria_name,
           ec.scale_max, ec.applies_to
      FROM evaluations e
      JOIN applications a ON a.id = e.application_id
      JOIN evaluation_criteria ec ON ec.selection_step_id = e.selection_step_id
     WHERE e.application_id = $1
       AND (ec.applies_to = 'all'
            OR (ec.applies_to = 'reapplicant_only' AND a.is_reapplication))
       AND NOT EXISTS (
           SELECT 1 FROM evaluation_scores es
            WHERE es.evaluation_id = e.id AND es.criteria_id = ec.id)
     ORDER BY ec.sort_order`, [id])

  const byEvaluation = new Map<string, EvaluationScore[]>()
  for (const { evaluation_id, ...s } of scores) {
    const list = byEvaluation.get(evaluation_id)
    if (list) list.push(s)
    else byEvaluation.set(evaluation_id, [s])
  }
  const pendingBy = new Map<string, PendingCriterion[]>()
  for (const { evaluation_id, ...c } of pending) {
    const list = pendingBy.get(evaluation_id)
    if (list) list.push(c)
    else pendingBy.set(evaluation_id, [c])
  }
  return evaluations.map((e) => ({
    ...e,
    scores: byEvaluation.get(e.evaluation_id) ?? [],
    pending_criteria: pendingBy.get(e.evaluation_id) ?? [],
  }))
}

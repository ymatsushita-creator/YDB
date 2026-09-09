import { all, maybeOne, scalar, type Db } from '../db/client.ts'

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

/* ★ `listManualTasks` は消した（C-209）。手で足すやることの画面は無く、
   **どこからも呼ばれていなかった。** 呼ばれない読み取りが残ると、
   次に触る人が「使われている経路がある」と読む。 */

export const listDerivedTasks = (db: Db, seasonId: string) =>
  all<{
    source_id: string; kind: string; person_id: string; person_name: string
    step_name: string; owner: string | null; waiting_days: number
    sla_days: number | null; is_overdue: boolean
    /**
     * やることが指している応募。
     *
     * ★ `source_id` は**評価のID**であって応募のIDではない（0014）。
     *   画面のリンクを `source_id` で組み立てていたため、
     *   「◯◯さんの二次面接を評価する」を押すと 404 になっていた ――
     *   **画面から点を入れられる唯一の経路が壊れていた**（C-60）。
     */
    application_id: string
  }>(db, `
    SELECT t.source_id, t.kind, t.person_id, t.application_id,
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
  number: number | null
  family_name: string
  given_name: string
  family_name_kana: string | null
  given_name_kana: string | null
  birth_date: string | null
  person_name: string
  person_kana: string | null
  has_photo: boolean
  school: string
  faculty: string | null
  email: string | null
  phone: string | null
  line_user_id: string | null
  note: string | null
  first_channel_name: string | null
  first_contacted_on: string | null
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
    SELECT h.person_id, h.number,
           p.family_name, p.given_name, p.family_name_kana, p.given_name_kana,
           to_char(p.birth_date, 'YYYY-MM-DD') AS birth_date,
           p.family_name || ' ' || p.given_name AS person_name,
           nullif(btrim(coalesce(p.family_name_kana, '') || ' '
                        || coalesce(p.given_name_kana, '')), '') AS person_kana,
           (p.photo_data_url IS NOT NULL) AS has_photo,
           sc.name AS school, p.faculty, p.email, p.phone, p.line_user_id, p.note,
           c.confidence_ratio, c.rank_in_season, c.rank_delta,
           coalesce(c.has_previous_run, false) AS has_previous_run,
           (SELECT max(jst_date(t.occurred_at)) FROM v_touchpoint_season t
             WHERE t.person_id = h.person_id AND t.season_id = h.season_id)
             AS last_touchpoint_on,
           first_touch.channel_name AS first_channel_name,
           to_char(first_touch.occurred_on, 'YYYY-MM-DD') AS first_contacted_on,
           h.approach_code, h.approach_label
      FROM v_candidate_population h
      JOIN persons p ON p.id = h.person_id
      JOIN schools sc ON sc.id = p.school_id
      LEFT JOIN v_candidate_confidence_latest c
             ON c.person_id = h.person_id AND c.season_id = h.season_id
      LEFT JOIN LATERAL (
        SELECT ch.name AS channel_name, jst_date(t.occurred_at) AS occurred_on
          FROM touchpoints t
          JOIN channels ch ON ch.id = t.channel_id
         WHERE t.person_id = h.person_id
         ORDER BY t.occurred_at, t.id
         LIMIT 1
      ) first_touch ON true
     WHERE h.season_id = $1
     ORDER BY c.rank_in_season NULLS LAST, h.state_since DESC, p.id
     LIMIT $2 OFFSET $3`, [seasonId, opts.limit, opts.offset])

  const total = await maybeOne<{ n: number }>(db,
    `SELECT count(*)::int AS n FROM v_candidate_population WHERE season_id = $1`, [seasonId])

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
  /**
   * この行が代表している評価。**採点はこの評価に対して行う。**
   *
   * 1つの応募に同じステップの評価が2件あることがある（面接官が2人）ので、
   * 一覧は待ちの長いほうへ畳んでいる。畳んだ結果を持ち歩かずに
   * 「この応募のこのステップの評価」を採点側で引き直すと、
   * **画面が出している「n 軸」と、点が入る先が別の評価になりうる。**
   * 操作できる母集団と画面に出す母集団を一致させる（CLAUDE.md）。
   */
  evaluation_id: string
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
           a.id AS application_id, e.id AS evaluation_id, a.person_id,
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

/**
 * その段で**確定済み・判定待ち**の応募の数（C-216）。
 *
 * ★ 段の一覧は `e.state <> 'submitted'`、つまり**採点する対象**しか出さない。
 *   採点を確定した応募はその瞬間に一覧から消えるが、**判定はまだ残っている。**
 *   平社員ペルソナ試験で「6人採点したのに、どこにも居ない」となった。
 *   一覧から消すのは変えない（採点の場である）が、**黙って消さない** ――
 *   件数を出して、判定はその応募の画面だと言う。
 */
export const countAwaitingDecision = (db: Db, seasonId: string, stepId: string) =>
  scalar<number>(db, `
    SELECT count(*)::int
      FROM v_active_applications a
      JOIN evaluations e ON e.application_id = a.id
                        AND e.selection_step_id = $2
                        AND e.state = 'submitted'
     WHERE a.season_id = $1
       AND NOT EXISTS (
             SELECT 1 FROM v_effective_status_histories h
              WHERE h.application_id = a.id
                AND h.selection_step_id = $2)`, [seasonId, stepId])

export interface ScoringCriterion {
  criteria_id: string
  criteria_name: string
  /** 何を見る軸なのか（0042）。表の基準表の文面。未登録なら null。 */
  criteria_description: string | null
  scale_max: number
  applies_to: string
  /** まだ付いていなければ null。 */
  score: number | null
  rationale: string | null
}

export interface ScoringSheet {
  evaluation_id: string
  application_id: string
  person_id: string
  person_name: string
  step_name: string
  attempt: number
  interviewer: string | null
  state: string
  criteria: ScoringCriterion[]
  /** まだ点が付いていない軸の数。 */
  unscored_count: number
  /** そもそも軸が1本も登録されていない。 */
  no_criteria: boolean
  /** いま点を付けられるか。判定は `v_open_tasks` の種別だけ（C-25）。 */
  can_score: boolean
  /** 付けられない理由。付けられるときは null。 */
  blocked_by: string | null
  /** いま確定できるか。 */
  can_submit: boolean
}

/**
 * 採点シート（実行⑩。依頼者の指示 ――「そこで採点入力する」）。
 *
 * 選考タブは成績（100点換算）と付いた軸の数を出しているのに、
 * **その場で点を入れる入口が無かった。** 点を入れられるのは応募の画面だけで、
 * そこへは「やること」からしか行けない。ここはその欠けを埋める。
 *
 * ★ **応募とステップではなく、評価そのもので引く。**
 *   一覧は面接官が2人のとき応募あたり1行へ畳んでいる。同じ条件を
 *   ここで書き直すと、畳み方が食い違ったときに**画面の数字と点の行き先が
 *   別の評価になる。** 一覧が名指しした `evaluation_id` を受け取る。
 *
 * ★ 判定を書き写していない。点を付けられるかは `v_open_tasks` の種別、
 *   実際に保存できるかは記録層の CHECK とトリガが決める（C-25）。
 *   ここは**何を評価するのか**と**いま何が足りないのか**を出すだけ。
 */
export const getScoringSheet = async (
  db: Db, evaluationId: string | undefined,
): Promise<ScoringSheet | null> => {
  if (!evaluationId || !UUID.test(evaluationId)) return null

  const head = await maybeOne<
    Omit<ScoringSheet, 'criteria' | 'unscored_count' | 'no_criteria'
    | 'can_score' | 'blocked_by' | 'can_submit'>
    & { task_kind: string | null }
  >(db, `
    SELECT e.id AS evaluation_id, a.id AS application_id, p.id AS person_id,
           p.family_name || ' ' || p.given_name AS person_name,
           ss.name AS step_name, e.attempt, e.state,
           stf.display_name AS interviewer,
           (SELECT t.kind FROM v_open_tasks t WHERE t.source_id = e.id) AS task_kind
      FROM evaluations e
      JOIN applications a ON a.id = e.application_id AND a.deleted_at IS NULL
      JOIN persons p ON p.id = a.person_id AND p.deleted_at IS NULL
      JOIN selection_steps ss ON ss.id = e.selection_step_id
      LEFT JOIN staffs stf ON stf.id = e.interviewer_staff_id
     WHERE e.id = $1`, [evaluationId])
  if (!head) return null

  // 適用される軸を、付いた点ごと1回で引く。
  // 適用の規則（applies_to と再応募）はトリガ evaluation_scores_applicability
  // と同じもので、tests/19 が両者の一致を固定している。
  const criteria = await all<ScoringCriterion>(db, `
    SELECT ec.id AS criteria_id, ec.name AS criteria_name,
           ec.description AS criteria_description, ec.scale_max, ec.applies_to,
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

  const { task_kind, ...rest } = head
  const canScore = task_kind === 'evaluate'
  const unscored = criteria.filter((c) => c.score === null).length

  return {
    ...rest,
    criteria,
    unscored_count: unscored,
    no_criteria: criteria.length === 0,
    can_score: canScore,
    // 知らない種別が来ても「できるように見える」形にしない。
    blocked_by: canScore ? null : SCORE_BLOCKED_BY[task_kind ?? 'none'] ?? 'いまは点を付けられない',
    // ★ 軸が0本のときを「全軸そろった」と読まない。0 件そろっても、
    //   点が1つも無い評価が確定できてしまう。確定の可否は最後に
    //   `submitEvaluation` が記録層の規則で決めるが、**押せる形で出さない。**
    can_submit: canScore && criteria.length > 0 && unscored === 0,
  }
}

/**
 * その人が、その期に持っている評価をすべて（実行⑩。依頼者の指示 ――
 * 「個人名押したら採点できるレイヤー」）。
 *
 * ★ 一覧のタブは「いまその段に居る応募」しか出さない。
 *   採点する人が開きたいのは**その候補者の採点用紙そのもの**で、
 *   段は選ぶものではなく並んでいるものである。
 *   だからここは**段で絞らない。** 確定済みも落とさない ――
 *   前の段で何点だったかを見ずに次の段は付けられない。
 */
export const listPersonEvaluationIds = (db: Db, personId: string, seasonId: string) =>
  all<{ evaluation_id: string }>(db, `
    SELECT e.id AS evaluation_id
      FROM evaluations e
      JOIN applications a ON a.id = e.application_id AND a.deleted_at IS NULL
      JOIN persons p ON p.id = a.person_id AND p.deleted_at IS NULL
      JOIN selection_steps ss ON ss.id = e.selection_step_id
     WHERE a.person_id = $1 AND a.season_id = $2
     ORDER BY ss.sort_order, e.attempt, e.assigned_at`, [personId, seasonId])

/**
 * 点を付けられない理由。**次にやることを名指しする。**
 *
 * 応募の画面（`src/queries/drilldown.ts`）と同じ言葉を使う。
 * 同じ状態を2つの画面が別の言い方で呼ぶと、どちらが正しいか分からなくなる。
 */
const SCORE_BLOCKED_BY: Record<string, string> = {
  assign: '先に担当を決める',
  unhold: '先に保留を解く',
  reassign: '先に担当を替える',
  none: 'この応募はもう動いていない',
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
  owner_name: string | null
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
  email: string | null
  phone: string | null
  birth_date: Date | null
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


// -------------------------------------------------------------
// 5. メモ（実行⑪。依頼者の指示）
// -------------------------------------------------------------

export interface PersonNote {
  note_id: string
  author_name: string
  /** 出来事の日時（手入力）。 */
  noted_at: Date
  /** 行が記録された時刻（自動）。手入力の日時とは別物。 */
  created_at: Date
  body: string
  /**
   * どう関わったか（0030。実行⑫）。自由入力の1行で、任意。
   * **マスタではないので数えられない**（表記が揺れる）。
   */
  involvement: string | null
}

/**
 * その人のメモ。**有効な行だけ**（訂正チェーンを解決したビューを読む）。
 *
 * 並びは出来事の日時の新しい順。同じ日時なら記録された順で決める ――
 * 順序が決まらないと、同じ問いに画面ごとに違う答えが出る。
 */
export const listPersonNotes = (db: Db, personId: string) =>
  all<PersonNote>(db, `
    SELECT n.id AS note_id, n.author_name, n.noted_at, n.created_at, n.body,
           n.involvement
      FROM v_effective_person_notes n
     WHERE n.person_id = $1
     ORDER BY n.noted_at DESC, n.created_at DESC, n.id DESC`, [personId])


// -------------------------------------------------------------
// 6. 予定の参加者（実行⑪。依頼者の指示）
// -------------------------------------------------------------

export interface AppointmentDetail {
  appointment_id: string
  title: string
  kind_label: string
  starts_at: Date
  ends_at: Date
  owner_name: string | null
  person_name: string | null
  cancelled: boolean
}

export const getAppointmentDetail = (db: Db, appointmentId: string, seasonId: string) =>
  maybeOne<AppointmentDetail>(db, `
    SELECT a.id AS appointment_id, a.title, k.label AS kind_label,
           a.starts_at, a.ends_at, s.display_name AS owner_name,
           p.family_name || ' ' || p.given_name AS person_name,
           (a.cancelled_at IS NOT NULL) AS cancelled
      FROM appointments a
      JOIN appointment_kinds k ON k.id = a.kind_id
      LEFT JOIN staffs s ON s.id = a.owner_staff_id
      LEFT JOIN persons p ON p.id = a.person_id
     WHERE a.id = $1 AND a.season_id = $2`, [appointmentId, seasonId])

export interface AttendanceCandidate {
  person_id: string
  person_name: string
  photo_data_url: string | null
  school: string
  attended: boolean
}

/**
 * 参加者のチェック欄に並べる人。
 *
 * ★ 母集団は**その期の一覧と同じ**（`v_headhunting_list`）。
 *   ここだけ別の母集団にすると、「一覧に居ないのにチェックできる人」か
 *   「チェックできないのに一覧に居る人」が出る（CLAUDE.md）。
 *   コマンド側も同じビューで確かめている（`src/commands/attend.ts`）。
 */
export const listAttendanceCandidates = (
  db: Db, appointmentId: string, seasonId: string,
) =>
  all<AttendanceCandidate>(db, `
    SELECT h.person_id,
           p.family_name || ' ' || p.given_name AS person_name,
           p.photo_data_url, sc.name AS school,
           (ea.attendance_id IS NOT NULL) AS attended
      FROM v_headhunting_list h
      JOIN persons p ON p.id = h.person_id
      JOIN schools sc ON sc.id = p.school_id
      LEFT JOIN v_event_attendance ea
             ON ea.person_id = h.person_id AND ea.appointment_id = $1
     WHERE h.season_id = $2
     ORDER BY (ea.attendance_id IS NOT NULL) DESC, p.family_name, p.given_name, p.id`,
  [appointmentId, seasonId])

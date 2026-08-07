import { all, maybeOne, type Db } from '../db/client.ts'

/**
 * コックピット（運転席）の問い合わせ。
 *
 * 答えるべき問いは4つだけである（実行⑥の指示）。
 *
 *   1. いま何をすべきか
 *   2. どの森が要注意か
 *   3. どの人が待っているか
 *   4. 何が止まっているか
 *
 * 集計の定義はビュー側（0012）に置き、ここは呼んで並べ替えるだけに留める。
 * 画面で数え直すと、同じ画面の別の数字と食い違う（C-11 と同じ理由）。
 *
 * ★ 「要注意」を1つのスコアに畳んでいない。
 *   Forest Health は原典の実装段階[3]（スコアリング）で、原典は着手判断を
 *   1年後と書いている。いま合成すると、根拠のない数字が一人歩きする。
 *   代わりに**事実の旗**を並べ、並べ替えの規則を画面に注記する。
 *   TODO(MVP): Health / Relationship Strength / Owner は未実装。
 */

/** 森が休眠と見なされるまでの日数。運用時に決定する仮の値。 */
export const DORMANT_DAYS = 60

// -------------------------------------------------------------
// 1. いま何をすべきか
// -------------------------------------------------------------

export type TaskKind = 'evaluate' | 'assign' | 'unhold' | 'reassign'

export interface OpenTask {
  kind: TaskKind
  source_id: string
  application_id: string
  person_id: string
  person_name: string
  step_name: string
  step_order: number
  /** 担当。NULL は「まだ誰のものでもない」で、それ自体がタスクである。 */
  owner: string | null
  waiting_days: number
  sla_days: number | null
  is_overdue: boolean
  detail: string | null
  /** 適用される評価軸の数。 */
  criteria_total: number
  /** すでに点が付いた軸の数。 */
  criteria_scored: number
}

/**
 * いまやること。
 *
 * 並べ替えは「期限を超えたもの → 待ちの長いもの → 選考の早いステップ」。
 * 種別で優先順位を付けていない。種別の重みは運用で決まるもので、
 * いま決めると根拠のない序列が固定化する（TODO(MVP)）。
 *
 * 氏名は v_open_tasks が持たない。個人情報削除済みは母集団
 * （v_active_applications）の側で外れているので、ここでの結合で復活しない。
 */
export const getOpenTasks = (db: Db, seasonId: string) =>
  all<OpenTask>(db, `
    SELECT t.kind, t.source_id, t.application_id, t.person_id,
           p.family_name || ' ' || p.given_name AS person_name,
           t.step_name, t.step_order,
           st.display_name AS owner,
           t.waiting_days, t.sla_days, t.is_overdue, t.detail,
           -- 入力の進み具合。「評価する」と出ているだけでは、着手前か
           -- 途中かが区別できない。1件ずつ開かないと分からないのは、
           -- 5秒で読める画面ではない（E1）。
           (SELECT count(*) FROM evaluation_criteria ec
             WHERE ec.selection_step_id = t.selection_step_id
               AND (ec.applies_to = 'all'
                    OR (ec.applies_to = 'reapplicant_only' AND a.is_reapplication)))
             AS criteria_total,
           (SELECT count(*) FROM evaluation_scores es
             WHERE es.evaluation_id = t.source_id) AS criteria_scored
      FROM v_open_tasks t
      JOIN persons p ON p.id = t.person_id
      JOIN applications a ON a.id = t.application_id
      LEFT JOIN staffs st ON st.id = t.owner_staff_id
     WHERE t.season_id = $1
     ORDER BY t.is_overdue DESC, t.waiting_days DESC, t.step_order`, [seasonId])

export interface TaskTotals {
  open_tasks: number
  overdue: number
  evaluate: number
  assign: number
  unhold: number
  reassign: number
  /** 判断待ちの人数。タスク件数ではない（1人が複数持ちうる）。 */
  waiting_persons: number
}

/**
 * コックピットの見出しの数。
 *
 * 件数（タスク）と人数（Person）を別の列で返す。同じ数として扱うと、
 * 1人が2件持っている日に「20人が待っている」と嘘をつく。
 */
export const getTaskTotals = (db: Db, seasonId: string) =>
  maybeOne<TaskTotals>(db, `
    SELECT count(*)                                        AS open_tasks,
           count(*) FILTER (WHERE t.is_overdue)            AS overdue,
           count(*) FILTER (WHERE t.kind = 'evaluate')     AS evaluate,
           count(*) FILTER (WHERE t.kind = 'assign')       AS assign,
           count(*) FILTER (WHERE t.kind = 'unhold')       AS unhold,
           count(*) FILTER (WHERE t.kind = 'reassign')     AS reassign,
           count(DISTINCT t.person_id)                     AS waiting_persons
      FROM v_open_tasks t
     WHERE t.season_id = $1`, [seasonId])

// -------------------------------------------------------------
// 2. どの人が待っているか
// -------------------------------------------------------------

export interface WaitingPerson {
  person_id: string
  person_name: string
  application_id: string
  step_name: string
  /** その人が持つ未処理タスクの件数。 */
  tasks: number
  /** 最も長く待っている日数。 */
  waiting_days: number
  overdue: boolean
  /** 何を待っているか（最も古いタスクの種別）。 */
  kind: TaskKind
}

/**
 * 待っている人。
 *
 * タスクの一覧を人でまとめ直したもの。同じ人に2件のタスクが並ぶと
 * 「誰が待っているか」を数えられないため、人で畳んでから出す。
 * 代表する行は最も古いタスク（DISTINCT ON の並びが決める）。
 */
export const getWaitingPersons = (db: Db, seasonId: string) =>
  all<WaitingPerson>(db, `
    WITH ranked AS (
        SELECT DISTINCT ON (t.person_id)
               t.person_id, t.application_id, t.step_name, t.kind,
               t.waiting_days, t.is_overdue
          FROM v_open_tasks t
         WHERE t.season_id = $1
         ORDER BY t.person_id, t.waiting_days DESC, t.step_order
    ), counted AS (
        SELECT person_id, count(*) AS tasks
          FROM v_open_tasks WHERE season_id = $1 GROUP BY person_id
    )
    SELECT r.person_id,
           p.family_name || ' ' || p.given_name AS person_name,
           r.application_id, r.step_name, r.kind,
           c.tasks, r.waiting_days, r.is_overdue AS overdue
      FROM ranked r
      JOIN counted c ON c.person_id = r.person_id
      JOIN persons p ON p.id = r.person_id
     ORDER BY r.is_overdue DESC, r.waiting_days DESC`, [seasonId])

// -------------------------------------------------------------
// 3. どの森が要注意か
// -------------------------------------------------------------

export interface ForestRow {
  forest_id: string
  name: string
  category: string | null
  communities: number
  /** 年度を問わない最終接触日からの日数。接点が1件も無ければ null。 */
  days_since_touch: number | null
  /** 接点があった実人数（当該年度）。 */
  persons_touched: number
  applications: number
  accepted: number
  open_tasks: number
  overdue_tasks: number
  /** 推定の接触機会（全期間）。実人数と割ってはならない。 */
  estimated_reach: number | null
  /** 要注意の理由。空なら平常。 */
  flags: string[]
}

/**
 * 森の一覧と、要注意の理由。
 *
 * 3つの旗を立てる。どれも既存の事実そのままで、合成した指標ではない。
 *
 *   stalled  … その森に接点のある人のタスクが期限を超えている
 *   dormant  … 最終接触から DORMANT_DAYS 日以上たっている
 *   untouched… 接点が1件も無い（リーチの記録はありうる）
 *
 * ★ untouched の森は「推定リーチはあるのに識別ゼロ」でありうる。
 *   それを割って識別率にしてはならない（domain.md 8節）。実行②で
 *   作りかけて消した指標そのものである。旗として立てるだけにする。
 *
 * 並べ替えは 期限超過 → 未処理タスク → 休眠日数。この規則は画面に注記する。
 * 森の数は団体の数（実測 9）なので、全件を並べても問題にならない。
 */
export const getForests = async (db: Db, seasonId: string, dormantDays = DORMANT_DAYS) => {
  const rows = await all<Omit<ForestRow, 'flags'>>(db, `
    SELECT fa.forest_id, fa.name, fa.category, fa.communities,
           fa.days_since_touch, fa.estimated_reach,
           coalesce(sa.persons_touched, 0) AS persons_touched,
           coalesce(sa.applications, 0)    AS applications,
           coalesce(sa.accepted, 0)        AS accepted,
           coalesce(sa.open_tasks, 0)      AS open_tasks,
           coalesce(sa.overdue_tasks, 0)   AS overdue_tasks
      FROM v_forest_activity fa
      LEFT JOIN v_forest_season_activity sa
             ON sa.forest_id = fa.forest_id AND sa.season_id = $1
     WHERE fa.is_active
     ORDER BY coalesce(sa.overdue_tasks, 0) DESC,
              coalesce(sa.open_tasks, 0) DESC,
              fa.days_since_touch DESC NULLS FIRST,
              fa.name`, [seasonId])

  return rows.map((r): ForestRow => ({
    ...r,
    flags: [
      ...(Number(r.overdue_tasks) > 0 ? ['stalled'] : []),
      ...(r.days_since_touch === null ? ['untouched'] : []),
      ...(r.days_since_touch !== null && Number(r.days_since_touch) >= dormantDays
        ? ['dormant'] : []),
    ],
  }))
}

// -------------------------------------------------------------
// 4. 森を1つ開く（森 → 林 → 人へのズーム）
// -------------------------------------------------------------

export interface ForestDetail {
  forest_id: string
  name: string
  category: string | null
  first_contact_date: Date | null
  contact_name: string | null
  communities: number
  touchpoints: number
  persons_touched: number
  last_touch_on: Date | null
  days_since_touch: number | null
  estimated_reach: number | null
  last_reach_on: Date | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** URL の id はユーザが自由に書ける。UUID でなければ「見つからない」で返す。 */
export const getForest = (db: Db, forestId: string) => {
  if (!UUID.test(forestId)) return Promise.resolve(null)
  return maybeOne<ForestDetail>(db, `
    SELECT fa.forest_id, fa.name, fa.category, fa.first_contact_date,
           f.contact_name, fa.communities, fa.touchpoints, fa.persons_touched,
           fa.last_touch_on, fa.days_since_touch, fa.estimated_reach, fa.last_reach_on
      FROM v_forest_activity fa
      JOIN v_forests f ON f.forest_id = fa.forest_id
     WHERE fa.forest_id = $1`, [forestId])
}

export interface CommunityRow {
  community_id: string
  name: string
  persons_touched: number
  touchpoints: number
  last_touch_on: Date | null
}

/**
 * 森の中の林。
 *
 * 森に直付けされた接点は含まない。含めると「林の合計 = 森」に見えるが、
 * 実際は森直付けの分だけ足りない。単位ではなく帰属の違いなので、
 * 画面では森の数と林の行を別に出し、合計を並べない。
 *
 * ★ 削除済みの除外を `LEFT JOIN persons ... AND p.deleted_at IS NULL` で
 *   書いてはいけない。LEFT JOIN は行を落とさないので、削除済みの接点が
 *   p を NULL にしたまま残り、count(DISTINCT t.person_id) がそれを数える。
 *   接点が1件も無い林を残すために外部結合が要るのは touchpoints 側だけで、
 *   人の絞り込みは接点の結合条件の中に閉じる。
 *   tests/16「林の一覧に、森直付けの接点は混ざらない」が固定している。
 */
export const getCommunities = (db: Db, forestId: string) =>
  all<CommunityRow>(db, `
    SELECT c.community_id, c.name,
           count(DISTINCT t.person_id)      AS persons_touched,
           count(t.id)                      AS touchpoints,
           max(jst_date(t.occurred_at))     AS last_touch_on
      FROM v_communities c
      LEFT JOIN touchpoints t
             ON t.partner_id = c.community_id
            AND EXISTS (SELECT 1 FROM persons p
                         WHERE p.id = t.person_id AND p.deleted_at IS NULL)
     WHERE c.forest_id = $1 AND c.is_active
     GROUP BY c.community_id, c.name
     ORDER BY last_touch_on DESC NULLS LAST, c.name`, [forestId])

export interface ForestPersonRow {
  person_id: string
  person_name: string
  /** 接点が付いていた団体の名前。森直付けなら森の名前。 */
  via: string
  last_touch_on: Date
  touchpoints: number
  /** その年度に未処理タスクを持っているか。 */
  open_tasks: number
  overdue: boolean
}

/**
 * 森に接点がある人。
 *
 * 「所属している」ではない。**接触があった**という事実だけである。
 * TODO(MVP): 所属や役割（Relationship / Role）は記録層に無い。
 *            domain.md 10-1 で partner_relations と語が衝突しており未決。
 *
 * 年度で絞らない。森との関係は年度をまたいで続く（D-3 と同じ理由）。
 * タスクの有無だけは年度で絞る。誰かが判断すべきかは年度の話である。
 */
export const getForestPersons = (db: Db, forestId: string, seasonId: string) =>
  all<ForestPersonRow>(db, `
    WITH touched AS (
        SELECT t.person_id,
               max(jst_date(t.occurred_at)) AS last_touch_on,
               count(*)                     AS touchpoints
          FROM touchpoints t
          JOIN v_partner_forest pf ON pf.partner_id = t.partner_id
         WHERE pf.forest_id = $1
         GROUP BY t.person_id
    ), tasks AS (
        SELECT person_id,
               count(*)                            AS open_tasks,
               bool_or(is_overdue)                 AS overdue
          FROM v_open_tasks WHERE season_id = $2 GROUP BY person_id
    )
    SELECT tp.person_id,
           p.family_name || ' ' || p.given_name AS person_name,
           (SELECT pa.name FROM touchpoints t2
              JOIN partners pa ON pa.id = t2.partner_id
              JOIN v_partner_forest pf2 ON pf2.partner_id = t2.partner_id
             WHERE t2.person_id = tp.person_id AND pf2.forest_id = $1
             ORDER BY t2.occurred_at DESC LIMIT 1) AS via,
           tp.last_touch_on, tp.touchpoints,
           coalesce(tk.open_tasks, 0)   AS open_tasks,
           coalesce(tk.overdue, false)  AS overdue
      FROM touched tp
      JOIN persons p ON p.id = tp.person_id AND p.deleted_at IS NULL
      LEFT JOIN tasks tk ON tk.person_id = tp.person_id
     ORDER BY coalesce(tk.overdue, false) DESC,
              coalesce(tk.open_tasks, 0) DESC,
              tp.last_touch_on DESC
     LIMIT 60`, [forestId, seasonId])

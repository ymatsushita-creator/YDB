import type { Db } from './client.ts'

/**
 * 幻のデモ期と架空の人を、記録層から取り除く（依頼者の指示。実行⑯）。
 *
 * 依頼者の言葉 ――「デモを終了する。デモデータを消して。本番データを入れる」。
 *
 * ★★ **これは打ち消し行では済まない操作である。** ★★
 *
 *   CLAUDE.md は「追記専用テーブルの訂正は打ち消し行で行う」と定めている。
 *   だがそれは**実在の記録を訂正するときの作法**で、
 *   ここでやるのは「架空の世界を丸ごと畳む」ことである。
 *   打ち消し行を積んでも、架空の人は `persons` に残り続ける。
 *
 *   したがって**本当に消す。** 消す以上、境界を間違えたら戻せない。
 *   境界は 0029 が持っている印（`is_demo`）1つだけを見る。
 *   **日付や作られた時刻では判定しない**（実データと重なる）。
 *
 * ★ 消す順は「子から親へ」。外部キーはほとんどが NO ACTION で、
 *   CASCADE は evaluations の下2つしか無い。順序はここに書き下す。
 *
 * ★ 追記専用トリガは**この取引の中だけ**外す。DDL も取引に入るので、
 *   途中で落ちれば外したことごと巻き戻る。
 */

/** 追記専用のトリガ。消すあいだだけ外す。 */
const APPEND_ONLY: ReadonlyArray<readonly [table: string, trigger: string]> = [
  ['status_histories', 'status_histories_append_only'],
  ['person_notes', 'person_notes_append_only'],
  ['approach_events', 'approach_events_append_only'],
  ['person_profile_revisions', 'person_profile_revisions_append_only'],
  ['appointment_revisions', 'appointment_revisions_append_only'],
  ['manual_task_revisions', 'manual_task_revisions_append_only'],
  ['interview_sheet_revisions', 'interview_sheet_revisions_append_only'],
  ['evaluation_score_revisions', 'evaluation_score_revisions_append_only'],
  ['partner_reach_revisions', 'partner_reach_revisions_append_only'],
  ['partner_recommendation_events', 'partner_recommendation_events_append_only'],
  ['season_revisions', 'season_revisions_append_only'],
  ['score_snapshots', 'score_snapshots_append_only'],
  ['score_snapshot_details', 'score_snapshot_details_no_update'],
]

/**
 * 消す対象。**子から親の順**に並べる。この順序がそのまま実行順である。
 *
 * 絞り込みは2種類しかない ――
 *   架空の人（`persons.is_demo`）にぶら下がるもの
 *   デモ期（`seasons.is_demo`）にぶら下がるもの
 */
/** 架空の人。 */
const DEMO_P = `SELECT id FROM persons WHERE is_demo`
/** デモ期。 */
const DEMO_S = `SELECT id FROM seasons WHERE is_demo`
/** デモ期の選考ステップ。**評価軸と遷移がここにぶら下がる。** */
const DEMO_STEP = `SELECT id FROM selection_steps WHERE season_id IN (${DEMO_S})`
/** デモ期の評価軸。 */
const DEMO_CRIT =
  `SELECT id FROM evaluation_criteria WHERE selection_step_id IN (${DEMO_STEP})`
/** デモ期・架空の人の評価。 */
const DEMO_EVAL = `SELECT e.id FROM evaluations e
    LEFT JOIN applications a ON a.id = e.application_id
   WHERE a.season_id IN (${DEMO_S}) OR e.selection_step_id IN (${DEMO_STEP})`
/** デモ期・架空の人の応募。 */
const DEMO_APP = `SELECT id FROM applications
   WHERE season_id IN (${DEMO_S}) OR person_id IN (${DEMO_P})`

export const TARGETS: ReadonlyArray<{ table: string; where: string }> = [
  // 評価の下。**評価軸からも辿る** ―― 軸はステップにぶら下がっており、
  // ステップを消す前に軸を、軸を消す前に点を落とさないと外部キーで止まる。
  { table: 'evaluation_score_revisions',
    where: `evaluation_id IN (${DEMO_EVAL}) OR criteria_id IN (${DEMO_CRIT})` },
  { table: 'evaluation_scores',
    where: `evaluation_id IN (${DEMO_EVAL}) OR criteria_id IN (${DEMO_CRIT})` },
  { table: 'interview_sheet_revisions', where: `evaluation_id IN (${DEMO_EVAL})` },
  { table: 'interview_sheets', where: `evaluation_id IN (${DEMO_EVAL})` },
  { table: 'evaluations', where: `id IN (${DEMO_EVAL})` },
  { table: 'status_histories',
    where: `application_id IN (${DEMO_APP}) OR selection_step_id IN (${DEMO_STEP})` },
  { table: 'applications', where: `id IN (${DEMO_APP})` },

  // 参加は**人・予定・接点の3方向**から参照される。3つより先に落とす。
  { table: 'event_attendances', where: `person_id IN (${DEMO_P})
      OR appointment_id IN (SELECT id FROM appointments
           WHERE person_id IN (${DEMO_P}) OR season_id IN (${DEMO_S}))
      OR touchpoint_id IN (SELECT id FROM touchpoints WHERE person_id IN (${DEMO_P}))` },

  // 架空の人・デモ期にぶら下がるもの
  { table: 'appointment_revisions',
    where: `person_id IN (${DEMO_P}) OR season_id IN (${DEMO_S})
      OR appointment_id IN (SELECT id FROM appointments
           WHERE person_id IN (${DEMO_P}) OR season_id IN (${DEMO_S}))` },
  { table: 'appointments', where: `person_id IN (${DEMO_P}) OR season_id IN (${DEMO_S})` },
  { table: 'manual_task_revisions',
    where: `person_id IN (${DEMO_P}) OR season_id IN (${DEMO_S})
      OR manual_task_id IN (SELECT id FROM manual_tasks
           WHERE person_id IN (${DEMO_P}) OR season_id IN (${DEMO_S}))` },
  { table: 'manual_tasks', where: `person_id IN (${DEMO_P}) OR season_id IN (${DEMO_S})` },
  { table: 'person_notes', where: `person_id IN (${DEMO_P})` },
  { table: 'person_profile_revisions',
    where: `person_id IN (${DEMO_P}) OR referrer_person_id IN (${DEMO_P})` },
  { table: 'touchpoints', where: `person_id IN (${DEMO_P})` },
  { table: 'approach_events', where: `person_id IN (${DEMO_P}) OR season_id IN (${DEMO_S})` },
  { table: 'candidate_numbers', where: `person_id IN (${DEMO_P}) OR season_id IN (${DEMO_S})` },
  { table: 'form_responses', where: `person_id IN (${DEMO_P})` },
  { table: 'identity_resolutions',
    where: `person_id IN (${DEMO_P}) OR candidate_person_id IN (${DEMO_P})` },
  { table: 'score_snapshot_details', where: `snapshot_id IN (
      SELECT id FROM score_snapshots
       WHERE person_id IN (${DEMO_P}) OR season_id IN (${DEMO_S}))` },
  { table: 'score_snapshots', where: `person_id IN (${DEMO_P}) OR season_id IN (${DEMO_S})` },

  // デモ期にだけぶら下がるもの
  { table: 'partner_reach_revisions', where: `season_id IN (${DEMO_S})
      OR reach_id IN (SELECT id FROM partner_reaches WHERE season_id IN (${DEMO_S}))` },
  { table: 'partner_reaches', where: `season_id IN (${DEMO_S})` },
  { table: 'partner_recommendation_events', where: `season_id IN (${DEMO_S})` },
  { table: 'evaluation_criteria', where: `selection_step_id IN (${DEMO_STEP})` },
  { table: 'selection_steps', where: `season_id IN (${DEMO_S})` },
  { table: 'season_revisions', where: `season_id IN (${DEMO_S})` },

  // 親。紹介者が架空の人を指していても、同じ1文で消えるので順序は要らない
  // （外部キーの検査は文の終わりに走る）。
  { table: 'persons', where: `is_demo` },
  { table: 'seasons', where: `is_demo` },
]

/**
 * 消す前に止める条件。**架空の人が職員として登録されていたら、消さない。**
 *
 * `staffs.person_id` は人を指す。ここを黙って消すと、その職員が書いた
 * 実在の記録（担当・採点・訂正）の持ち主が消える。
 * 起きるはずのない組み合わせだが、**起きたときに気づかず進むのが最悪である。**
 */
export const BLOCKERS: ReadonlyArray<{ sql: string; reason: string }> = [
  { sql: `SELECT count(*) AS n FROM staffs WHERE person_id IN (${DEMO_P})`,
    reason: '架空の人が職員として登録されている' },
]

/**
 * 実在の側の数え方。**消す前と後で1つでも変わったら、その取引は捨てる。**
 *
 * ★ これは飾りではない。`is_demo` の条件を書き損なえば実在の行が落ちるが、
 *   落ちたことは件数を見るまで分からない。**見るまで確定させない。**
 */
const REAL_COUNTS = `SELECT
    (SELECT count(*) FROM persons      WHERE NOT is_demo) AS persons,
    (SELECT count(*) FROM seasons      WHERE NOT is_demo) AS seasons,
    (SELECT count(*) FROM applications a JOIN seasons s ON s.id = a.season_id
       WHERE NOT s.is_demo) AS applications,
    (SELECT count(*) FROM evaluations e JOIN applications a ON a.id = e.application_id
       JOIN seasons s ON s.id = a.season_id WHERE NOT s.is_demo) AS evaluations,
    (SELECT count(*) FROM person_notes n JOIN persons p ON p.id = n.person_id
       WHERE NOT p.is_demo) AS notes,
    (SELECT count(*) FROM approach_events ae JOIN persons p ON p.id = ae.person_id
       WHERE NOT p.is_demo) AS approaches,
    (SELECT count(*) FROM touchpoints t JOIN persons p ON p.id = t.person_id
       WHERE NOT p.is_demo) AS touchpoints,
    (SELECT count(*) FROM partner_reaches) AS reaches,
    (SELECT count(*) FROM staffs) AS staffs`

export interface RealCounts extends Record<string, number> {}

export const readRealCounts = async (db: Db): Promise<RealCounts> => {
  const { rows } = await db.query<Record<string, string>>(REAL_COUNTS)
  return Object.fromEntries(
    Object.entries(rows[0]!).map(([k, v]) => [k, Number(v)]),
  ) as RealCounts
}

/** 実在の側が動いた列だけを返す。空なら無傷。 */
export const diffRealCounts = (before: RealCounts, after: RealCounts): string[] =>
  Object.keys(before).filter((k) => before[k] !== after[k])
    .map((k) => `${k}: ${before[k]} → ${after[k]}`)

/** 消さずに数えるだけ。`--apply` が無いときの既定。 */
export async function countDemoRows(db: Db): Promise<{ table: string; rows: number }[]> {
  const out: { table: string; rows: number }[] = []
  for (const t of TARGETS) {
    const { rows } = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM ${t.table} WHERE ${t.where}`)
    out.push({ table: t.table, rows: Number(rows[0]!.n) })
  }
  return out
}

/**
 * 実際に消す。**1つの取引で、実在の側が動いていないことを確かめてから確定する。**
 *
 * 呼び出し側は取引を持たない（`Db` に取引の口が無い）。ここで素の SQL として
 * BEGIN / COMMIT を投げる。プールの接続が1本でない環境では、この関数だけを
 * 単独で走らせること ―― 途中に別のクエリが割り込むと取引が混ざる。
 */
export async function removeDemoRows(db: Db): Promise<{
  deleted: { table: string; rows: number }[]
  before: RealCounts
  after: RealCounts
}> {
  for (const b of BLOCKERS) {
    const { rows } = await db.query<{ n: string }>(b.sql)
    if (Number(rows[0]!.n) > 0) throw new Error(`消さない ―― ${b.reason}（${rows[0]!.n} 件）`)
  }

  const before = await readRealCounts(db)
  await db.query('BEGIN')
  try {
    for (const [table, trigger] of APPEND_ONLY) {
      await db.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`)
    }

    const deleted: { table: string; rows: number }[] = []
    for (const t of TARGETS) {
      const { rows } = await db.query<{ id: unknown }>(
        `DELETE FROM ${t.table} WHERE ${t.where} RETURNING 1 AS id`)
      deleted.push({ table: t.table, rows: rows.length })
    }

    for (const [table, trigger] of APPEND_ONLY) {
      await db.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`)
    }

    const after = await readRealCounts(db)
    const moved = diffRealCounts(before, after)
    if (moved.length > 0) {
      await db.query('ROLLBACK')
      throw new Error(`実在の行が動いた ―― 捨てた: ${moved.join(' / ')}`)
    }

    await db.query('COMMIT')
    return { deleted, before, after }
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {})
    throw e
  }
}

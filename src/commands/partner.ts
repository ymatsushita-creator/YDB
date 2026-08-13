import { maybeOne, one, type Db } from '../db/client.ts'

/**
 * 団体の「NEO としてどう関わるか」（依頼者の指示。実行⑫）。
 *
 * 記録層は 0031。**現在値は `partners.engagement`、変更履歴は
 * `partner_engagement_revisions`** に積む（0022 と同じ形）。
 *
 * ★ 現在値を上書きするので、履歴を追記保存する（`CLAUDE.md`）。
 *   1回の保存で2つの事実が立つので、**まとめて1つの取引にする** ――
 *   途中で落ちると「現在値は変わったのに履歴に無い」が残り、
 *   そこから先は履歴が嘘になる。
 *
 * ★ 自由入力である（依頼者の判断）。**選択肢を持たないので集計できない。**
 *   語を受け取ったらマスタへ移す（D-14 / C-79 と同じ規律）。
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const blank = (v: string | null | undefined) => ((v ?? '').trim() || null)

/**
 * 関わり方の上限。**1行に収まる長さ**（0030 の `INVOLVEMENT_MAX` と同じ 60 文字）。
 * 経緯を書く場所は接触記録の「記録」欄である。
 */
export const ENGAGEMENT_MAX = 60

export type SetEngagementFailure =
  | 'partner_not_found'
  | 'staff_not_found'
  | 'engagement_too_long'

export type SetEngagementResult =
  | { ok: true; changed: boolean; revisionNumber: number | null }
  | { ok: false; reason: SetEngagementFailure }

export async function setPartnerEngagement(
  db: Db,
  input: {
    partnerId: string
    /** 空・空白だけなら「関わり方を消す」。消したことも版に残る。 */
    engagement: string
    /** 誰が変えたか。認証が無いので画面が選ぶ（C-85）。空なら記録しない。 */
    staffId?: string
  },
): Promise<SetEngagementResult> {
  if (!UUID.test(input.partnerId)) return { ok: false, reason: 'partner_not_found' }

  const engagement = blank(input.engagement)
  if (engagement !== null && engagement.length > ENGAGEMENT_MAX) {
    return { ok: false, reason: 'engagement_too_long' }
  }

  const staffId = blank(input.staffId)
  if (staffId !== null && !UUID.test(staffId)) return { ok: false, reason: 'staff_not_found' }

  // 参照先はコマンド側でも確かめる（FK は「存在するか」しか見ない）。
  const partner = await maybeOne<{ engagement: string | null }>(db,
    `SELECT engagement FROM partners WHERE id = $1`, [input.partnerId])
  if (partner === null) return { ok: false, reason: 'partner_not_found' }

  if (staffId !== null) {
    const staff = await maybeOne(db, `SELECT 1 FROM staffs WHERE id = $1`, [staffId])
    if (!staff) return { ok: false, reason: 'staff_not_found' }
  }

  // ★ 変わっていないなら履歴を増やさない。
  //   同じ値の版が並ぶと「いつ変わったか」が読み取れなくなる
  //   ―― 版を数えて「何度も見直した」と読む道も塞ぐ。
  if (partner.engagement === engagement) {
    return { ok: true, changed: false, revisionNumber: null }
  }

  try {
    await db.exec('BEGIN')

    await db.query(
      `UPDATE partners SET engagement = $2 WHERE id = $1`, [input.partnerId, engagement])

    // 版番号は既存の最大 + 1。一意制約（0031）が最後の砦である。
    const rev = await one<{ revision_number: number }>(db, `
      INSERT INTO partner_engagement_revisions
          (partner_id, revision_number, engagement, changed_by_staff_id)
      SELECT $1,
             coalesce(max(r.revision_number), 0) + 1,
             $2, $3
        FROM partner_engagement_revisions r
       WHERE r.partner_id = $1
      RETURNING revision_number`, [input.partnerId, engagement, staffId])

    await db.exec('COMMIT')
    return { ok: true, changed: true, revisionNumber: rev.revision_number }
  } catch (e: unknown) {
    await db.exec('ROLLBACK')
    throw e
  }
}

/** 画面に出す言葉。**ここ1箇所**に置く（画面ごとに言い換えない）。 */
export const SET_ENGAGEMENT_MESSAGE: Record<SetEngagementFailure | 'saved', string> = {
  saved: '関わり方を記録した。',
  partner_not_found: 'その団体が見つからない。',
  staff_not_found: '記録した人が見つからない。',
  engagement_too_long: `関わり方が長すぎる（${ENGAGEMENT_MAX} 文字まで）。`,
}


// -------------------------------------------------------------
// 接触記録の訂正（0032。実行⑫）
// -------------------------------------------------------------

const DAY = /^\d{4}-\d{2}-\d{2}$/

export type UpdateReachFailure =
  | 'reach_not_found'
  | 'bad_date'
  | 'bad_estimate'
  | 'staff_not_found'

export type UpdateReachResult =
  | { ok: true; changed: boolean; revisionNumber: number | null }
  | { ok: false; reason: UpdateReachFailure }

/**
 * 既にある接触記録を直す。
 *
 * ★ 期の帰属は**日付から決め直す。** 現在の帰属を引き継がない ――
 *   引き継ぐと、日付だけ直したときに「2月の接触が前の期に数えられたまま」
 *   になる。どの期の期間にも入らない日なら、どの期にも紐づけない（C-78）。
 *
 * ★ 推定リーチの空は **NULL のまま**にする。**0 にしない** ――
 *   0 は「届かなかった」という別の事実である。
 */
export async function updatePartnerReach(
  db: Db,
  input: {
    reachId: string
    occurredOn: string
    method: string
    /** 空なら「分からない」。0 と空は違う。 */
    estimatedReach: string
    note: string
    staffId?: string
  },
): Promise<UpdateReachResult> {
  if (!UUID.test(input.reachId)) return { ok: false, reason: 'reach_not_found' }

  const occurredOn = blank(input.occurredOn)
  if (!occurredOn || !DAY.test(occurredOn)) return { ok: false, reason: 'bad_date' }

  const rawEstimate = blank(input.estimatedReach)
  let estimated: number | null = null
  if (rawEstimate !== null) {
    const n = Number(rawEstimate)
    if (!Number.isInteger(n) || n < 0) return { ok: false, reason: 'bad_estimate' }
    estimated = n
  }

  const method = blank(input.method)
  const note = blank(input.note)

  const staffId = blank(input.staffId)
  if (staffId !== null && !UUID.test(staffId)) return { ok: false, reason: 'staff_not_found' }

  const before = await maybeOne<{
    partner_id: string
    occurred_on: string
    method: string | null
    estimated_reach: number | null
    note: string | null
  }>(db, `
    SELECT partner_id, to_char(occurred_on, 'YYYY-MM-DD') AS occurred_on,
           method, estimated_reach, note
      FROM partner_reaches WHERE id = $1`, [input.reachId])
  if (before === null) return { ok: false, reason: 'reach_not_found' }

  if (staffId !== null) {
    const staff = await maybeOne(db, `SELECT 1 FROM staffs WHERE id = $1`, [staffId])
    if (!staff) return { ok: false, reason: 'staff_not_found' }
  }

  // 変わっていないなら版を増やさない（0031 と同じ理由）。
  const same = before.occurred_on === occurredOn
    && before.method === method
    && before.estimated_reach === estimated
    && before.note === note
  if (same) return { ok: true, changed: false, revisionNumber: null }

  try {
    await db.exec('BEGIN')

    await db.query(`
      UPDATE partner_reaches
         SET occurred_on = $2::date,
             method = $3,
             estimated_reach = $4,
             note = $5,
             season_id = (SELECT s.id FROM seasons s
                           WHERE $2::date BETWEEN s.outreach_start_date AND s.selection_end_date
                           ORDER BY s.enrollment_year LIMIT 1)
       WHERE id = $1`, [input.reachId, occurredOn, method, estimated, note])

    const rev = await one<{ revision_number: number }>(db, `
      INSERT INTO partner_reach_revisions
          (reach_id, partner_id, revision_number, season_id, occurred_on,
           method, estimated_reach, note, changed_by_staff_id)
      SELECT $1, $2,
             coalesce((SELECT max(r.revision_number) FROM partner_reach_revisions r
                        WHERE r.reach_id = $1), 0) + 1,
             pr.season_id, pr.occurred_on, pr.method, pr.estimated_reach, pr.note, $3
        FROM partner_reaches pr
       WHERE pr.id = $1
      RETURNING revision_number`, [input.reachId, before.partner_id, staffId])

    await db.exec('COMMIT')
    return { ok: true, changed: true, revisionNumber: rev.revision_number }
  } catch (e: unknown) {
    await db.exec('ROLLBACK')
    throw e
  }
}

export const UPDATE_REACH_MESSAGE: Record<UpdateReachFailure | 'saved', string> = {
  saved: '接触の記録を直した。',
  reach_not_found: 'その接触の記録が見つからない。',
  bad_date: '接触した日は YYYY-MM-DD で入れる。',
  bad_estimate: '推定リーチは 0 以上の整数で入れる。分からなければ空のまま。',
  staff_not_found: '記録した人が見つからない。',
}


// -------------------------------------------------------------
// 推薦枠ステイタス（0035）
// -------------------------------------------------------------

export type SetRecommendationFailure =
  | 'partner_not_found' | 'season_not_found' | 'state_not_found' | 'staff_not_found'

export type SetRecommendationResult =
  | { ok: true; changed: boolean }
  | { ok: false; reason: SetRecommendationFailure }

/**
 * 団体 × 期の推薦枠ステイタスを置く（0035。依頼者の判断に委ねられた3つのうちの1つ）。
 *
 * ★ 形は `setPersonApproachState`（0016）と同じ ―― **追記専用の出来事**を積み、
 *   現在値はビューが最新から導く。同じ性質のものに別の形を与えない。
 *
 * ★ **期ごとに持つ。** 「2期生推薦枠ステイタス」は期の言葉であって、
 *   団体の現在値を1つ持つと 3期を入れた瞬間に 2期が消える。
 *
 * ★ 同じ状態をもう一度置いても**出来事を積まない。**
 *   積むと「その日に動きがあった」という意味が生まれる（0031 と同じ判断）。
 */
export async function setPartnerRecommendationState(
  db: Db,
  input: { partnerId: string; seasonId: string; stateId: string; staffId: string; note?: string },
): Promise<SetRecommendationResult> {
  if (!UUID.test(input.partnerId)) return { ok: false, reason: 'partner_not_found' }
  if (!UUID.test(input.seasonId)) return { ok: false, reason: 'season_not_found' }
  if (!UUID.test(input.stateId)) return { ok: false, reason: 'state_not_found' }
  if (!UUID.test(input.staffId)) return { ok: false, reason: 'staff_not_found' }

  // 参照先を1つずつ確かめる。**どれが無いのかを言えるようにする**
  // （まとめて EXISTS で見ると「見つからない」としか言えない）。
  const found = await maybeOne<{
    partner: boolean; season: boolean; state: boolean; staff: boolean
  }>(db, `
    SELECT EXISTS (SELECT 1 FROM partners WHERE id = $1)                       AS partner,
           EXISTS (SELECT 1 FROM seasons  WHERE id = $2)                       AS season,
           EXISTS (SELECT 1 FROM partner_recommendation_states
                    WHERE id = $3 AND is_active)                               AS state,
           EXISTS (SELECT 1 FROM staffs   WHERE id = $4 AND is_active)         AS staff`,
  [input.partnerId, input.seasonId, input.stateId, input.staffId])
  if (!found?.partner) return { ok: false, reason: 'partner_not_found' }
  if (!found.season) return { ok: false, reason: 'season_not_found' }
  if (!found.state) return { ok: false, reason: 'state_not_found' }
  if (!found.staff) return { ok: false, reason: 'staff_not_found' }

  const now = await maybeOne<{ state_id: string }>(db, `
    SELECT state_id FROM v_partner_recommendation_state
     WHERE partner_id = $1 AND season_id = $2`, [input.partnerId, input.seasonId])
  if (now?.state_id === input.stateId) return { ok: true, changed: false }

  await db.query(`
    INSERT INTO partner_recommendation_events
      (partner_id, season_id, state_id, occurred_at, recorded_by_staff_id, note)
    VALUES ($1, $2, $3, now(), $4, nullif(btrim($5, E' \t\n\r　'), ''))`,
  [input.partnerId, input.seasonId, input.stateId, input.staffId, input.note ?? null])

  return { ok: true, changed: true }
}

export const SET_RECOMMENDATION_MESSAGE: Record<SetRecommendationFailure, string> = {
  partner_not_found: 'その団体が見つからない。',
  season_not_found: 'その期が見つからない。',
  state_not_found: 'その推薦枠ステイタスは選べない。',
  staff_not_found: '入力者が選ばれていない。',
}

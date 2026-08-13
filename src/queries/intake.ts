import { all, maybeOne, type Db } from '../db/client.ts'

/**
 * 候補者追加・アプローチ追加・SNS分析の問い合わせ（実行⑩）。
 *
 * 集計の定義はビュー（0025）に置き、ここは呼んで並べるだけ。
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface Option { id: string; label: string }

/** 画面が選ばせるもの。**非活性は出さない**（選べないものを並べない）。 */
export const getIntakeOptions = async (db: Db) => {
  const [schools, channels, staffs, partners] = await Promise.all([
    all<Option>(db, `SELECT id, name AS label FROM schools WHERE is_active ORDER BY name`),
    all<Option & { category: string | null }>(db,
      `SELECT id, name AS label, category FROM channels WHERE is_active
        ORDER BY (category = 'sns') DESC, name`),
    all<Option>(db,
      `SELECT id, display_name AS label FROM staffs WHERE is_active ORDER BY display_name`),
    all<Option>(db, `SELECT id, name AS label FROM partners WHERE is_active ORDER BY name`),
  ])
  return { schools, channels, staffs, partners }
}

export interface UnmatchedResponse {
  form_response_id: string
  source: string
  submitted_at: Date
  respondent_name: string | null
  respondent_email: string | null
  respondent_line: string | null
  channel_name: string | null
  channel_answer: string | null
}

/**
 * まだ誰にも結び付いていないフォーム回答。
 *
 * ★ 候補者追加の画面に出す。**回答から人を作る**のが本来の順で、
 *   先に人を作ってから探すのは手間が増えるだけである。
 */
export const listUnmatchedResponses = (db: Db, limit = 50) =>
  all<UnmatchedResponse>(db, `
    SELECT r.id AS form_response_id, r.source, r.submitted_at,
           r.respondent_name, r.respondent_email, r.respondent_line,
           c.name AS channel_name, r.channel_answer
      FROM form_responses r
      LEFT JOIN channels c ON c.id = r.channel_id
     WHERE r.person_id IS NULL
     ORDER BY r.submitted_at DESC
     LIMIT $1`, [limit])

export const getFormResponse = (db: Db, id: string | undefined) => {
  if (!id || !UUID.test(id)) return Promise.resolve(null)
  return maybeOne<UnmatchedResponse & { person_id: string | null }>(db, `
    SELECT r.id AS form_response_id, r.source, r.submitted_at,
           r.respondent_name, r.respondent_email, r.respondent_line,
           c.name AS channel_name, r.channel_answer, r.person_id
      FROM form_responses r
      LEFT JOIN channels c ON c.id = r.channel_id
     WHERE r.id = $1`, [id])
}

export interface PersonFormResponse {
  form_response_id: string
  source: string
  submitted_at: Date
  channel_name: string | null
  channel_answer: string | null
  /** 回答の全体。届く形が決まっていないので丸ごと持ってある（0025）。 */
  raw: Record<string, unknown>
}

/**
 * その人に結び付いたフォーム回答（実行⑫。依頼者の指示）。
 *
 * 依頼者の指示は「面接タブから提出された書類を閲覧可能にする」で、
 * 書類の実体は**応募フォームの回答**（依頼者の回答）。記録層は 0025 のままで、
 * 足したものは無い。
 *
 * ★ **未接合の回答は出さない**（`person_id IS NULL`）。
 *   誰の回答か決まっていないものを人の画面に出すと、取り違えが起きる。
 *
 * ★ 回答そのものは書き換えられない（0025 のトリガ）。**読み取り専用である。**
 *
 * ★ 並びは送信の新しい順。同じ人が2回答えれば2件出る（畳まない）。
 */
export const listPersonFormResponses = (db: Db, personId: string | undefined) => {
  if (!personId || !UUID.test(personId)) return Promise.resolve([])
  return all<PersonFormResponse>(db, `
    SELECT r.id AS form_response_id, r.source, r.submitted_at,
           c.name AS channel_name, r.channel_answer, r.raw
      FROM form_responses r
      LEFT JOIN channels c ON c.id = r.channel_id
     WHERE r.person_id = $1
     ORDER BY r.submitted_at DESC, r.id`, [personId])
}

export interface ChannelCount {
  channel_name: string | null
  channel_category: string | null
  channel_answer: string | null
  responses: number
  matched: number
  persons: number
}

/**
 * SNS 別のフォーム回答（分析の土台）。
 *
 * ★ 母集団は**回答**であって人ではない。同じ人が2回答えれば2件になる。
 *   人数は別の列（`persons`）で出す。**同じ表の中で単位を混ぜない。**
 *
 * ★ チャネルへ写せなかった回答も落とさない。
 *   `channel_name` が NULL で `channel_answer` に生の文字列が入る。
 *   落とすと「フォームには来ているのに、どこにも数えられていない」が起きる。
 */
export const listChannelResponses = (db: Db, seasonId: string | undefined) =>
  all<ChannelCount>(db, `
    SELECT v.channel_name, v.channel_category,
           CASE WHEN v.channel_name IS NULL THEN v.channel_answer END AS channel_answer,
           count(*)::int                                   AS responses,
           count(*) FILTER (WHERE v.is_matched)::int       AS matched,
           count(DISTINCT v.person_id)::int                AS persons
      FROM v_form_response_channels v
     WHERE $1::uuid IS NULL OR v.season_id = $1
     GROUP BY v.channel_name, v.channel_category,
              CASE WHEN v.channel_name IS NULL THEN v.channel_answer END
     ORDER BY responses DESC, v.channel_name NULLS LAST`,
  [seasonId && UUID.test(seasonId) ? seasonId : null])

export interface CandidateNumberRow {
  number: number
  person_id: string
  person_name: string
  photo_data_url: string | null
  assigned_at: Date
}

/** その期に振った候補者番号。**欠番はそのまま**（詰めない）。 */
export const listCandidateNumbers = (db: Db, seasonId: string | undefined) => {
  if (!seasonId || !UUID.test(seasonId)) return Promise.resolve([])
  return all<CandidateNumberRow>(db, `
    SELECT n.number, n.person_id, n.assigned_at,
           p.family_name || ' ' || p.given_name AS person_name,
           p.photo_data_url
      FROM candidate_numbers n
      JOIN persons p ON p.id = n.person_id AND p.deleted_at IS NULL
     WHERE n.season_id = $1
     ORDER BY n.number DESC`, [seasonId])
}

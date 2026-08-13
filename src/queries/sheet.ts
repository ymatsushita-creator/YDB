import { all, type Db } from '../db/client.ts'

/**
 * 表（スプシ形式）が読む行（依頼者の指示。実行⑫）。
 *
 * ★ 1行＝1件である。**画面が出す母集団と、保存できる母集団を一致させる**
 *   （`CLAUDE.md`）。削除済み・個人情報削除済みの人は編集できないので出さない。
 *
 * ★ 表に出すのは**入力できる値**だけにする。導出値（成績・確度・順位・
 *   接触機会・識別人数）はここで返さない ―― 同じ表に混ぜると、
 *   直せないセルが直せるように見える。
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface CandidateSheetRow {
  person_id: string
  /** 期ごとの候補者番号。**表では直せない**（欠番を詰めない規則がある）。 */
  number: number | null
  family_name: string
  given_name: string
  family_name_kana: string | null
  given_name_kana: string | null
  birth_date: string | null
  school_id: string
  faculty: string | null
  email: string | null
  phone: string | null
  line_user_id: string | null
  note: string | null
  /**
   * 紹介者。**表には出さないが持ち回る。**
   * 更新は全列を書くので、持たずに保存すると**黙って紹介者が消える。**
   */
  referrer_person_id: string | null
  /** 顔写真は表から外した（行から開いて入れる）。有無だけ出す。 */
  has_photo: boolean
  /** いまのアプローチ状態。**変えた行だけ**新しい状態を積む。 */
  approach_state_id: string | null
  approach_label: string | null
  /**
   * 最初の接点（どこで知ったか）。**表では直せない。**
   * 接点は積む記録で、書き換えの置き場所を持たない
   * ―― 直せるようにすると「いつどこで知ったか」が黙って消える。
   */
  first_channel_name: string | null
  first_contacted_on: string | null
}

/**
 * その期の候補者を、表の1行として読む。
 *
 * ★★ 母集団は「**候補者番号がある人**」だけではない。★★
 *   最初そう書いたら、デモの2期で**既存行が1件も出なかった** ――
 *   候補者番号は実行⑩で足した仕組みで、それ以前に作られた記録は持っていない。
 *   本番の取り込み分（61人）は番号を持つので、本番だけ動いて見えるところだった。
 *   **その期のアプローチ状態が記録されている人**も母集団に入れる
 *   （特別選考・個人アプローチの一覧と同じ見方。`v_person_approach_state`）。
 *
 * ★ 削除済み・個人情報削除済みは出さない ―― 編集できないものを
 *   編集できる形で並べない（`CLAUDE.md`「操作可能な母集団と画面に出す母集団を
 *   一致させる」）。
 *
 * 並びは候補者番号の昇順。**番号を持たない人は後ろへ回す** ――
 * 番号順の表に混ぜて上に出すと、番号が飛んでいるように見える。
 */
export const listCandidateSheetRows = (db: Db, seasonId: string | undefined) => {
  if (!seasonId || !UUID.test(seasonId)) return Promise.resolve([])
  return all<CandidateSheetRow>(db, `
    WITH population AS (
      SELECT person_id FROM candidate_numbers WHERE season_id = $1
      UNION
      SELECT person_id FROM v_person_approach_state WHERE season_id = $1
    )
    SELECT p.id AS person_id, n.number,
           p.family_name, p.given_name, p.family_name_kana, p.given_name_kana,
           to_char(p.birth_date, 'YYYY-MM-DD')            AS birth_date,
           p.school_id, p.faculty, p.email, p.phone, p.line_user_id, p.note,
           p.referrer_person_id,
           (p.photo_data_url IS NOT NULL)                 AS has_photo,
           a.approach_state_id, a.approach_label,
           first_touch.channel_name                       AS first_channel_name,
           to_char(first_touch.occurred_on, 'YYYY-MM-DD') AS first_contacted_on
      FROM population pop
      JOIN persons p ON p.id = pop.person_id
                    AND p.deleted_at IS NULL AND p.anonymized_at IS NULL
      LEFT JOIN candidate_numbers n ON n.person_id = p.id AND n.season_id = $1
      LEFT JOIN v_person_approach_state a
             ON a.person_id = p.id AND a.season_id = $1
      LEFT JOIN LATERAL (
        SELECT c.name AS channel_name, jst_date(t.occurred_at) AS occurred_on
          FROM touchpoints t
          JOIN channels c ON c.id = t.channel_id
         WHERE t.person_id = p.id
         ORDER BY t.occurred_at, t.id
         LIMIT 1
      ) first_touch ON true
     -- 番号を持たない人は後ろ。同じ並びの中は氏名と ID で決める
     -- （並びが決まらないと、開くたびに行の位置が変わる）。
     ORDER BY n.number NULLS LAST, p.family_name, p.given_name, p.id`, [seasonId])
}

export interface PartnerSheetRow {
  partner_id: string
  name: string
  category: string | null
  contact_name: string | null
  contact_email: string | null
  /** 先方のどの部署か（0034）。 */
  contact_department: string | null
  /** NEO 側の受け持ち（0034）。 */
  internal_owner: string | null
  /** NEO としてどう関わるか（0031）。自由入力の1行。 */
  engagement: string | null
  /** その期の推薦枠ステイタス（0035）。**期ごと**なので団体の列ではない。 */
  recommendation_state_id: string | null
  has_photo: boolean
  /** 変更ログの件数。**版があること**だけを出す（中身は行を開いて見る）。 */
  engagement_revisions: number
}

/**
 * 団体を表の1行として読む。
 *
 * ★ 集計（推定リーチ・接触機会・識別人数）は**この表に出さない。**
 *   `getPartnerReach` が別に持っている ―― 入力列と導出列を混ぜない。
 *
 * ★ 推薦枠ステイタス（0035）は**期ごと**なので、どの期で読むかを渡す。
 *   渡さないと「団体の現在値」に見えてしまう ―― 期をまたげない読み方にしない。
 */
export const listPartnerSheetRows = (db: Db, seasonId?: string) =>
  all<PartnerSheetRow>(db, `
    SELECT p.id AS partner_id, p.name, p.category, p.contact_name, p.contact_email,
           p.contact_department, p.internal_owner, p.engagement,
           (p.photo_data_url IS NOT NULL) AS has_photo,
           (SELECT count(*)::int FROM partner_engagement_revisions r
             WHERE r.partner_id = p.id) AS engagement_revisions,
           rs.state_id AS recommendation_state_id
      FROM partners p
      LEFT JOIN v_partner_recommendation_state rs
             ON rs.partner_id = p.id AND rs.season_id = $1
     WHERE p.is_active
     ORDER BY p.name`, [seasonId ?? null])

export interface ReachSheetRow {
  reach_id: string
  partner_id: string
  occurred_on: string
  method: string | null
  /** 空は「分からない」。**0 は「届かなかった」**。埋めない。 */
  estimated_reach: number | null
  note: string | null
  /** どの期に数えられているか。**日付から決まる**ので表では直せない。 */
  season_label: string | null
  revisions: number
}

/** その団体の接触記録。新しい順（直近を上に）。 */
export const listReachSheetRows = (db: Db, partnerId: string | undefined) => {
  if (!partnerId || !UUID.test(partnerId)) return Promise.resolve([])
  return all<ReachSheetRow>(db, `
    SELECT r.id AS reach_id, r.partner_id,
           to_char(r.occurred_on, 'YYYY-MM-DD') AS occurred_on,
           r.method, r.estimated_reach, r.note,
           s.enrollment_year::text              AS season_label,
           (SELECT count(*)::int FROM partner_reach_revisions v
             WHERE v.reach_id = r.id)           AS revisions
      FROM partner_reaches r
      LEFT JOIN seasons s ON s.id = r.season_id
     WHERE r.partner_id = $1
     ORDER BY r.occurred_on DESC, r.id`, [partnerId])
}

import { maybeOne, one, type Db } from '../db/client.ts'

/**
 * 面接シートを保存する（依頼者の指示。実行⑩）。
 *
 * ★ **現在値と変更ログを同じ回で書く。**
 *   `interview_sheets` を上書きし、書いた後の全体像を
 *   `interview_sheet_revisions` へ1行積む（0018 と同じ形）。
 *   片方だけ書ける道を作らない ―― 作った瞬間、
 *   「上書きされたが履歴に無い」状態が生まれる。
 *
 * ★ 点はここで扱わない。6軸の点と根拠は `evaluation_scores` にあり、
 *   保存は `src/commands/score.ts` が受け持つ。**同じ値を2つの入口で書かない。**
 *
 * ★ 最終判定（合格・ボーダー・不合格）は**選考の判定ではない。**
 *   選考の通過・不合格は `decideStep`（`src/commands/decide.ts`）が書く。
 *   ここに入るのは面接官の所見で、「ボーダー」は選考の側に存在しない。
 *   混ぜると、誰がいつ決めたのかが辿れなくなる。
 */

export const RECOMMENDATIONS = ['pass', 'border', 'fail'] as const
export type Recommendation = (typeof RECOMMENDATIONS)[number]

export const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  pass: '合格',
  border: 'ボーダー',
  fail: '不合格',
}

/**
 * 記入欄の様式。**送るときの名前と、記録層の列名を対で持つ。**
 *
 * ★ 綴りが違う（camelCase と snake_case）ので、片方から機械的に導けない。
 *   導けると思って書いたら、**保存はできるのに開き直すと全部空**になった。
 *   画面もテストもここを見る ―― 様式の正典を1つにする。
 *
 * 順も文言も依頼者の様式のまま。こちらで言い換えない。
 */
export const INTERVIEW_FIELDS = [
  { name: 'firstImpression', column: 'first_impression', label: '第一印象・雰囲気', rows: 3 },
  { name: 'checkPointNotes', column: 'check_point_notes', label: '確認ポイントへの回答メモ', rows: 5 },
  { name: 'strengths', column: 'strengths', label: '良かった点・光ったポイント', rows: 4 },
  { name: 'concerns', column: 'concerns', label: '懸念が残る点・気になった点', rows: 4 },
  { name: 'ownChallenge', column: 'own_challenge', label: '自分の課題は何か', rows: 3 },
  { name: 'neoCareerLink', column: 'neo_career_link', label: 'NEOとキャリアの接続ポイント', rows: 3 },
  { name: 'neoUsagePlan', column: 'neo_usage_plan', label: 'NEO活用方針', rows: 3 },
  { name: 'overallComment', column: 'overall_comment', label: '総評コメント', rows: 4 },
] as const

export interface InterviewSheetInput {
  evaluationId: string
  /** 書いた人。認証が無いので画面が選ぶ。 */
  staffId: string
  /** `YYYY-MM-DD`。空文字は「まだ書いていない」。 */
  interviewedOn: string
  firstImpression: string
  checkPointNotes: string
  strengths: string
  concerns: string
  ownChallenge: string
  neoCareerLink: string
  neoUsagePlan: string
  overallComment: string
  /** 空文字は「まだ出していない」。 */
  recommendation: string
  recommendationNote: string
}

export type SaveInterviewFailure =
  /** その評価が見つからない（削除済みの候補者も含む）。 */
  | 'evaluation_not_found'
  /** 書いた人が選ばれていない。 */
  | 'staff_not_found'
  /** 面接日が日付の形をしていない。 */
  | 'bad_date'
  /** 知らない判定が来た。 */
  | 'bad_recommendation'
  /** 判定を出さずに判定補足だけ書こうとした。 */
  | 'note_without_recommendation'

export type SaveInterviewResult =
  | { ok: true; sheetId: string; revisionNumber: number }
  | { ok: false; reason: SaveInterviewFailure }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY = /^\d{4}-\d{2}-\d{2}$/

/** 空欄は「まだ書いていない」。空文字を記録に残さない。 */
const blank = (v: string) => (v ?? '').trim() || null

export async function saveInterviewSheet(
  db: Db, input: InterviewSheetInput,
): Promise<SaveInterviewResult> {
  if (!UUID.test(input.evaluationId)) return { ok: false, reason: 'evaluation_not_found' }
  if (!UUID.test(input.staffId)) return { ok: false, reason: 'staff_not_found' }

  const interviewedOn = blank(input.interviewedOn)
  if (interviewedOn !== null && !DAY.test(interviewedOn)) {
    return { ok: false, reason: 'bad_date' }
  }

  const recommendation = blank(input.recommendation)
  if (recommendation !== null
      && !(RECOMMENDATIONS as readonly string[]).includes(recommendation)) {
    return { ok: false, reason: 'bad_recommendation' }
  }
  const recommendationNote = blank(input.recommendationNote)
  // 記録層にも同じ CHECK がある。ここで先に返すのは、
  // 画面に「何が足りないか」を名前で返すため（規則は記録層が最終判断）。
  if (recommendationNote !== null && recommendation === null) {
    return { ok: false, reason: 'note_without_recommendation' }
  }

  // 母集団は画面が出しているものと同じ ―― 個人情報削除を受けた候補者と
  // 削除済みの応募は、シートも書けない。
  const target = await maybeOne<{ evaluation_id: string }>(db, `
    SELECT e.id AS evaluation_id
      FROM evaluations e
      JOIN applications a ON a.id = e.application_id AND a.deleted_at IS NULL
      JOIN persons p ON p.id = a.person_id AND p.deleted_at IS NULL
     WHERE e.id = $1`, [input.evaluationId])
  if (!target) return { ok: false, reason: 'evaluation_not_found' }

  const staff = await maybeOne(db, `SELECT 1 FROM staffs WHERE id = $1`, [input.staffId])
  if (!staff) return { ok: false, reason: 'staff_not_found' }

  const values = [
    input.evaluationId,
    interviewedOn,
    blank(input.firstImpression),
    blank(input.checkPointNotes),
    blank(input.strengths),
    blank(input.concerns),
    blank(input.ownChallenge),
    blank(input.neoCareerLink),
    blank(input.neoUsagePlan),
    blank(input.overallComment),
    recommendation,
    recommendationNote,
  ]

  // 現在値。1つの評価に1枚なので、2度目からは上書きになる。
  const sheet = await one<{ id: string }>(db, `
    INSERT INTO interview_sheets (
      evaluation_id, interviewed_on, first_impression, check_point_notes,
      strengths, concerns, own_challenge, neo_career_link, neo_usage_plan,
      overall_comment, recommendation, recommendation_note)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT (evaluation_id) DO UPDATE SET
      interviewed_on = EXCLUDED.interviewed_on,
      first_impression = EXCLUDED.first_impression,
      check_point_notes = EXCLUDED.check_point_notes,
      strengths = EXCLUDED.strengths,
      concerns = EXCLUDED.concerns,
      own_challenge = EXCLUDED.own_challenge,
      neo_career_link = EXCLUDED.neo_career_link,
      neo_usage_plan = EXCLUDED.neo_usage_plan,
      overall_comment = EXCLUDED.overall_comment,
      recommendation = EXCLUDED.recommendation,
      recommendation_note = EXCLUDED.recommendation_note,
      updated_at = now()
    RETURNING id`, values)

  // 変更ログ。**書いた後の全体像**を積む（差分ではない）。
  // 差分にすると、読むときに全部を頭の中で再生しないと当時の姿が分からない。
  const revision = await one<{ revision_number: number }>(db, `
    INSERT INTO interview_sheet_revisions (
      sheet_id, evaluation_id, revision_number,
      interviewed_on, first_impression, check_point_notes,
      strengths, concerns, own_challenge, neo_career_link, neo_usage_plan,
      overall_comment, recommendation, recommendation_note, changed_by_staff_id)
    SELECT $1, $2,
           coalesce(max(r.revision_number), 0) + 1,
           $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
      FROM interview_sheet_revisions r
     WHERE r.sheet_id = $1
    RETURNING revision_number`,
  // $1 シート / $2 評価 / $3..$13 記入欄と判定 / $14 書いた人。
  // `values[0]` は評価IDなので、記入欄は 1 から渡す。
  [sheet.id, input.evaluationId, ...values.slice(1), input.staffId])

  return { ok: true, sheetId: sheet.id, revisionNumber: revision.revision_number }
}

export type SaveInterviewCode = 'saved' | SaveInterviewFailure

export const SAVE_INTERVIEW_MESSAGE: Record<SaveInterviewCode, string> = {
  saved: '面接シートを保存した。',
  evaluation_not_found: 'その面接は見つからなかった。画面を読み直す。',
  staff_not_found: '書いた人を選ぶ。',
  bad_date: '面接日は YYYY-MM-DD で入れる。',
  bad_recommendation: 'その判定は選べない。',
  note_without_recommendation: '判定補足だけは残せない。先に判定を選ぶ。',
}

const CODES = Object.keys(SAVE_INTERVIEW_MESSAGE) as SaveInterviewCode[]

export const parseSaveInterviewCode = (
  value: string | string[] | undefined,
): SaveInterviewCode | null => {
  const v = Array.isArray(value) ? value[0] : value
  return v && CODES.includes(v as SaveInterviewCode) ? (v as SaveInterviewCode) : null
}

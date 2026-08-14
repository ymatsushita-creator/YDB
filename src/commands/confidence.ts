import { maybeOne, all, type Db } from '../db/client.ts'

/**
 * 確度（S/A/B/C）を記入する（依頼者の指示。実行⑯。C-151）。
 *
 * 記録層は 0039。**追記専用**なので、この関数は既存の行を書き換えない。
 * 「いつでも編集できる」は**打ち消し行＋新しい記入**で満たす ――
 * 上書きすると、いつ誰が見立てを変えたのかが残らない。
 *
 * ★ 記入者は**手入力の自己申告**（0027 と同じ）。名簿と照合しない。
 * ★ 必須・形式・長さはここで再検証する（CLAUDE.md）。
 */

export type SetConfidenceResult =
  | { ok: true; eventId: string; previousEventId: string | null }
  | { ok: false; reason: SetConfidenceFailure }

export type SetConfidenceFailure =
  /** 候補者が見つからない。 */
  | 'person_not_found'
  /** 削除済み・個人情報削除済みの候補者。新しい記録を足さない。 */
  | 'person_deleted'
  /** 期が見つからない。 */
  | 'season_not_found'
  /** 段階が未選択、または定義に無い段階。 */
  | 'grade_not_found'
  /** 記入者が空、または空白だけ。 */
  | 'recorded_by_required'
  /** 記入者が長すぎる。 */
  | 'recorded_by_too_long'
  /** 補足が長すぎる。**任意なので「空」は失敗ではない。** */
  | 'note_too_long'

export const RECORDED_BY_MAX = 60
export const NOTE_MAX = 2000

/**
 * 新しい記入を、**同じ人・同じ期の直前の記入より必ず後ろに置く。**
 *
 * ★ C-132 で測った穴と同じ ―― 時計が刻めないほど速く2件入ると
 *   `occurred_at` も `created_at` も同着し、現在の確度が **id（乱数）で決まる。**
 *   書き直したのに前の段階が現在値として出る、が起きる（実際に落ちた）。
 *
 * ★ `greatest` は NULL を無視するので、1件目は `now()` になる。
 *   ずらす幅は1マイクロ秒 ―― 「いつ記入したか」を歪めない最小の幅である。
 */
const AFTER_LAST = `greatest(now(),
    (SELECT max(occurred_at) + interval '1 microsecond'
       FROM person_confidence_events
      WHERE person_id = $1 AND season_id = $2))`

export interface ConfidenceGrade {
  id: string
  code: string
  definition: string
}

/** 記入できる段階。**画面はこれだけを出す**（母集団と選択肢を一致させる）。 */
export const listConfidenceGrades = (db: Db): Promise<ConfidenceGrade[]> =>
  all<ConfidenceGrade>(db, `
    SELECT id, code, definition FROM confidence_grades
     WHERE is_active ORDER BY sort_order`)

export async function setConfidence(
  db: Db,
  input: {
    personId: string
    seasonId: string
    gradeCode: string
    recordedBy: string
    note?: string | null
  },
): Promise<SetConfidenceResult> {
  const recordedBy = (input.recordedBy ?? '').trim()
  if (!recordedBy) return { ok: false, reason: 'recorded_by_required' }
  if (recordedBy.length > RECORDED_BY_MAX) {
    return { ok: false, reason: 'recorded_by_too_long' }
  }
  const note = (input.note ?? '').trim() || null
  if (note && note.length > NOTE_MAX) return { ok: false, reason: 'note_too_long' }

  const person = await maybeOne<{ deleted_at: Date | null }>(db,
    `SELECT deleted_at FROM persons WHERE id = $1`, [input.personId])
  if (!person) return { ok: false, reason: 'person_not_found' }
  if (person.deleted_at !== null) return { ok: false, reason: 'person_deleted' }

  const season = await maybeOne<{ id: string }>(db,
    `SELECT id FROM seasons WHERE id = $1`, [input.seasonId])
  if (!season) return { ok: false, reason: 'season_not_found' }

  const grade = await maybeOne<{ id: string }>(db,
    `SELECT id FROM confidence_grades WHERE code = $1 AND is_active`, [input.gradeCode])
  if (!grade) return { ok: false, reason: 'grade_not_found' }

  // いま有効な記入。あれば**打ち消してから**新しい記入を足す。
  // 打ち消さずに積むと、v_person_confidence は最新を返すので画面は正しく
  // 見えるが、**取り消した見立てと現在の見立てが同じ重さで残る。**
  const current = await maybeOne<{ id: string; grade_id: string; occurred_at: Date }>(db, `
    SELECT e.id, e.grade_id, e.occurred_at
      FROM v_effective_person_confidence_events e
     WHERE e.person_id = $1 AND e.season_id = $2
     ORDER BY e.occurred_at DESC, e.created_at DESC, e.id DESC
     LIMIT 1`, [input.personId, input.seasonId])

  // ★ 訂正行は**新しい段階を載せて元に取って代わる**（0035 の correctX と同じ形）。
  //   打ち消しと新規を2行に分けると、有効な行が2つ並び、
  //   「取り消した見立て」と「いまの見立て」が同じ重さで残る。
  const inserted = current
    ? await maybeOne<{ id: string }>(db, `
        INSERT INTO person_confidence_events
          (person_id, season_id, grade_id, occurred_at, recorded_by,
           is_correction, corrects_event_id, note)
        VALUES ($1, $2, $3, ${AFTER_LAST}, $4, true, $5, $6) RETURNING id`,
    [input.personId, input.seasonId, grade.id, recordedBy, current.id, note])
    : await maybeOne<{ id: string }>(db, `
        INSERT INTO person_confidence_events
          (person_id, season_id, grade_id, occurred_at, recorded_by, note)
        VALUES ($1, $2, $3, ${AFTER_LAST}, $4, $5) RETURNING id`,
    [input.personId, input.seasonId, grade.id, recordedBy, note])

  return { ok: true, eventId: inserted!.id, previousEventId: current?.id ?? null }
}

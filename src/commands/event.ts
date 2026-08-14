import { maybeOne, all, type Db } from '../db/client.ts'

/**
 * イベントを1件足す（依頼者の指示。実行⑯。C-155）。
 *
 * 置き場所は予定（0019）。種別は 0040 で足した `event`。
 *
 * ★ 列はエクセル `4月イベント一覧` の見出しから決めた ――
 *   **参加有無 / イベント名 / 日程 / 時間 / 場所 / 対応者 / URL（あれば） / 備考**
 *
 *   このうち予定の表が列として持つのは、名前・日時・対応者だけである。
 *   **場所と URL のために列を作らない**（0035 と同じ判断）――
 *   同じ性質の値が予定の表と別表に散る。記録（`note`）へ**見出しごと**残す。
 *   運営の語を翻訳せず、あとから読める形にする。
 *
 *   「参加有無」は**この画面では扱わない。** 参加は接点（0028）であって
 *   イベントの属性ではない ―― カレンダーから参加者を記録する道が既にある。
 *
 * ★ 終わりの時刻は**作らない。** 表に無ければ受け取らない ――
 *   `ends_at` は NOT NULL なので、無ければ入れずに理由を返す。
 *   「2時間くらいだろう」で埋めると、それは記録ではなく推測になる。
 */

export type AddEventResult =
  | { ok: true; appointmentId: string }
  | { ok: false; reason: AddEventFailure }

export type AddEventFailure =
  | 'title_required'
  | 'title_too_long'
  | 'season_not_found'
  | 'date_required'
  | 'date_invalid'
  | 'start_required'
  | 'end_required'
  | 'time_invalid'
  | 'range_invalid'
  | 'owner_required'
  | 'owner_not_found'
  | 'kind_missing'
  | 'note_too_long'

export const TITLE_MAX = 200
export const NOTE_MAX = 2000
export const PLACE_MAX = 200
export const URL_MAX = 500

export const ADD_EVENT_MESSAGE: Record<AddEventFailure, string> = {
  title_required: 'イベント名を入れる。',
  title_too_long: `イベント名が長すぎる（${TITLE_MAX}文字まで）。`,
  season_not_found: '年度が見つからない。',
  date_required: '日付を入れる。',
  date_invalid: '日付が読めない（YYYY-MM-DD）。',
  start_required: '開始時刻を入れる。',
  end_required: '終了時刻を入れる。**分からない時刻をこちらで作らない。**',
  time_invalid: '時刻が読めない（HH:MM）。',
  range_invalid: '終わりが始まりより前になっている。',
  owner_required: '対応者を選ぶ。',
  owner_not_found: 'その対応者が見つからない。',
  kind_missing: 'イベントの種別が未登録（0040 が未適用）。',
  note_too_long: `備考が長すぎる（${NOTE_MAX}文字まで）。`,
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

/** JST の1点として組み立てる。**サーバの時間帯で読まない**（置き場所は UTC）。 */
const jstAt = (day: string, time: string) => `${day}T${time}:00+09:00`

export interface EventInput {
  seasonId: string
  title: string
  /** YYYY-MM-DD。 */
  day: string
  /** HH:MM。 */
  startsAt: string
  /** HH:MM。**表に無ければ入れない。** */
  endsAt: string
  ownerStaffId: string
  place?: string | null
  url?: string | null
  note?: string | null
}

/**
 * 記録に残す本文を組み立てる。
 *
 * ★ **見出しを付けたまま残す。** 「福岡市役所 https://… 備考」と
 *   繋げてしまうと、あとからどれが場所でどれが URL か読めない。
 */
export const composeNote = (input: EventInput): string | null => {
  const lines: string[] = []
  const place = (input.place ?? '').trim()
  const url = (input.url ?? '').trim()
  const note = (input.note ?? '').trim()
  if (place) lines.push(`場所: ${place}`)
  if (url) lines.push(`URL: ${url}`)
  if (note) lines.push(`備考: ${note}`)
  return lines.length > 0 ? lines.join('\n') : null
}

export interface EventKindOption { id: string; label: string }

/** イベントの種別（0040）。**無ければ null** ―― 画面はそれを見て言葉を出す。 */
export const getEventKind = (db: Db): Promise<EventKindOption | null> =>
  maybeOne<EventKindOption>(db,
    `SELECT id, label FROM appointment_kinds WHERE code = 'event' AND is_active`)

/** 対応者に選べる職員。 */
export const listEventOwners = (db: Db): Promise<EventKindOption[]> =>
  all<EventKindOption>(db, `
    SELECT id, display_name AS label FROM staffs
     WHERE is_active ORDER BY display_name`)

export async function addEvent(db: Db, input: EventInput): Promise<AddEventResult> {
  const title = (input.title ?? '').trim()
  if (!title) return { ok: false, reason: 'title_required' }
  if (title.length > TITLE_MAX) return { ok: false, reason: 'title_too_long' }

  const day = (input.day ?? '').trim()
  if (!day) return { ok: false, reason: 'date_required' }
  if (!DAY.test(day)) return { ok: false, reason: 'date_invalid' }

  const start = (input.startsAt ?? '').trim()
  const end = (input.endsAt ?? '').trim()
  if (!start) return { ok: false, reason: 'start_required' }
  if (!end) return { ok: false, reason: 'end_required' }
  if (!TIME.test(start) || !TIME.test(end)) return { ok: false, reason: 'time_invalid' }
  if (end <= start) return { ok: false, reason: 'range_invalid' }

  const note = composeNote({ ...input, title, day, startsAt: start, endsAt: end })
  if (note && note.length > NOTE_MAX) return { ok: false, reason: 'note_too_long' }

  const season = await maybeOne<{ id: string }>(db,
    `SELECT id FROM seasons WHERE id = $1`, [input.seasonId])
  if (!season) return { ok: false, reason: 'season_not_found' }

  const ownerId = (input.ownerStaffId ?? '').trim()
  if (!ownerId) return { ok: false, reason: 'owner_required' }
  const owner = await maybeOne<{ id: string }>(db,
    `SELECT id FROM staffs WHERE id = $1 AND is_active`, [ownerId])
  if (!owner) return { ok: false, reason: 'owner_not_found' }

  const kind = await getEventKind(db)
  if (!kind) return { ok: false, reason: 'kind_missing' }

  const inserted = await maybeOne<{ id: string }>(db, `
    INSERT INTO appointments
      (season_id, kind_id, title, starts_at, ends_at, owner_staff_id, note)
    VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7)
    RETURNING id`,
  [season.id, kind.id, title, jstAt(day, start), jstAt(day, end), owner.id, note])

  return { ok: true, appointmentId: inserted!.id }
}

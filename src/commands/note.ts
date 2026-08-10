import { maybeOne, type Db } from '../db/client.ts'

/**
 * 候補者メモを1件足す（依頼者の指示。実行⑪）。
 *
 * 記録層は 0027（`person_notes`）。**追記専用**なので、この関数は
 * 既存の行を書き換えない。訂正は打ち消し行を足す（原則5）。
 *
 * ★ 「記入必須」を制約だけに任せない。
 *   DB の CHECK は空白だけの文字列を弾くが、**長さは見ていない。**
 *   必須値・形式・サイズはコマンド側で再検証する（CLAUDE.md）。
 *
 * ★ 書いた人は**手入力の自己申告**である（0027 の理由参照）。
 *   ここで `staffs` を引き当てて「本当に居る人か」を確かめない ――
 *   名簿に無い人も書くし、確かめたところで**本人である証拠にはならない。**
 */

export type AddNoteResult =
  | { ok: true; noteId: string }
  | { ok: false; reason: AddNoteFailure }

export type AddNoteFailure =
  /** 候補者が見つからない。 */
  | 'person_not_found'
  /** 削除済み・個人情報削除済みの候補者。新しい記録を足さない。 */
  | 'person_deleted'
  /** 書いた人が空、または空白だけ。 */
  | 'author_required'
  /** 書いた人が長すぎる。 */
  | 'author_too_long'
  /** 日時が空。 */
  | 'noted_at_required'
  /** 日時の形式が読めない。 */
  | 'noted_at_invalid'
  /** 日時が未来すぎる。打ち間違いを黙って受け取らない。 */
  | 'noted_at_future'
  /** 内容が空、または空白だけ。 */
  | 'body_required'
  /** 内容が長すぎる。 */
  | 'body_too_long'

export const AUTHOR_MAX = 60
export const BODY_MAX = 2000

/**
 * 日時の受け取り方。
 *
 * 画面の `datetime-local` は `2026-08-10T14:30` を寄越す ―― **時間帯が無い。**
 * サーバの時間帯で読むと、置き場所（Vercel は UTC）で9時間ずれる。
 * この製品の暦は JST 固定（`jst_date()` / `jst_today()`）なので、
 * **ここで JST として読む。** 画面や環境変数に解釈を委ねない。
 */
const LOCAL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/

export const parseJstDateTime = (input: string): Date | null => {
  const m = LOCAL_DATETIME.exec(input.trim())
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s ?? '00'}+09:00`
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  // `2026-02-31T00:00` は Date が3月へ繰り上げて受け取ってしまう。
  // **暦に無い日を黙って別の日にしない。** 往復させて確かめる。
  const back = new Date(at.getTime() + 9 * 3600_000).toISOString()
  if (back.slice(0, 16) !== `${y}-${mo}-${d}T${h}:${mi}`) return null
  return at
}

/** 未来を許す幅。時計のずれと「今日の予定を先に書く」は通す。 */
const FUTURE_TOLERANCE_MS = 24 * 3600_000

export async function addPersonNote(
  db: Db,
  input: {
    personId: string
    authorName: string
    notedAt: string
    body: string
    /** 打ち消し行として足す場合の、打ち消す相手。 */
    correctsNoteId?: string | null
  },
  nowMs: number = Date.now(),
): Promise<AddNoteResult> {
  const author = input.authorName.trim()
  const body = input.body.trim()

  if (author === '') return { ok: false, reason: 'author_required' }
  if (author.length > AUTHOR_MAX) return { ok: false, reason: 'author_too_long' }
  if (body === '') return { ok: false, reason: 'body_required' }
  if (body.length > BODY_MAX) return { ok: false, reason: 'body_too_long' }

  if (input.notedAt.trim() === '') return { ok: false, reason: 'noted_at_required' }
  const notedAt = parseJstDateTime(input.notedAt)
  if (notedAt === null) return { ok: false, reason: 'noted_at_invalid' }
  if (notedAt.getTime() > nowMs + FUTURE_TOLERANCE_MS) {
    return { ok: false, reason: 'noted_at_future' }
  }

  // 参照先はコマンド側でも確かめる（FK は「存在するか」しか見ない）。
  const person = await maybeOne<{ deleted: boolean }>(db, `
    SELECT (p.deleted_at IS NOT NULL OR p.anonymized_at IS NOT NULL) AS deleted
      FROM persons p WHERE p.id = $1`, [input.personId])
  if (person === null) return { ok: false, reason: 'person_not_found' }
  // 削除済み・個人情報削除済みの人に新しい記録を足さない（CLAUDE.md）。
  if (person.deleted) return { ok: false, reason: 'person_deleted' }

  const corrects = input.correctsNoteId ?? null
  const row = await maybeOne<{ id: string }>(db, `
    INSERT INTO person_notes
        (person_id, author_name, noted_at, body, is_correction, corrects_note_id)
    VALUES ($1, $2, $3, $4, $5::uuid IS NOT NULL, $5::uuid)
    RETURNING id`,
  [input.personId, author, notedAt.toISOString(), body, corrects])

  return { ok: true, noteId: row!.id }
}

/** 画面に出す言葉。**ここ1箇所**に置く（画面ごとに言い換えない）。 */
export const ADD_NOTE_MESSAGE: Record<AddNoteFailure | 'saved', string> = {
  saved: 'メモを追加した。',
  person_not_found: 'その候補者が見つからない。',
  person_deleted: '削除済みの候補者にはメモを足せない。',
  author_required: '書いた人が空。',
  author_too_long: `書いた人が長すぎる（${AUTHOR_MAX} 文字まで）。`,
  noted_at_required: '日時が空。',
  noted_at_invalid: '日時が読めない。',
  noted_at_future: '日時が未来になっている。',
  body_required: '内容が空。',
  body_too_long: `内容が長すぎる（${BODY_MAX} 文字まで）。`,
}

const CODES = new Set<string>([...Object.keys(ADD_NOTE_MESSAGE)])

/** URL に載って戻ってくる結果コード。知らない値は「何も起きていない」。 */
export const parseAddNoteCode = (
  v: string | string[] | undefined,
): AddNoteFailure | 'saved' | null => {
  const one = Array.isArray(v) ? v[0] : v
  return one && CODES.has(one) ? one as AddNoteFailure | 'saved' : null
}

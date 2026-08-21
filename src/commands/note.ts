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
  /** 関わり方が長すぎる。**任意なので「空」は失敗ではない。** */
  | 'involvement_too_long'

export const AUTHOR_MAX = 60
export const BODY_MAX = 2000
/**
 * 関わり方の上限（0030。実行⑫）。
 *
 * 依頼者の指示は「自由入力の1行」。**1行に収まる長さ**を上限にした ――
 * 書いた人（`AUTHOR_MAX`）と同じ 60 文字。これは決めた値なので記録に残す
 * （`db/DECISIONS.md`）。本文を書く欄は別にある（`BODY_MAX`）ので、
 * ここが長くなるのは「関わり方の欄に経緯を書いている」ときである。
 */
export const INVOLVEMENT_MAX = 60

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
    /**
     * どう関わったか（自由入力の1行・任意。0030。実行⑫）。
     *
     * ★ 空白だけは **NULL に倒す。** 拒否しない ――
     *   任意の列なので「書いていない」と読むほうが実際に近い。
     *   記録層の CHECK は、コマンドを通らない書き込みへの最後の砦である。
     */
    involvement?: string | null
    /** 打ち消し行として足す場合の、打ち消す相手。 */
    correctsNoteId?: string | null
  },
  nowMs: number = Date.now(),
): Promise<AddNoteResult> {
  const author = input.authorName.trim()
  const body = input.body.trim()
  // JS の trim は全角スペース（U+3000）も落とす。0015 の btrim と同じ範囲。
  const involvement = (input.involvement ?? '').trim() || null

  if (author === '') return { ok: false, reason: 'author_required' }
  if (author.length > AUTHOR_MAX) return { ok: false, reason: 'author_too_long' }
  if (body === '') return { ok: false, reason: 'body_required' }
  if (body.length > BODY_MAX) return { ok: false, reason: 'body_too_long' }
  if (involvement !== null && involvement.length > INVOLVEMENT_MAX) {
    return { ok: false, reason: 'involvement_too_long' }
  }

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
        (person_id, author_name, noted_at, body, is_correction, corrects_note_id,
         involvement)
    VALUES ($1, $2, $3, $4, $5::uuid IS NOT NULL, $5::uuid, $6)
    RETURNING id`,
  [input.personId, author, notedAt.toISOString(), body, corrects, involvement])

  return { ok: true, noteId: row!.id }
}

// -------------------------------------------------------------
// メモの取り消し（実行⑮。C-131）
// -------------------------------------------------------------

export type UndoNoteFailure =
  | AddNoteFailure
  /** そのメモが無い。 */
  | 'note_not_found'
  /** すでに取り消されている（打ち消し行は1つまで）。 */
  | 'already_undone'

export type UndoNoteResult =
  | { ok: true; noteId: string }
  | { ok: false; reason: UndoNoteFailure }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** いまを JST の `YYYY-MM-DDTHH:mm` にする（`addPersonNote` が読む形）。 */
const jstNow = (ms: number): string =>
  new Date(ms + 9 * 3600_000).toISOString().slice(0, 16)

/**
 * メモを取り消す（実行⑮。C-131）。
 *
 * ★ **消さない。** 打ち消し行を1行足す。元の行は記録層に残り、
 *   有効なメモ（`v_effective_person_notes`）から落ちるだけである。
 *
 * ★ 打ち消し行の本文は**取り消した理由**である。0027 の判定では
 *   打ち消し行が元に取って代わるので、一覧には「なぜ取り消したか」が残る
 *   ―― 行がまるごと消えて、あとから見た人が**そこに何かあったことすら
 *   分からない**状態にしない。
 *
 * ★ 書いた人と理由は**記入必須**（元のメモと同じ規則。`addPersonNote` が見る）。
 *   取り消しは記録を裏返す操作なので、名乗りと理由が要る。
 *
 * ★ 相手の人は**打ち消す行から引く。** 画面から渡された人を信じない ――
 *   取り違えると別の人のメモを消すことになる（記録層も 0036 で拒む）。
 *
 * ★ 取り消しを取り消せば元が戻る（会計の逆仕訳）。画面はそれを
 *   「取り消しの取り消し」として区別しない ―― どの有効な行も取り消せる。
 */
export async function undoPersonNote(
  db: Db,
  input: { noteId: string; authorName: string; reason: string },
  nowMs: number = Date.now(),
): Promise<UndoNoteResult> {
  if (!UUID.test(input.noteId)) return { ok: false, reason: 'note_not_found' }

  const target = await maybeOne<{ person_id: string; undone: boolean }>(db, `
    SELECT n.person_id,
           EXISTS (SELECT 1 FROM person_notes c WHERE c.corrects_note_id = n.id) AS undone
      FROM person_notes n WHERE n.id = $1`, [input.noteId])
  if (target === null) return { ok: false, reason: 'note_not_found' }
  // 一意索引（`person_notes_corrects_key`）に当てて例外で気づくのではなく、
  // **先に読んで理由で返す。** 画面に出せるのは理由のほうである。
  if (target.undone) return { ok: false, reason: 'already_undone' }

  return await addPersonNote(db, {
    personId: target.person_id,
    authorName: input.authorName,
    // 取り消しの出来事は**いま**である。手入力させない ――
    // 元のメモの日時を写すと、取り消した時点が記録から消える。
    notedAt: jstNow(nowMs),
    body: input.reason,
    correctsNoteId: input.noteId,
  }, nowMs)
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
  involvement_too_long: `関わり方が長すぎる（${INVOLVEMENT_MAX} 文字まで）。`,
}

/**
 * 取り消しの結果まで含めた言葉。**画面はこちらを読む。**
 *
 * ★ 足すのは取り消し固有の3語だけ。中身の検証は同じコマンドを通るので、
 *   同じ失敗には同じ言葉が出る（画面ごとに言い換えない）。
 */
export const NOTE_MESSAGE:
Record<AddNoteFailure | UndoNoteFailure | 'saved' | 'undone', string> = {
  ...ADD_NOTE_MESSAGE,
  undone: 'メモを取り消した。',
  note_not_found: 'そのメモが見つからない。',
  already_undone: 'そのメモはすでに取り消されている。',
}

export type NoteCode = keyof typeof NOTE_MESSAGE

const CODES = new Set<string>([...Object.keys(NOTE_MESSAGE)])

/** URL に載って戻ってくる結果コード。知らない値は「何も起きていない」。 */
export const parseAddNoteCode = (
  v: string | string[] | undefined,
): NoteCode | null => {
  const one = Array.isArray(v) ? v[0] : v
  return one && CODES.has(one) ? one as NoteCode : null
}

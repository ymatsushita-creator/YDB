'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getDb } from '../../src/db/server.ts'
import { saveScore, type SaveScoreCode } from '../../src/commands/score.ts'
import { submitEvaluation, type DecideCode } from '../../src/commands/decide.ts'
import {
  addPersonNote, undoPersonNote, type AddNoteFailure, type NoteCode,
} from '../../src/commands/note.ts'
import {
  setEventAttendance, type SetAttendanceFailure,
} from '../../src/commands/attend.ts'

/**
 * ボーダーラインの選考タブで採点する（実行⑩。依頼者の指示）。
 *
 * 判定は `src/commands/score.ts` と `src/commands/decide.ts` にある。
 * ここは受け渡しと、**戻り先を組み立てること**だけをする。
 * 応募の画面（`app/applications/[id]/actions.ts`）と同じコマンドを呼ぶので、
 * どちらから入れても同じ規則が効く ―― 画面ごとに条件を書き足さない。
 *
 * ★ 戻り先に見ていた場所を積み直す。
 *   ボーダーラインは期・タブ・選んでいる人・週・ページを URL に持っている。
 *   保存のあと一覧の先頭へ戻すと、**採点した相手が画面から消える。**
 *
 * ★ URL に載せるのは ID と結果コードだけ。氏名も軸の名前も載せない
 *   （CLAUDE.md「個人情報やIDを結果メッセージとしてURLへ載せない」。
 *   ID そのものは既に選択状態として URL にある）。
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TAB = /^[a-z0-9]{1,16}$/
const DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * 見ていた場所を、確かめられる形だけ拾って組み直す。
 *
 * ★ 採点は2箇所から打てる ―― 一覧の右パネルと、個人の採点レイヤー。
 *   `layer` が立っていれば個人のレイヤーへ戻す。**打った場所へ戻す。**
 */
function backTo(form: FormData, result: Record<string, string>): string {
  const q = new URLSearchParams()
  const season = String(form.get('seasonId') ?? '')
  const tab = String(form.get('tab') ?? '')
  const person = String(form.get('personId') ?? '')
  const week = String(form.get('week') ?? '')
  const layer = String(form.get('layer') ?? '') === '1'

  if (UUID.test(season)) q.set('season', season)
  if (TAB.test(tab)) q.set('tab', tab)
  if (DAY.test(week)) q.set('week', week)
  for (const [k, v] of Object.entries(result)) q.set(k, v)

  if (layer && UUID.test(person)) return `/borderline/${person}?${q}`
  if (UUID.test(person)) q.set('person', person)
  return `/borderline?${q}`
}

/** 1軸ぶんの点と根拠を保存する。全軸まとめてではない（記録層の単位に合わせる）。 */
export async function scoreOnBorderlineAction(formData: FormData): Promise<void> {
  const evaluationId = String(formData.get('evaluationId') ?? '')
  const criteriaId = String(formData.get('criteriaId') ?? '')
  const rationale = String(formData.get('rationale') ?? '')
  // 数値の解釈だけここでやる。判定ではなく型の変換である。
  // 空欄や数字でない値は NaN になり、コマンド側が範囲外として弾く。
  const score = Number(formData.get('score'))

  const back = (code: SaveScoreCode) => redirect(backTo(formData, { score: code }))

  const db = await getDb()
  const result = await saveScore(db, { evaluationId, criteriaId, score, rationale })

  // `redirect` は例外を投げるが型には出ないので、明示的に返して絞り込む。
  if (!result.ok) return back(result.reason)

  // 同じ点が応募の画面にも出る。片方だけ古いままにしない。
  revalidatePath('/borderline')
  revalidatePath(`/applications/${String(formData.get('applicationId') ?? '')}`)
  back('saved')
}

/** 評価を確定する。全軸そろっているかは `submitEvaluation` が確かめる。 */
export async function submitOnBorderlineAction(formData: FormData): Promise<void> {
  const evaluationId = String(formData.get('evaluationId') ?? '')
  const back = (code: DecideCode) => redirect(backTo(formData, { decide: code }))

  const db = await getDb()
  const result = await submitEvaluation(db, { evaluationId })
  if (!result.ok) return back(result.reason)

  revalidatePath('/borderline')
  revalidatePath(`/applications/${String(formData.get('applicationId') ?? '')}`)
  back('submitted')
}

/**
 * メモを1件足す（実行⑪。依頼者の指示）。
 *
 * 判定は `src/commands/note.ts`。ここは受け渡しと戻り先だけ。
 *
 * ★ 戻り先は**メモのポップアップを開いたまま**にする。
 *   閉じて戻すと、足したメモが並んだところを見ずに一覧へ放り出される。
 *   失敗したときはなおさら ―― 打った文字が消えたうえに理由だけが残る。
 *
 * ★ URL に載せるのは ID と結果コードだけ。氏名も本文も載せない。
 */
export async function addNoteAction(formData: FormData): Promise<void> {
  const personId = String(formData.get('personId') ?? '')
  const authorName = String(formData.get('authorName') ?? '')
  const notedAt = String(formData.get('notedAt') ?? '')
  const body = String(formData.get('body') ?? '')
  // どう関わったか（0030。実行⑫）。任意なので空のまま来る。
  const involvement = String(formData.get('involvement') ?? '')

  const back = (code: AddNoteFailure | 'saved') => redirect(backTo(formData, {
    note: code,
    // ポップアップを開いたまま戻す。
    ...(UUID.test(personId) ? { memo: personId } : {}),
  }))

  const db = await getDb()
  const result = await addPersonNote(db, {
    personId, authorName, notedAt, body, involvement,
  })
  if (!result.ok) return back(result.reason)

  // 同じメモがその人の記録にも出る。片方だけ古いままにしない。
  revalidatePath('/borderline')
  revalidatePath(`/people/${personId}`)
  back('saved')
}

/**
 * メモを取り消す（実行⑮。C-131）。
 *
 * 判定は `src/commands/note.ts` の `undoPersonNote`。ここは受け渡しだけ。
 *
 * ★ 取り消す相手は**メモの ID だけ**を渡す。人はコマンドが記録から引く ――
 *   画面が渡した人を信じると、取り違えたときに**別の人のメモを消す。**
 *
 * ★ 戻り先は追加と同じ（ポップアップを開いたまま）。取り消した結果が
 *   並んだところを見せる ―― 消えたのか失敗したのかが分からないまま
 *   一覧へ放り出さない。
 */
export async function undoNoteAction(formData: FormData): Promise<void> {
  const personId = String(formData.get('personId') ?? '')
  const noteId = String(formData.get('noteId') ?? '')
  const authorName = String(formData.get('undoAuthorName') ?? '')
  const reason = String(formData.get('undoReason') ?? '')

  const back = (code: NoteCode) => redirect(backTo(formData, {
    note: code,
    ...(UUID.test(personId) ? { memo: personId } : {}),
  }))

  const db = await getDb()
  const result = await undoPersonNote(db, { noteId, authorName, reason })
  if (!result.ok) return back(result.reason)

  revalidatePath('/borderline')
  revalidatePath(`/people/${personId}`)
  back('undone')
}

/**
 * 予定の参加者を保存する（実行⑪。依頼者の指示）。
 *
 * 判定は `src/commands/attend.ts`。**チェックの集合をそのまま渡す。**
 * ここで「増えた分だけ送る」といった加工をすると、外したことが伝わらない。
 *
 * ★ 参加は接点として積まれ、確度（0017）の材料になる。
 */
export async function saveAttendanceAction(formData: FormData): Promise<void> {
  const appointmentId = String(formData.get('appointmentId') ?? '')
  const seasonId = String(formData.get('seasonId') ?? '')
  const personIds = formData.getAll('person').map(String)

  const back = (code: SetAttendanceFailure | 'saved') => redirect(backTo(formData, {
    attend: code,
    // ポップアップを開いたまま戻す。
    ...(UUID.test(appointmentId) ? { appt: appointmentId } : {}),
  }))

  const db = await getDb()
  const result = await setEventAttendance(db, { appointmentId, seasonId, personIds })
  if (!result.ok) return back(result.reason)

  // 接点が動いたので、最終接触日と確度の材料が変わる画面を作り直す。
  revalidatePath('/borderline')
  revalidatePath('/headhunting')
  back('saved')
}

import { maybeOne, type Db } from '../db/client.ts'

/**
 * 入力者（職員）を足す（依頼者の指示。実行⑫）。
 *
 * 依頼者の指示 ――「入力者の話ね」「表示名だけ」。
 *
 * ★ なぜ要るか ―― 表の「記録した人」は職員を選ばせるが、**職員を足す画面が
 *   どこにも無かった。** 本番に職員が1人も居らず、旧データの担当者名を
 *   取り込みで作ったのが唯一の経路だった（C-75）。
 *   選ぶものが増やせない選択肢は、いずれ必ず詰まる。
 *
 * ★ メールは受け取らない（依頼者の判断。0024 で NULL 可にしてある）。
 *   したがって**同姓同名の職員を見分ける手段は無い。**
 *   それでも名前の重複を拒まない ―― 実在の同姓同名を登録できなくなるし、
 *   拒んだところで「同じ人か別人か」はこちらには分からない。
 *   画面に既存の入力者を並べて、打つ人が気付けるようにする。
 *
 * ★ 役割（`staff_roles`）は作らない。自由入力の列で語が揺れる（D-5）。
 *   依頼者から役割の指示は受けていない。
 */

export const STAFF_NAME_MAX = 60

export type AddStaffFailure = 'name_required' | 'name_too_long'

export type AddStaffResult =
  | { ok: true; staffId: string; duplicateName: boolean }
  | { ok: false; reason: AddStaffFailure }

export async function addStaff(
  db: Db, input: { displayName: string },
): Promise<AddStaffResult> {
  const name = input.displayName.trim()
  if (name === '') return { ok: false, reason: 'name_required' }
  if (name.length > STAFF_NAME_MAX) return { ok: false, reason: 'name_too_long' }

  // 同じ名前が既に居るかは**教えるが、止めない。**
  const existing = await maybeOne(db,
    `SELECT 1 FROM staffs WHERE display_name = $1`, [name])

  const row = await maybeOne<{ id: string }>(db, `
    INSERT INTO staffs (display_name, email) VALUES ($1, NULL) RETURNING id`, [name])

  return { ok: true, staffId: row!.id, duplicateName: existing !== null }
}

export const ADD_STAFF_MESSAGE: Record<AddStaffFailure | 'saved' | 'saved_duplicate', string> = {
  saved: '入力者を追加した。',
  saved_duplicate: '入力者を追加した。**同じ名前の入力者が既に居る。**',
  name_required: '名前が空。',
  name_too_long: `名前が長すぎる（${STAFF_NAME_MAX} 文字まで）。`,
}

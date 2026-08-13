import { maybeOne, type Db } from '../db/client.ts'
import {
  newCredential, verifyCredential, verifyAbsent, tierOf, checkNewPassphrase,
  type PassphraseProblem,
} from '../auth/credential.ts'
import { BLANK_CHARS } from './text.ts'
import type { Tier } from '../auth/tiers.ts'

/**
 * 職員ごとの合言葉と、入った記録（0038。依頼者の許可。実行⑮）。
 *
 * ★ 判定はここに置く（`src/commands/`）。画面は値を渡して結果を出すだけ。
 * ★ **平文は保存しない・返さない・記録しない。** 落ちるときも合言葉を含めない。
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type SetPassphraseResult =
  | { ok: true; created: boolean }
  | { ok: false; reason: PassphraseProblem | 'staff_not_found' }

/**
 * その職員の合言葉を設定する（入れ替えも同じ道）。
 *
 * ★ **思い出す道は無い。** 忘れたらここで入れ替える。
 * ★ 実在の職員の合言葉は**こちらでは1つも設定しない** ―― 道具だけを置く
 *   （`pnpm staff:passphrase`）。設定するのは運営である。
 */
export async function setStaffPassphrase(
  db: Db, input: { staffId: string; passphrase: string; tier: string },
): Promise<SetPassphraseResult> {
  if (!UUID.test(input.staffId)) return { ok: false, reason: 'staff_not_found' }
  const problem = checkNewPassphrase(input.passphrase, input.tier)
  if (problem) return { ok: false, reason: problem }

  const staff = await maybeOne<{ id: string }>(
    db, `SELECT id FROM staffs WHERE id = $1 AND is_active`, [input.staffId])
  if (!staff) return { ok: false, reason: 'staff_not_found' }

  const existing = await maybeOne<{ staff_id: string }>(
    db, `SELECT staff_id FROM staff_credentials WHERE staff_id = $1`, [input.staffId])

  const cred = await newCredential(input.passphrase)
  await db.query(`
    INSERT INTO staff_credentials (staff_id, tier, salt, iterations, hash)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (staff_id) DO UPDATE
       SET tier = EXCLUDED.tier, salt = EXCLUDED.salt,
           iterations = EXCLUDED.iterations, hash = EXCLUDED.hash,
           updated_at = now()`,
    [input.staffId, input.tier, cred.salt, cred.iterations, cred.hash])

  return { ok: true, created: existing === null }
}

export type SignInResult =
  | { ok: true; tier: Tier; staffId: string }
  | { ok: false }

/**
 * 名前と合言葉で入る。
 *
 * ★ **失敗の理由を分けない。** 「その名前は無い」と「合言葉が違う」を
 *   別々に返すと、**名前が実在するかを教えてしまう**（既存の入口と同じ作法）。
 *   居ない相手にも同じだけ時間をかける（`verifyAbsent`）――
 *   返り値を揃えても、**応答時間が答えを漏らす。**
 *
 * ★ 名前で引くのは、共用の画面に職員の一覧を出さないためである。
 *   選択肢にすると、入口を開いた誰にでも**職員の氏名が並ぶ。**
 */
export async function signInAsStaff(
  db: Db, input: { displayName: string; passphrase: string },
): Promise<SignInResult> {
  const name = input.displayName.trim()
  if (name === '' || input.passphrase === '') {
    await verifyAbsent(input.passphrase)
    return { ok: false }
  }

  const row = await maybeOne<{
    staff_id: string; tier: string; salt: string; iterations: number; hash: string
  }>(db, `
    SELECT c.staff_id, c.tier, c.salt, c.iterations, c.hash
      FROM staff_credentials c
      JOIN staffs s ON s.id = c.staff_id
     WHERE s.is_active AND btrim(s.display_name, $2) = btrim($1, $2)`,
    [name, BLANK_CHARS])

  if (!row) {
    await verifyAbsent(input.passphrase)
    return { ok: false }
  }

  const okPass = await verifyCredential(
    { salt: row.salt, iterations: row.iterations, hash: row.hash }, input.passphrase)
  const tier = tierOf(row.tier)
  // ★ 層が定義外なら通さない（記録が壊れていても開かない。曖昧なら閉じる）。
  if (!okPass || !tier) return { ok: false }

  return { ok: true, tier, staffId: row.staff_id }
}

/**
 * 入った記録を1行積む（追記専用。0038）。
 *
 * ★ 共有の合言葉で入った場合は `staffId` を渡さない ――
 *   **「誰か分からない」を空欄で濁さず、記録の形で残す。**
 */
export async function recordSignIn(
  db: Db, input: { tier: Tier; staffId?: string | null },
): Promise<void> {
  const staffId = input.staffId ?? null
  await db.query(`
    INSERT INTO sign_in_events (staff_id, tier, method)
    VALUES ($1, $2, $3)`,
    [staffId, input.tier, staffId === null ? 'shared' : 'staff'])
}

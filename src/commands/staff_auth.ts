import type { Db } from '../db/client.ts'
import type { Tier } from '../auth/tiers.ts'

/**
 * 入った記録（0038。C-146 で職員ごとの合言葉は外した）。
 *
 * ★ 依頼者の判断 ――「経営層と平社員の2個パスワードがあればいい」。
 *   したがって入口は**共有の合言葉だけ**で、**誰が入ったかは記録できない**
 *   （C-84 の穴は開いたまま）。
 *
 * ★ それでも**入った事実そのものは残す** ―― いつ・どの層で入ったか。
 *   誰かは分からないので `staff_id` は NULL になる。
 *   **分からないことを、分からないと記録する**（空欄で濁さない）。
 *
 * ★ 職員ごとの合言葉を作る道具は消した（`src/auth/credential.ts` と
 *   `scripts/staff-passphrase.ts`）。**使わない道具を残さない**（C-110 と同じ）。
 *   必要になったら Git 履歴にある（0038 の表と制約はそのまま残っている ――
 *   適用済みマイグレーションは編集しない）。
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

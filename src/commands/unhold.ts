import { maybeOne, type Db } from '../db/client.ts'

/**
 * 保留を解く。
 *
 * `assign` と同じ型（判定はここ、受け渡しはサーバアクション、表示は素の
 * フォーム）に倣う。違うのは**消える値があるか**という点だった。
 *
 * ★ 何も消えない。だから追記専用の表は足していない。
 *
 *   `REPORT-6.2.md` 5節で「保留を解くと必須で入っていた理由が消えるので、
 *   履歴の表を足すか先に決める必要がある」と書いた。**制約を読み直したら
 *   その前提が誤りだった。**
 *
 *     CONSTRAINT evaluations_hold_reason_required
 *         CHECK (state <> 'held' OR hold_reason IS NOT NULL)
 *
 *   これは「保留なら理由が要る」であって「保留でなければ理由を持てない」では
 *   ない。**解いても `hold_reason` を残せる。** 残せば何も失われない。
 *
 *   しかも応募1件の画面は `hold_reason` を state で絞らずに出しているので、
 *   解いたあとも理由がそのまま読める（`app/applications/[id]/page.tsx`）。
 *   ラベルだけ「保留」と出ると現在も止まっているように読めるため、
 *   そこは state で呼び分けるように直した。
 *
 *   つまり**記録層に足すものは無い。** 原典の設計原則1「導出可能な値は
 *   物理保存しない」に照らしても、解除の事実は state から読める。
 *
 * ★ 残るもの（TODO(MVP)）。**誰がいつ解いたかは残らない。**
 *   理由の本文は残るが、解除の時刻と実行者は記録されない。
 *   `assign` と同じ穴で、同じ判断（追記専用の表を足すか）を共有する。
 *   運用して「いつ動き出したのか分からない」と困ってから足す。
 */

export type UnholdResult =
  | { ok: true; applicantName: string; stepName: string; nextOwner: string | null }
  | { ok: false; reason: UnholdFailure }

export type UnholdFailure =
  /** 評価が見つからない。 */
  | 'evaluation_not_found'
  /** 保留ではない。すでに誰かが解いた、または提出された。 */
  | 'not_held'
  /** その応募はもう動いていない（合格・不合格・辞退・取り下げ・削除）。 */
  | 'not_active'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 保留の評価を、判断待ちに戻す。
 *
 * 対象は `v_open_tasks` の `'unhold'` に出ているものだけである。
 * 画面に出ているものと操作できるものを同じ述語で揃える（C-20 と同じ）。
 *
 * 更新するのは `state` の1列だけで、**`hold_reason` は残す。**
 * 消すと「なぜ止まっていたか」が記録から失われる。原則5（訂正は打ち消しの
 * 追記で表現し、元の記録は残す）と同じ考え方で、上書きで消さない。
 */
export async function unholdEvaluation(
  db: Db,
  args: { evaluationId: string },
): Promise<UnholdResult> {
  if (!UUID.test(args.evaluationId)) return { ok: false, reason: 'evaluation_not_found' }

  const target = await maybeOne<{
    state: string
    is_active: boolean
    applicant_name: string
    step_name: string
    next_owner: string | null
  }>(db, `
    SELECT e.state,
           EXISTS (SELECT 1 FROM v_active_applications a WHERE a.id = e.application_id)
             AS is_active,
           p.family_name || ' ' || p.given_name AS applicant_name,
           ss.name AS step_name,
           st.display_name AS next_owner
      FROM evaluations e
      JOIN selection_steps ss ON ss.id = e.selection_step_id
      JOIN applications a ON a.id = e.application_id
      JOIN persons p ON p.id = a.person_id
      LEFT JOIN staffs st ON st.id = e.interviewer_staff_id
     WHERE e.id = $1`, [args.evaluationId])

  if (!target) return { ok: false, reason: 'evaluation_not_found' }
  if (!target.is_active) return { ok: false, reason: 'not_active' }
  if (target.state !== 'held') return { ok: false, reason: 'not_held' }

  // state を条件に入れる。確認と更新の間に誰かが解いていたら 0 行で終わる。
  const { rows } = await db.query(`
    UPDATE evaluations SET state = 'pending'
     WHERE id = $1 AND state = 'held'
     RETURNING id`, [args.evaluationId])
  if (rows.length === 0) return { ok: false, reason: 'not_held' }

  return {
    ok: true,
    applicantName: target.applicant_name,
    stepName: target.step_name,
    nextOwner: target.next_owner,
  }
}

export const UNHOLD_FAILURE_MESSAGE: Record<UnholdFailure, string> = {
  evaluation_not_found: 'その評価は見つからなかった。画面を読み直す。',
  not_held: 'その評価は保留ではない。ほかの人が先に解いた可能性がある。',
  not_active: 'その応募はもう動いていない。保留を解く必要がない。',
}

/**
 * 画面へ返す結果コード。`assign` と同じ理由でここに置く
 * （`'use server'` のファイルは非同期関数以外を export できない）。
 */
export type UnholdCode = 'unheld' | UnholdFailure

export const UNHOLD_CODE_MESSAGE: Record<UnholdCode, string> = {
  unheld: '保留を解いた。判断待ちに戻した。',
  ...UNHOLD_FAILURE_MESSAGE,
}

const CODES = Object.keys(UNHOLD_CODE_MESSAGE) as UnholdCode[]

export const parseUnholdCode = (value: string | string[] | undefined): UnholdCode | null => {
  const v = Array.isArray(value) ? value[0] : value
  return v && CODES.includes(v as UnholdCode) ? (v as UnholdCode) : null
}

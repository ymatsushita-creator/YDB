import { maybeOne, type Db } from '../db/client.ts'

/**
 * 保留にする。
 *
 * `unhold` の対である。**片道しか無かった。**
 *
 *   実行⑦で架空の10人を通したときに詰まった（C-32）。解くことはできるのに、
 *   保留にすることが画面からもコマンドからもできない。デモデータは記録層へ
 *   直接 `held` を書いて作っていたので、これまで表に出なかった。
 *   **デモが埋めていた欠落**である（実行④〜⑥で5回踏んだ形と同じ）。
 *
 * 型は `unhold` に倣う。判定はここ、受け渡しはサーバアクション、
 * 表示は素の `<form action={...}>`（C-20）。
 *
 * ★ **理由は必須である。**
 *
 *     CONSTRAINT evaluations_hold_reason_required
 *         CHECK (state <> 'held' OR hold_reason IS NOT NULL)
 *
 *   制約が要求しているのは NOT NULL だけだが、**空白だけの文字列を通さない。**
 *   通せば制約は満たすのに中身が無い記録ができる。`rationale` で同じ穴が
 *   開いていた（A-19: 「根拠は空にできない」と書いてあるのに空にできた）。
 *   同じ間違いを2度しない。
 *
 * ★ 残るもの（TODO(MVP)）。**誰がいつ保留にしたかは残らない。**
 *   `assign` / `unhold` と同じ穴で、同じ判断（追記専用の表を足すか）を共有する。
 *   運用して「いつから止まっていたのか分からない」と困ってから足す。
 */

export type HoldResult =
  | { ok: true; applicantName: string; stepName: string }
  | { ok: false; reason: HoldFailure }

export type HoldFailure =
  /** 評価が見つからない。 */
  | 'evaluation_not_found'
  /** すでに保留、または確定済みで、保留にできる状態ではない。 */
  | 'not_pending'
  /** その応募はもう動いていない（合格・不合格・辞退・取り下げ・削除）。 */
  | 'not_active'
  /** 理由が空。制約は NOT NULL だけだが、空白だけの理由を通さない。 */
  | 'reason_required'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 判断待ちの評価を、保留にする。
 *
 * 操作できる母集団を、画面に出す述語と揃える（C-20）。
 * 動いていない応募の評価は保留にできない ―― 止める意味が無いうえ、
 * 運転席の「やること」に出ていないものを触れることになる。
 */
export async function holdEvaluation(
  db: Db,
  args: { evaluationId: string; reason: string },
): Promise<HoldResult> {
  if (!UUID.test(args.evaluationId)) return { ok: false, reason: 'evaluation_not_found' }

  const reason = (args.reason ?? '').trim()
  if (reason === '') return { ok: false, reason: 'reason_required' }

  const target = await maybeOne<{
    state: string
    is_active: boolean
    applicant_name: string
    step_name: string
  }>(db, `
    SELECT e.state,
           EXISTS (SELECT 1 FROM v_active_applications a WHERE a.id = e.application_id)
             AS is_active,
           p.family_name || ' ' || p.given_name AS applicant_name,
           ss.name AS step_name
      FROM evaluations e
      JOIN selection_steps ss ON ss.id = e.selection_step_id
      JOIN applications a ON a.id = e.application_id
      JOIN persons p ON p.id = a.person_id
     WHERE e.id = $1`, [args.evaluationId])

  if (!target) return { ok: false, reason: 'evaluation_not_found' }
  if (!target.is_active) return { ok: false, reason: 'not_active' }
  if (target.state !== 'pending') return { ok: false, reason: 'not_pending' }

  // state を条件に入れる。確認と更新の間に誰かが確定していたら 0 行で終わる。
  const { rows } = await db.query(`
    UPDATE evaluations SET state = 'held', hold_reason = $2
     WHERE id = $1 AND state = 'pending'
     RETURNING id`, [args.evaluationId, reason])
  if (rows.length === 0) return { ok: false, reason: 'not_pending' }

  return { ok: true, applicantName: target.applicant_name, stepName: target.step_name }
}

export const HOLD_FAILURE_MESSAGE: Record<HoldFailure, string> = {
  evaluation_not_found: 'その評価は見つからなかった。画面を読み直す。',
  not_pending: 'その評価は判断待ちではない。すでに保留か、確定済み。',
  not_active: 'その応募はもう動いていない。保留にする必要がない。',
  reason_required: '保留の理由を書く。あとで解くときに、何を待っていたかが要る。',
}

/**
 * 画面へ返す結果コード。`unhold` と同じ理由でここに置く
 * （`'use server'` のファイルは非同期関数以外を export できない）。
 */
export type HoldCode = 'held' | HoldFailure

export const HOLD_CODE_MESSAGE: Record<HoldCode, string> = {
  held: '保留にした。理由は解くときに読める。',
  ...HOLD_FAILURE_MESSAGE,
}

const CODES = Object.keys(HOLD_CODE_MESSAGE) as HoldCode[]

export const parseHoldCode = (value: string | string[] | undefined): HoldCode | null => {
  const v = Array.isArray(value) ? value[0] : value
  return v && CODES.includes(v as HoldCode) ? (v as HoldCode) : null
}

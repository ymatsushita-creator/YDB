import { maybeOne, all, type Db } from '../db/client.ts'

/**
 * 評価の確定（E3）と、選考の判定（D1）。
 *
 * この2つで、採用の1周が画面の中で閉じる ――
 * 今日やることを見る → 候補者を開く → 担当を決める / 替える / 保留を解く →
 * 評価する → **確定する → 判定する → 次のステップへ進む**。
 *
 * 同じファイルに置いたのは、**判定が確定の直後にしか成り立たない**からである。
 * 別々に置くと、成立条件を2箇所で組み立てることになる。
 */

// -------------------------------------------------------------
// E3. 評価を確定する
// -------------------------------------------------------------

export type SubmitResult =
  | { ok: true; applicantName: string; stepName: string }
  | { ok: false; reason: SubmitFailure }

export type SubmitFailure =
  | 'evaluation_not_found'
  /** いま確定できる状態ではない（担当未割当・保留・相反・動いていない）。 */
  | 'not_evaluatable'
  /** まだ点が付いていない軸が残っている。 */
  | 'criteria_missing'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 全軸そろった評価を提出済みにする。
 *
 * **そろう前の確定を認めていない。** 認めないほうが単純だからである。
 * 途中で確定できると「点が2つしか無い評価」が記録に残り、ステップ別の
 * 平均が軸によって母数の違う値になる。必要だと分かったら緩める（TODO(MVP)）。
 *
 * 残っている軸の判定は `evaluation_scores` の有無だけで行う（原則7）。
 */
export async function submitEvaluation(
  db: Db,
  args: { evaluationId: string },
): Promise<SubmitResult> {
  if (!UUID.test(args.evaluationId)) return { ok: false, reason: 'evaluation_not_found' }

  const target = await maybeOne<{
    applicant_name: string
    step_name: string
    missing: number
  }>(db, `
    SELECT p.family_name || ' ' || p.given_name AS applicant_name,
           ss.name AS step_name,
           (SELECT count(*) FROM evaluation_criteria ec
             WHERE ec.selection_step_id = e.selection_step_id
               AND (ec.applies_to = 'all'
                    OR (ec.applies_to = 'reapplicant_only' AND a.is_reapplication))
               AND NOT EXISTS (SELECT 1 FROM evaluation_scores es
                                WHERE es.evaluation_id = e.id
                                  AND es.criteria_id = ec.id)) AS missing
      FROM v_open_tasks t
      JOIN evaluations e ON e.id = t.source_id
      JOIN applications a ON a.id = e.application_id
      JOIN persons p ON p.id = a.person_id
      JOIN selection_steps ss ON ss.id = e.selection_step_id
     WHERE t.source_id = $1 AND t.kind = 'evaluate'`, [args.evaluationId])

  if (!target) {
    const exists = await maybeOne(db,
      `SELECT 1 FROM evaluations WHERE id = $1`, [args.evaluationId])
    return { ok: false, reason: exists ? 'not_evaluatable' : 'evaluation_not_found' }
  }
  if (Number(target.missing) > 0) return { ok: false, reason: 'criteria_missing' }

  // 提出時刻は now()。`evaluations_submitted_after_assigned` があるので、
  // 割り当てより前にはならない（過去の割り当てに対して今日提出する形）。
  const { rows } = await db.query(`
    UPDATE evaluations SET state = 'submitted', submitted_at = now()
     WHERE id = $1 AND state = 'pending'
     RETURNING id`, [args.evaluationId])
  if (rows.length === 0) return { ok: false, reason: 'not_evaluatable' }

  return { ok: true, applicantName: target.applicant_name, stepName: target.step_name }
}

// -------------------------------------------------------------
// D1. 選考の判定（通過 / 不合格）
// -------------------------------------------------------------

export interface DecidableStep {
  application_id: string
  selection_step_id: string
  step_name: string
  step_order: number
  /** 次のステップ。無ければ null（最終ステップ = 通過させると合格）。 */
  next_step_id: string | null
  next_step_name: string | null
  /** そのステップに提出済みの評価が何件あるか。 */
  submitted_evaluations: number
}

/**
 * いま判定できるステップ。
 *
 * 成り立つ条件は3つ。**どれも事実の有無で見る。**
 *
 *   1. 応募が動いている（`v_active_applications`）
 *   2. そのステップの評価がすべて提出済み（判断待ち・保留が残っていない）
 *   3. そのステップの遷移がまだ記録されていない（二重に判定しない）
 *
 * 面接官が2人いるステップは、**2人とも提出してから**判定できる。
 */
export const getDecidableStep = (db: Db, applicationId: string) => {
  if (!UUID.test(applicationId)) return Promise.resolve(null)
  return maybeOne<DecidableStep>(db, `
    SELECT a.id AS application_id,
           ss.id AS selection_step_id, ss.name AS step_name, ss.sort_order AS step_order,
           nx.id AS next_step_id, nx.name AS next_step_name,
           count(e.id) AS submitted_evaluations
      FROM v_active_applications a
      JOIN evaluations e ON e.application_id = a.id
      JOIN selection_steps ss ON ss.id = e.selection_step_id
      LEFT JOIN selection_steps nx
             ON nx.season_id = ss.season_id AND nx.sort_order = ss.sort_order + 1
     WHERE a.id = $1
       -- そのステップに、まだ判断が下りていない評価が無い
       AND NOT EXISTS (
           SELECT 1 FROM evaluations o
            WHERE o.application_id = a.id
              AND o.selection_step_id = ss.id
              AND o.state <> 'submitted')
       -- そのステップの遷移がまだ無い（打ち消されたものは除く）
       AND NOT EXISTS (
           SELECT 1 FROM v_effective_status_histories sh
            WHERE sh.application_id = a.id
              AND sh.selection_step_id = ss.id)
     GROUP BY a.id, ss.id, ss.name, ss.sort_order, nx.id, nx.name
     ORDER BY ss.sort_order
     LIMIT 1`, [applicationId])
}

export type DecideResult =
  | {
      ok: true
      decision: 'advance' | 'reject'
      stepName: string
      /** 次に生成したステップ。最終ステップを通過したときは null。 */
      nextStepName: string | null
      /** 最終ステップを通過した（＝合格）。 */
      accepted: boolean
    }
  | { ok: false; reason: DecideFailure }

export type DecideFailure =
  /** いま判定できるステップが無い（評価が残っている、または済んでいる）。 */
  | 'not_decidable'
  /** 判定した職員が選ばれていない、または非活性化されている。 */
  | 'staff_not_available'
  /** 判定の種類が不正。 */
  | 'bad_decision'

/**
 * ステップの判定を記録し、通過なら次のステップの評価行を作る。
 *
 * ★ `status_histories` は追記専用（0003）。判定は行の追加でしか表せない。
 *   訂正が要るときは打ち消し行を足す（原則5）。**この関数は訂正を扱わない。**
 *
 * ★ **不合格にステップを結び付けている。** `CLAUDE.md` は
 *   「必要になったら reject にステップを持たせる」と書いていた。
 *   画面から判定する以上、どのステップで落ちたかは**推測ではなく事実**として
 *   手元にあるので、埋める。埋めないと「どのステップで落ちたか」を
 *   永久に集計できない（C-26）。
 *
 * ★ 通過したときに次のステップの評価行を作る。**担当は付けない。**
 *   これが運転席の「担当を決める」として出る ―― 次の一手が自動で並ぶ。
 *   最終ステップを通過したときは何も作らない（合格）。
 */
export async function decideStep(
  db: Db,
  args: {
    applicationId: string
    decision: 'advance' | 'reject'
    staffId: string
    note?: string
  },
): Promise<DecideResult> {
  if (args.decision !== 'advance' && args.decision !== 'reject') {
    return { ok: false, reason: 'bad_decision' }
  }
  if (!UUID.test(args.staffId)) return { ok: false, reason: 'staff_not_available' }

  const staff = await maybeOne(db,
    `SELECT 1 FROM staffs WHERE id = $1 AND is_active`, [args.staffId])
  if (!staff) return { ok: false, reason: 'staff_not_available' }

  const step = await getDecidableStep(db, args.applicationId)
  if (!step) return { ok: false, reason: 'not_decidable' }

  // 遷移を1行追記する。時刻は now()。
  // 不合格にもステップを入れる（C-26）。
  await db.query(`
    INSERT INTO status_histories
      (application_id, transition_type, selection_step_id, occurred_at,
       changed_by_staff_id, note)
    VALUES ($1, $2, $3, now(), $4, $5)`,
    [args.applicationId, args.decision, step.selection_step_id, args.staffId,
     args.note?.trim() || null])

  // 通過して次のステップがあれば、そこの評価行を作る。担当は付けない。
  if (args.decision === 'advance' && step.next_step_id) {
    await db.query(`
      INSERT INTO evaluations (application_id, selection_step_id, state, assigned_at)
      VALUES ($1, $2, 'pending', now())`,
      [args.applicationId, step.next_step_id])
  }

  return {
    ok: true,
    decision: args.decision,
    stepName: step.step_name,
    nextStepName: args.decision === 'advance' ? step.next_step_name : null,
    accepted: args.decision === 'advance' && step.next_step_id === null,
  }
}

// -------------------------------------------------------------
// 画面へ返すコード
// -------------------------------------------------------------

export type DecideCode =
  | 'submitted' | 'advanced' | 'accepted' | 'rejected'
  | 'corrected_to_advance' | 'corrected_to_reject'
  | SubmitFailure | DecideFailure | CorrectFailure

export const DECIDE_CODE_MESSAGE: Record<DecideCode, string> = {
  submitted: '評価を確定した。次は選考の判定である。',
  advanced: 'このステップを通過にした。次のステップの担当を決める。',
  accepted: '最終選考を通過にした。合格である。',
  rejected: '不合格にした。この応募の選考は終わった。',
  evaluation_not_found: 'その評価は見つからなかった。画面を読み直す。',
  not_evaluatable: 'いまこの評価は確定できない。先にやることが別にある。',
  criteria_missing: 'まだ点が付いていない軸がある。すべて付けてから確定する。',
  not_decidable: 'いま判定できるステップが無い。評価が残っているか、済んでいる。',
  staff_not_available: '判定した人が選ばれていない。',
  bad_decision: '判定の種類が不正である。',
  corrected_to_advance: '判定を「通過」に訂正した。元の判定は打ち消し行で残っている。',
  corrected_to_reject: '判定を「不合格」に訂正した。元の判定は打ち消し行で残っている。',
  not_correctable: '訂正できる判定が無い。画面を読み直す。',
}

const CODES = Object.keys(DECIDE_CODE_MESSAGE) as DecideCode[]

export const parseDecideCode = (value: string | string[] | undefined): DecideCode | null => {
  const v = Array.isArray(value) ? value[0] : value
  return v && CODES.includes(v as DecideCode) ? (v as DecideCode) : null
}

/** 判定に使える職員。`listAssignableStaff` と違い、負荷は要らない。 */
export const listDecidingStaff = (db: Db) =>
  all<{ staff_id: string; display_name: string }>(db, `
    SELECT id AS staff_id, display_name FROM staffs
     WHERE is_active ORDER BY display_name`)

// -------------------------------------------------------------
// D2. 判定の訂正（打ち消し行の追記）
// -------------------------------------------------------------
//
// 記録層は最初からこの形を想定している ―― `corrects_history_id` と
// `is_correction` があり、`v_effective_status_histories` が
// 「深さ偶数＝有効」の逆仕訳で解決する。**新しい概念は足していない。**
//
// ★ 表せるのは**差し替え**だけである（通過↔不合格）。
//   訂正行そのものが有効な遷移になるため、「判定を無かったことにして
//   判断待ちへ戻す」は表せない。transition_type に「何も起きていない」が
//   無いからである。
//   TODO(MVP): 押し間違いを完全に消す運用が必要だと分かったら、そのとき決める。
//   いまは差し替えで足りる（誤って不合格にした → 通過へ直す）。

export interface CorrectableDecision {
  history_id: string
  application_id: string
  /** いまの判定。 */
  transition_type: 'advance' | 'reject'
  selection_step_id: string | null
  step_name: string | null
  decided_at: Date
  decided_by: string
  note: string | null
  /** 訂正して通過にしたときに進む先。無ければ最終ステップ。 */
  next_step_id: string | null
  next_step_name: string | null
}

/**
 * いま訂正できる判定。
 *
 * **最後の有効な判定だけを対象にする。** 途中の判定を直せると、あとに続く
 * 判定との整合が崩れる（3段目を通したあとで1段目を不合格に直す、など）。
 *
 * 母集団は `v_active_applications` ではない。**不合格にした応募こそ
 * 直したい**ので、動いていない応募も対象に含める。
 * 個人情報削除を受けた人だけは外す（運用の画面に氏名の窓を残さない）。
 */
export const getCorrectableDecision = (db: Db, applicationId: string) => {
  if (!UUID.test(applicationId)) return Promise.resolve(null)
  return maybeOne<CorrectableDecision>(db, `
    SELECT sh.id AS history_id, sh.application_id, sh.transition_type,
           sh.selection_step_id, ss.name AS step_name,
           sh.occurred_at AS decided_at, st.display_name AS decided_by, sh.note,
           nx.id AS next_step_id, nx.name AS next_step_name
      FROM v_effective_status_histories sh
      JOIN applications a ON a.id = sh.application_id AND a.deleted_at IS NULL
      JOIN persons p ON p.id = a.person_id AND p.deleted_at IS NULL
      JOIN staffs st ON st.id = sh.changed_by_staff_id
      LEFT JOIN selection_steps ss ON ss.id = sh.selection_step_id
      LEFT JOIN selection_steps nx
             ON ss.id IS NOT NULL AND nx.season_id = ss.season_id
            AND nx.sort_order = ss.sort_order + 1
     WHERE sh.application_id = $1
       AND sh.transition_type IN ('advance', 'reject')
     ORDER BY sh.occurred_at DESC, sh.id DESC
     LIMIT 1`, [applicationId])
}

export type CorrectResult =
  | {
      ok: true
      /** 訂正後の判定。 */
      decision: 'advance' | 'reject'
      stepName: string | null
      /** 訂正で新しく作った次のステップ。作らなかったときは null。 */
      createdNextStep: string | null
      accepted: boolean
    }
  | { ok: false; reason: CorrectFailure }

export type CorrectFailure =
  /** 訂正できる判定が無い（まだ判定していない、または対象がずれている）。 */
  | 'not_correctable'
  | 'staff_not_available'

/**
 * 判定を差し替える。打ち消し行を1行追記する。
 *
 * ★ **不合格 → 通過に直したときは、次のステップの評価行を作る。**
 *   作らないと「通過したのに次にやることが無い」状態になり、
 *   運用者の手が止まる。これは判定（D1）と同じ手当てである。
 *   すでにその行があるときは作らない（一度通過 → 不合格 → また通過、の経路）。
 *
 * ★ 通過 → 不合格に直したときは、次のステップの評価行を**消さない。**
 *   点が入っているかもしれない記録を消す判断は、ここでするものではない。
 *   応募の結末が `rejected` になると `v_active_applications` から外れるので、
 *   やることにも運用の画面にも出ない。
 *   TODO(MVP): 宙に浮いた評価行が残る。集計はすべて結末で絞っているので
 *   数字は狂わないが、行としては残る。
 */
export async function correctDecision(
  db: Db,
  args: { applicationId: string; historyId: string; staffId: string; note?: string },
): Promise<CorrectResult> {
  if (!UUID.test(args.staffId)) return { ok: false, reason: 'staff_not_available' }
  const staff = await maybeOne(db,
    `SELECT 1 FROM staffs WHERE id = $1 AND is_active`, [args.staffId])
  if (!staff) return { ok: false, reason: 'staff_not_available' }

  const current = await getCorrectableDecision(db, args.applicationId)
  // 画面が見ていた判定と、いま訂正できる判定が同じでなければ通さない。
  // 別の誰かが先に訂正していた場合に、見ていたのとは違う行を打ち消さない。
  if (!current || current.history_id !== args.historyId) {
    return { ok: false, reason: 'not_correctable' }
  }

  const flipped = current.transition_type === 'advance' ? 'reject' : 'advance'

  await db.query(`
    INSERT INTO status_histories
      (application_id, transition_type, selection_step_id, occurred_at,
       changed_by_staff_id, is_correction, corrects_history_id, note)
    VALUES ($1, $2, $3, now(), $4, true, $5, $6)`,
    [args.applicationId, flipped, current.selection_step_id, args.staffId,
     current.history_id, args.note?.trim() || null])

  let createdNextStep: string | null = null
  if (flipped === 'advance' && current.next_step_id) {
    // 無ければ作る。あれば触らない（evaluations_assignment_key に当たる）。
    const { rows } = await db.query(`
      INSERT INTO evaluations (application_id, selection_step_id, state, assigned_at)
      SELECT $1, $2, 'pending', now()
       WHERE NOT EXISTS (
           SELECT 1 FROM evaluations e
            WHERE e.application_id = $1 AND e.selection_step_id = $2)
      RETURNING id`, [args.applicationId, current.next_step_id])
    if (rows.length > 0) createdNextStep = current.next_step_name
  }

  return {
    ok: true,
    decision: flipped,
    stepName: current.step_name,
    createdNextStep,
    accepted: flipped === 'advance' && current.next_step_id === null,
  }
}

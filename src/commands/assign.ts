import { maybeOne, all, type Db } from '../db/client.ts'

/**
 * 書き込み。
 *
 * `src/queries/` は読み取りに集約すると決めてある（CLAUDE.md 3節）。
 * 書き込みを同じ場所に混ぜない理由は、**守るべき規律が違う**ことである。
 *
 *   読み取り … 集計の定義をビュー側に置き、母集団を間違えない
 *   書き込み … 「その操作が成り立つ事実があるか」を書く前に確かめる
 *
 * 画面から来た値を検証せずに UPDATE すると、終わった応募の担当を替えたり、
 * 個人情報削除を受けた人の評価を触ったりできてしまう。読み取り側は
 * 母集団を間違えても数字がずれるだけだが、書き込みは記録そのものを壊す。
 *
 * 判定はすべて**事実の有無**で行う（原典の設計原則7「事実の有無で判定し、
 * 理由で分岐しない」）。理由コードを引数で受け取って分岐する形にはしない。
 */

export interface AssignableStaff {
  staff_id: string
  display_name: string
  /** いまこの年度で抱えている判断待ちの件数。偏りが見えないと割り当てられない。 */
  pending: number
}

/**
 * 担当に選べる面接官。
 *
 * `is_active` の職員だけを返す。非活性化した職員を選べると、
 * 割り当てた瞬間に「誰も見ていない評価」ができる。
 *
 * ★ 利益相反になる組み合わせを、ここでは除いていない。
 *   除くには「その応募者にとって相反する職員か」という述語が要るが、
 *   それは `v_conflict_of_interest` が既に持っている定義である。
 *   同じ述語をここに書き直すと、片方だけ直したときに食い違う（C-11）。
 *   相反する職員を選んだ場合は、既存の検出がそのまま働き、
 *   コックピットに「担当を替える」として出る（C-17）。
 *   TODO(MVP): 選ぶ前に警告したい。定義を2度書かずにやるには、
 *              相反の述語を記録層側で「応募者×職員」の形に作り直す必要がある。
 */
export const listAssignableStaff = (db: Db, seasonId: string) =>
  all<AssignableStaff>(db, `
    SELECT st.id AS staff_id, st.display_name,
           count(t.source_id) AS pending
      FROM staffs st
      LEFT JOIN v_open_tasks t
             ON t.owner_staff_id = st.id AND t.season_id = $1
     WHERE st.is_active
     GROUP BY st.id, st.display_name
     ORDER BY pending, st.display_name`, [seasonId])

export type AssignResult =
  | { ok: true; staffName: string; applicantName: string; stepName: string }
  | { ok: false; reason: AssignFailure }

export type AssignFailure =
  /** 評価が見つからない。URL を直接叩かれた場合も含む。 */
  | 'evaluation_not_found'
  /** すでに担当が決まっている。誰かが先に割り当てた。 */
  | 'already_assigned'
  /** その応募はもう動いていない（合格・不合格・辞退・取り下げ・削除）。 */
  | 'not_active'
  /** 職員が見つからない、または非活性化されている。 */
  | 'staff_not_available'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 判断待ちの評価に、面接官を1人割り当てる。
 *
 * **`v_open_tasks` の 'assign' に出ている評価だけを対象にする。**
 * 画面に出ている「やること」と、実行できる操作の母集団を同じ述語で揃える。
 * ここを `evaluations` 直結にすると、画面には出ていない評価（終わった応募や
 * 削除を受けた人のもの）を id 直打ちで触れてしまう。
 *
 * 更新は `interviewer_staff_id` の1列だけである。
 *
 * ★ **誰がいつ割り当てたかは残らない。**
 *   `evaluations` に担当の変更履歴を持つ列が無く、原典にも無い。
 *   `status_histories` は応募の遷移の記録で、担当の付け替えは遷移ではない。
 *   TODO(MVP): 割り当ての履歴が要るなら、追記専用の表を1つ足すことになる。
 *   いまは要らない。運用して「誰が決めたのか分からない」と困ってから足す。
 */
export async function assignInterviewer(
  db: Db,
  args: { evaluationId: string; staffId: string },
): Promise<AssignResult> {
  // URL やフォームから来た値。UUID でなければ SQL に渡さず落とす。
  // 渡すと invalid input syntax で 500 になる（getSeason と同じ理由）。
  if (!UUID.test(args.evaluationId)) return { ok: false, reason: 'evaluation_not_found' }
  if (!UUID.test(args.staffId)) return { ok: false, reason: 'staff_not_available' }

  const staff = await maybeOne<{ display_name: string }>(db, `
    SELECT display_name FROM staffs WHERE id = $1 AND is_active`, [args.staffId])
  if (!staff) return { ok: false, reason: 'staff_not_available' }

  // 評価そのものの事実を見る。ここで得た state / 担当の有無で、
  // 何が成り立っていないのかを呼び出し側に返す。
  const target = await maybeOne<{
    state: string
    assigned: boolean
    is_active: boolean
    applicant_name: string
    step_name: string
  }>(db, `
    SELECT e.state,
           (e.interviewer_staff_id IS NOT NULL) AS assigned,
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
  if (target.assigned) return { ok: false, reason: 'already_assigned' }
  if (!target.is_active) return { ok: false, reason: 'not_active' }
  if (target.state !== 'pending') return { ok: false, reason: 'not_active' }

  // WHERE を条件付きにしておく。上の確認と更新の間に誰かが割り当てても、
  // 0 行更新で終わって後から来たほうが黙って上書きすることがない。
  const { rows } = await db.query(`
    UPDATE evaluations SET interviewer_staff_id = $2
     WHERE id = $1 AND state = 'pending' AND interviewer_staff_id IS NULL
     RETURNING id`, [args.evaluationId, args.staffId])
  if (rows.length === 0) return { ok: false, reason: 'already_assigned' }

  return {
    ok: true,
    staffName: staff.display_name,
    applicantName: target.applicant_name,
    stepName: target.step_name,
  }
}

// -------------------------------------------------------------
// 担当を替える
// -------------------------------------------------------------

export type ReassignResult =
  | {
      ok: true
      applicantName: string
      stepName: string
      /** 替える前の担当。**これは記録に残らない**（下の ★ を読む）。 */
      previousStaffName: string
      staffName: string
    }
  | { ok: false; reason: ReassignFailure }

export type ReassignFailure =
  | 'evaluation_not_found'
  /** まだ担当が決まっていない。それは「担当を替える」ではなく「決める」。 */
  | 'not_assigned'
  /** その応募はもう動いていない。 */
  | 'not_active'
  /** 判断が下りている。替えても戻らない。 */
  | 'already_decided'
  /** いまと同じ職員が選ばれた。 */
  | 'same_staff'
  | 'staff_not_available'

/**
 * すでに担当が決まっている評価の、面接官を差し替える。
 *
 * `assignInterviewer` と分けた理由は、**成り立つ条件が逆**だからである。
 * あちらは「担当がいないこと」を要求し、こちらは「いること」を要求する。
 * 1つの関数に旗を足して分岐させると、呼び間違えたときに
 * 意図しない上書きが起きる（原則7「事実の有無で判定し、理由で分岐しない」）。
 *
 * 使う場面は利益相反の解消である（`v_open_tasks` の 'reassign'）。
 * ただし**利益相反であることを条件にしていない。** 負荷の偏りを直すために
 * 替えることもあり、そのとき条件が邪魔をする。危険でもない ――
 * 動いている応募の、判断が下りていない評価しか触れない。
 *
 * ★ **替える前の担当は記録に残らない。**
 *   `interviewer_staff_id` を上書きするので、誰が最初に割り当たっていたかは
 *   消える。ここで初めて「上書きで消える値」が出た。
 *   `assign` と `unhold` では消えるものが無かった（C-20 / C-21）。
 *
 *   **TODO(MVP)**: 割り当ての履歴を残すなら、追記専用の表を1つ足す。
 *   3つの操作（決める・解く・替える）が同じ表を使える。
 *   `process.md` の Architecture Policy に従い、いまは最も単純な仮定
 *   （上書きする）で進める。運用して「前は誰だったのか」と訊かれてから足す。
 *
 *   なお**利益相反が起きていた事実自体も、替えると消える。**
 *   `v_conflict_of_interest` は現在の担当から計算するため、
 *   替えたあとは検出されない。判断が下りる前に替えている（`submitted` は
 *   弾く）ので、誤った評価が記録に残ることはない。
 */
export async function reassignInterviewer(
  db: Db,
  args: { evaluationId: string; staffId: string },
): Promise<ReassignResult> {
  if (!UUID.test(args.evaluationId)) return { ok: false, reason: 'evaluation_not_found' }
  if (!UUID.test(args.staffId)) return { ok: false, reason: 'staff_not_available' }

  const staff = await maybeOne<{ display_name: string }>(db, `
    SELECT display_name FROM staffs WHERE id = $1 AND is_active`, [args.staffId])
  if (!staff) return { ok: false, reason: 'staff_not_available' }

  const target = await maybeOne<{
    state: string
    current_staff_id: string | null
    current_staff_name: string | null
    is_active: boolean
    applicant_name: string
    step_name: string
  }>(db, `
    SELECT e.state,
           e.interviewer_staff_id AS current_staff_id,
           st.display_name        AS current_staff_name,
           EXISTS (SELECT 1 FROM v_active_applications a WHERE a.id = e.application_id)
             AS is_active,
           p.family_name || ' ' || p.given_name AS applicant_name,
           ss.name AS step_name
      FROM evaluations e
      JOIN selection_steps ss ON ss.id = e.selection_step_id
      JOIN applications a ON a.id = e.application_id
      JOIN persons p ON p.id = a.person_id
      LEFT JOIN staffs st ON st.id = e.interviewer_staff_id
     WHERE e.id = $1`, [args.evaluationId])

  if (!target) return { ok: false, reason: 'evaluation_not_found' }
  if (!target.is_active) return { ok: false, reason: 'not_active' }
  if (target.state === 'submitted') return { ok: false, reason: 'already_decided' }
  if (!target.current_staff_id) return { ok: false, reason: 'not_assigned' }
  if (target.current_staff_id === args.staffId) return { ok: false, reason: 'same_staff' }

  // いまの担当を条件に入れる。確認と更新の間に誰かが替えていたら 0 行で終わり、
  // 見ていたのとは違う担当を上書きしない。
  const { rows } = await db.query(`
    UPDATE evaluations SET interviewer_staff_id = $3
     WHERE id = $1 AND interviewer_staff_id = $2 AND state <> 'submitted'
     RETURNING id`, [args.evaluationId, target.current_staff_id, args.staffId])
  if (rows.length === 0) return { ok: false, reason: 'not_assigned' }

  return {
    ok: true,
    applicantName: target.applicant_name,
    stepName: target.step_name,
    previousStaffName: target.current_staff_name ?? '（不明）',
    staffName: staff.display_name,
  }
}

export const REASSIGN_FAILURE_MESSAGE: Record<ReassignFailure, string> = {
  evaluation_not_found: 'その評価は見つからなかった。画面を読み直す。',
  not_assigned: 'まだ担当が決まっていない。「担当を決める」のほうを使う。',
  not_active: 'その応募はもう動いていない。担当を替える必要がない。',
  already_decided: 'その評価はもう判定が済んでいる。担当を替えても評価はやり直せない。',
  same_staff: 'いまと同じ担当が選ばれている。',
  staff_not_available: 'その職員は選べない。非活性化されている可能性がある。',
}

export type ReassignCode = 'reassigned' | ReassignFailure

export const REASSIGN_CODE_MESSAGE: Record<ReassignCode, string> = {
  reassigned: '担当を替えた。',
  ...REASSIGN_FAILURE_MESSAGE,
}

const REASSIGN_CODES = Object.keys(REASSIGN_CODE_MESSAGE) as ReassignCode[]

export const parseReassignCode = (
  value: string | string[] | undefined,
): ReassignCode | null => {
  const v = Array.isArray(value) ? value[0] : value
  return v && REASSIGN_CODES.includes(v as ReassignCode) ? (v as ReassignCode) : null
}

/** 画面に出す言葉。失敗の理由を、運用者が次にやることが分かる形で書く。 */
export const ASSIGN_FAILURE_MESSAGE: Record<AssignFailure, string> = {
  evaluation_not_found: 'その評価は見つからなかった。画面を読み直す。',
  already_assigned: 'すでに担当が決まっている。ほかの人が先に割り当てた。',
  not_active: 'その応募はもう動いていない。担当を決める必要がない。',
  staff_not_available: 'その職員は選べない。非活性化されている可能性がある。',
}

/**
 * 画面へ返す結果コード。
 *
 * `'use server'` のファイルは非同期関数以外を export できないため、
 * 文言はここに置く。コードだけを URL で渡し、**氏名は渡さない**
 * （URL は履歴にもログにも残る）。
 */
export type AssignCode = 'ok' | 'no_staff' | AssignFailure

export const ASSIGN_CODE_MESSAGE: Record<AssignCode, string> = {
  ok: '担当を割り当てた。',
  no_staff: '担当を選んでいない。',
  ...ASSIGN_FAILURE_MESSAGE,
}

const CODES = Object.keys(ASSIGN_CODE_MESSAGE) as AssignCode[]

/** URL から来た値。知らないコードは「何も起きていない」として扱う。 */
export const parseAssignCode = (value: string | string[] | undefined): AssignCode | null => {
  const v = Array.isArray(value) ? value[0] : value
  return v && CODES.includes(v as AssignCode) ? (v as AssignCode) : null
}

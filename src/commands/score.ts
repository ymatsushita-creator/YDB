import { maybeOne, one, type Db } from '../db/client.ts'

/**
 * 1軸だけ、点と根拠を保存する（E2）。
 *
 * `evaluation_scores` の一意制約が `(evaluation_id, criteria_id)` なので、
 * **1軸1行が記録層にとって自然な単位**である。全軸まとめて保存する形にすると、
 * 面接の途中で1つだけ書き留めることができない。
 *
 * ★ **入力の検証をここに書き写していない。**
 *   規則はすべて記録層にある ―― 根拠の空文字禁止（CHECK）、上限の
 *   `scale_max` 参照とステップ・再応募の適用判定（トリガ
 *   `evaluation_scores_validity`）。同じ規則をここにも書くと、片方だけ
 *   直したときに食い違う（C-11）。**保存を試みて、失敗を写して返す。**
 *
 *   写す先は制約名とトリガの文面である。**それが変わればテストが落ちる**
 *   ように、tests/20 で1つずつ実際に踏ませている。
 *
 * ★ ここは上書きしない。すでに点が付いている軸は `already_scored` で返す。
 *   **打ち直しは別の入口**（`correctScore`。E4 / C-133）にしてある ――
 *   同じ関数が「無ければ入れる・あれば直す」を兼ねると、打ち間違いの
 *   二度押しが**訂正として通ってしまい、版が積まれる。**
 */

export type SaveScoreResult =
  | { ok: true; criteriaName: string; score: number }
  | { ok: false; reason: SaveScoreFailure }

export type SaveScoreFailure =
  /** 評価が見つからない。 */
  | 'evaluation_not_found'
  /**
   * いまその評価に点を付けられる状態ではない。
   * 担当が決まっていない・保留・利益相反・応募が動いていない、のいずれか。
   * **どれなのかは画面が別に出す**（理由で分岐しない。原則7）。
   */
  | 'not_evaluatable'
  /** その軸はこの評価に適用されない（別ステップ、または再応募者限定）。 */
  | 'criteria_not_applicable'
  /** すでに点が付いている。打ち直しは `correctScore`（E4）。 */
  | 'already_scored'
  /** 点が範囲外（0 未満、または満点超え）。 */
  | 'score_out_of_range'
  /** 根拠が空。 */
  | 'rationale_blank'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function saveScore(
  db: Db,
  args: { evaluationId: string; criteriaId: string; score: number; rationale: string },
): Promise<SaveScoreResult> {
  if (!UUID.test(args.evaluationId)) return { ok: false, reason: 'evaluation_not_found' }
  if (!UUID.test(args.criteriaId)) return { ok: false, reason: 'criteria_not_applicable' }
  if (!Number.isInteger(args.score)) return { ok: false, reason: 'score_out_of_range' }

  // 操作できる母集団を、画面が「評価する」と言っているものに揃える（C-20）。
  // 担当未割当・保留・利益相反の評価に点を付けられると、ボーダーラインが出している
  // 順序（先に担当を決める・解く・替える）を素通りできてしまう。
  const evaluatable = await maybeOne<{ criteria_name: string | null }>(db, `
    SELECT (SELECT ec.name FROM evaluation_criteria ec WHERE ec.id = $2) AS criteria_name
      FROM v_open_tasks t
     WHERE t.source_id = $1 AND t.kind = 'evaluate'`, [args.evaluationId, args.criteriaId])
  if (!evaluatable) {
    // 評価そのものが無いのか、いま付けられないのかを分ける。
    const exists = await maybeOne(db,
      `SELECT 1 FROM evaluations WHERE id = $1`, [args.evaluationId])
    return { ok: false, reason: exists ? 'not_evaluatable' : 'evaluation_not_found' }
  }
  if (!evaluatable.criteria_name) return { ok: false, reason: 'criteria_not_applicable' }

  try {
    await db.query(`
      INSERT INTO evaluation_scores (evaluation_id, criteria_id, score, rationale)
      VALUES ($1, $2, $3, $4)`,
      [args.evaluationId, args.criteriaId, args.score, args.rationale])
  } catch (e: unknown) {
    return { ok: false, reason: classify(e) }
  }

  return { ok: true, criteriaName: evaluatable.criteria_name, score: args.score }
}

// -------------------------------------------------------------
// 点の訂正（E4。実行⑮。C-133）
// -------------------------------------------------------------

export type CorrectScoreFailure =
  | SaveScoreFailure
  /** まだ点が付いていない。訂正ではなく保存へ回す。 */
  | 'not_scored_yet'
  /** 直した人が選ばれていない、または名簿に無い。 */
  | 'staff_not_found'

export type CorrectScoreResult =
  | { ok: true; criteriaName: string; score: number; revisionNumber: number }
  | { ok: false; reason: CorrectScoreFailure }

/**
 * 付いている点と根拠を打ち直す（E4）。
 *
 * ★ **直せるのは未確定の評価だけ**（0037 に理由を書いた）。
 *   その判定をここに書き写していない ―― `v_open_tasks` の `'evaluate'` が
 *   「担当が決まっていて、判断がまだ下りていない」評価を出しており、
 *   `saveScore` と**同じ門**を通る。門を2つ持つと、片方だけ直したときに
 *   「保存はできないのに訂正はできる」が生まれる。
 *
 * ★ 上書きと履歴は**1つの取引**にする。途中で落ちると
 *   「現在値は変わったのに履歴に無い」が残り、そこから先は履歴が嘘になる
 *   （0031 と同じ理由）。
 *
 * ★ 満点・ステップ・再応募の判定は `evaluation_scores_validity` が
 *   **UPDATE でも**効く。ここで書き写さず、拒否を写して返す（C-25）。
 *
 * ★ 直した人は**自己申告**である（認証が無い。C-85）。名簿に居ることは
 *   確かめるが、それは本人である証拠ではない。
 */
export async function correctScore(
  db: Db,
  args: {
    evaluationId: string
    criteriaId: string
    score: number
    rationale: string
    /** 直した人。画面が選ぶ（自己申告）。 */
    staffId?: string
  },
): Promise<CorrectScoreResult> {
  if (!UUID.test(args.evaluationId)) return { ok: false, reason: 'evaluation_not_found' }
  if (!UUID.test(args.criteriaId)) return { ok: false, reason: 'criteria_not_applicable' }
  if (!Number.isInteger(args.score)) return { ok: false, reason: 'score_out_of_range' }

  const staffId = (args.staffId ?? '').trim() || null
  if (staffId !== null && !UUID.test(staffId)) return { ok: false, reason: 'staff_not_found' }

  // `saveScore` と同じ門。**未確定・担当あり・保留でない・利益相反でない。**
  const evaluatable = await maybeOne<{ criteria_name: string | null }>(db, `
    SELECT (SELECT ec.name FROM evaluation_criteria ec WHERE ec.id = $2) AS criteria_name
      FROM v_open_tasks t
     WHERE t.source_id = $1 AND t.kind = 'evaluate'`, [args.evaluationId, args.criteriaId])
  if (!evaluatable) {
    const exists = await maybeOne(db,
      `SELECT 1 FROM evaluations WHERE id = $1`, [args.evaluationId])
    return { ok: false, reason: exists ? 'not_evaluatable' : 'evaluation_not_found' }
  }
  if (!evaluatable.criteria_name) return { ok: false, reason: 'criteria_not_applicable' }

  if (staffId !== null) {
    const staff = await maybeOne(db,
      `SELECT 1 FROM staffs WHERE id = $1 AND is_active`, [staffId])
    if (!staff) return { ok: false, reason: 'staff_not_found' }
  }

  // まだ点が無いなら、それは訂正ではない。**保存のほうへ回す**
  // （無い値を打ち消した版を作ると、履歴が嘘になる）。
  const current = await maybeOne(db, `
    SELECT 1 FROM evaluation_scores
     WHERE evaluation_id = $1 AND criteria_id = $2`, [args.evaluationId, args.criteriaId])
  if (!current) return { ok: false, reason: 'not_scored_yet' }

  try {
    await db.exec('BEGIN')

    await db.query(`
      UPDATE evaluation_scores SET score = $3, rationale = $4
       WHERE evaluation_id = $1 AND criteria_id = $2`,
    [args.evaluationId, args.criteriaId, args.score, args.rationale])

    // 版番号は既存の最大 + 1。一意制約（0037）が最後の砦である。
    const rev = await one<{ revision_number: number }>(db, `
      INSERT INTO evaluation_score_revisions
          (evaluation_id, criteria_id, revision_number, score, rationale,
           changed_by_staff_id)
      SELECT $1, $2,
             coalesce((SELECT max(r.revision_number) FROM evaluation_score_revisions r
                        WHERE r.evaluation_id = $1 AND r.criteria_id = $2), 0) + 1,
             s.score, s.rationale, $3
        FROM evaluation_scores s
       WHERE s.evaluation_id = $1 AND s.criteria_id = $2
      RETURNING revision_number`, [args.evaluationId, args.criteriaId, staffId])

    await db.exec('COMMIT')
    return {
      ok: true,
      criteriaName: evaluatable.criteria_name,
      score: args.score,
      revisionNumber: rev.revision_number,
    }
  } catch (e: unknown) {
    await db.exec('ROLLBACK')
    return { ok: false, reason: classify(e) }
  }
}

/**
 * 記録層が返した拒否を、画面の言葉に写す。
 *
 * 制約名とトリガの文面に依存する。**依存していることを隠さない** ――
 * 変わればテストが落ちるよう、tests/20 で1つずつ実際に踏ませている。
 * 判定を書き写すよりは、写し間違いがテストで出るほうを選ぶ。
 */
function classify(e: unknown): SaveScoreFailure {
  const message = e instanceof Error ? e.message : String(e)

  if (/evaluation_scores_key|duplicate key/.test(message)) return 'already_scored'
  if (/rationale_not_blank/.test(message)) return 'rationale_blank'
  if (/score_lower|exceeds scale_max/.test(message)) return 'score_out_of_range'
  if (/restricted to reapplicants|belongs to step/.test(message)) {
    return 'criteria_not_applicable'
  }
  // 知らない拒否を「保存できた」に丸めない。呼び出し側が気づける形で返す。
  throw e
}

export const SAVE_SCORE_FAILURE_MESSAGE: Record<SaveScoreFailure, string> = {
  evaluation_not_found: 'その評価は見つからなかった。画面を読み直す。',
  not_evaluatable:
    'いまこの評価に点は付けられない。担当を決める・保留を解く・担当を替える'
    + 'のどれかが先にある。',
  criteria_not_applicable: 'その軸はこの評価には付けられない。',
  already_scored: 'その軸にはすでに点が付いている。打ち直しは「直す」から。',
  score_out_of_range: '点が範囲外である。0 から満点までの整数で入れる。',
  rationale_blank: '根拠が空である。何を見てその点にしたかを書く。',
}

export const CORRECT_SCORE_MESSAGE:
Record<CorrectScoreFailure | 'corrected', string> = {
  ...SAVE_SCORE_FAILURE_MESSAGE,
  corrected: '点と根拠を打ち直した。',
  not_scored_yet: 'その軸にはまだ点が付いていない。訂正ではなく保存で入れる。',
  staff_not_found: '直した人が選ばれていない。',
}

export type SaveScoreCode = 'saved' | 'corrected' | CorrectScoreFailure

export const SAVE_SCORE_CODE_MESSAGE: Record<SaveScoreCode, string> = {
  saved: '点と根拠を保存した。',
  ...SAVE_SCORE_FAILURE_MESSAGE,
  ...CORRECT_SCORE_MESSAGE,
}

const CODES = Object.keys(SAVE_SCORE_CODE_MESSAGE) as SaveScoreCode[]

export const parseSaveScoreCode = (
  value: string | string[] | undefined,
): SaveScoreCode | null => {
  const v = Array.isArray(value) ? value[0] : value
  return v && CODES.includes(v as SaveScoreCode) ? (v as SaveScoreCode) : null
}

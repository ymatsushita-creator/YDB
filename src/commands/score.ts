import { maybeOne, type Db } from '../db/client.ts'

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
 * ★ 上書きしない。すでに点が付いている軸は `already_scored` で返す。
 *   点の訂正（E4）は別の判断である。スコアは再現不能な値として扱われており
 *   （原則2）、上書きの規則を決めずに通せる場所ではない。
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
  /** すでに点が付いている。訂正は E4。 */
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
  // 担当未割当・保留・利益相反の評価に点を付けられると、運転席が出している
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
  already_scored: 'その軸にはすでに点が付いている。',
  score_out_of_range: '点が範囲外である。0 から満点までの整数で入れる。',
  rationale_blank: '根拠が空である。何を見てその点にしたかを書く。',
}

export type SaveScoreCode = 'saved' | SaveScoreFailure

export const SAVE_SCORE_CODE_MESSAGE: Record<SaveScoreCode, string> = {
  saved: '点と根拠を保存した。',
  ...SAVE_SCORE_FAILURE_MESSAGE,
}

const CODES = Object.keys(SAVE_SCORE_CODE_MESSAGE) as SaveScoreCode[]

export const parseSaveScoreCode = (
  value: string | string[] | undefined,
): SaveScoreCode | null => {
  const v = Array.isArray(value) ? value[0] : value
  return v && CODES.includes(v as SaveScoreCode) ? (v as SaveScoreCode) : null
}

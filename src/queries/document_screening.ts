import { all, type Db } from '../db/client.ts'

/**
 * 書類選考の門（依頼者の指示。実行⑰。C-212）。
 *
 * 依頼者の言葉 ――「10点満点で、7点以上を通して。それ以外は要注意ラベル」。
 *
 * ★ 満点と閾値は**ここ1箇所**に置く。画面ごとに書くと、
 *   片方を直したときもう片方が古い基準で判定する。
 *
 * ★ **導出値なので記録層に持たない**（CLAUDE.md）。読むたびに数える。
 *
 * ★ 「まだ点が揃っていない」と「7点未満」は**別物**である。
 *   揃っていない段階で「要注意」と出すと、読む前から落ちて見える。
 */

/** 書類選考の満点。0051 で 16 → 10 になった（依頼者の判断）。 */
export const DOCUMENT_SCREENING_MAX = 10
/** ここ以上で人が読む段へ通す。 */
export const DOCUMENT_SCREENING_PASS = 7

export type GateVerdict =
  /** 7点以上。通す。 */
  | 'pass'
  /** 7点未満。要注意。 */
  | 'watch'
  /** まだ全部の軸に点が付いていない。**落ちたのではない。** */
  | 'incomplete'

export interface DocumentScreeningRow {
  application_id: string
  person_id: string
  person_name: string
  /** 付いている点の合計。 */
  score: number
  /** 満点（軸の合計）。記録から数える ―― 定数と食い違わないように。 */
  scale_max: number
  /** 軸の本数と、点が付いた本数。 */
  criteria_total: number
  scored_count: number
}

/** 判定。**数え方を1箇所に閉じ込める。** */
export const verdictOf = (row: DocumentScreeningRow): GateVerdict => {
  if (row.scored_count < row.criteria_total) return 'incomplete'
  return row.score >= DOCUMENT_SCREENING_PASS ? 'pass' : 'watch'
}

export const VERDICT_LABEL: Record<GateVerdict, string> = {
  pass: '通過',
  watch: '要注意',
  incomplete: '採点中',
}

/**
 * その期の書類選考にいる応募と、いまの点。
 *
 * ★ 点の付いていない軸は数に入れない（0 と書かない）。
 */
export const listDocumentScreening = (
  db: Db, seasonId: string,
): Promise<DocumentScreeningRow[]> =>
  all<DocumentScreeningRow>(db, `
    SELECT a.id AS application_id,
           p.id AS person_id,
           p.family_name || ' ' || p.given_name AS person_name,
           coalesce(sum(sc.score), 0)::int      AS score,
           sum(c.scale_max)::int                AS scale_max,
           count(c.id)::int                     AS criteria_total,
           count(sc.id)::int                    AS scored_count
      FROM evaluations e
      JOIN selection_steps s ON s.id = e.selection_step_id AND s.name = '書類選考'
      JOIN applications a ON a.id = e.application_id
                         AND a.voided_at IS NULL AND a.deleted_at IS NULL
      JOIN persons p ON p.id = a.person_id AND p.deleted_at IS NULL
      JOIN evaluation_criteria c ON c.selection_step_id = s.id
                                AND c.applies_to <> 'reapplicant_only'
      LEFT JOIN evaluation_scores sc ON sc.evaluation_id = e.id AND sc.criteria_id = c.id
     WHERE a.season_id = $1
     GROUP BY a.id, p.id, p.family_name, p.given_name
     ORDER BY 4 DESC, p.family_name`, [seasonId])

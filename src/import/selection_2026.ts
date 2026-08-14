import { Workbook } from './xlsx.ts'

/**
 * 選考まわりの説明文を読む判定（実行⑯。C-160）。
 *
 * 依頼者の指示 ――「評価軸や選考関係はもっと情報を取得して、DBに組み込んで」。
 *
 * 読むのは3枚 ――
 *   `特別選考`      9軸それぞれの**判断の観点**（DB には名前しか無かった）
 *   `013_選考フロー`  段ごとに事務局が何をするか
 *   `募集要項`      応募条件（共通軸／ユース選抜／企業選抜）
 *
 * ★ **要約しない。** 運営が書いた文をそのまま組み立てる。
 *   採点する人が読むのは、この文そのものである。
 * ★ DB に触らない。書き込みは `scripts/import-selection-2026.ts`。
 */

export const SHEET_CRITERIA_DETAIL = '特別選考'
export const SHEET_FLOW = '013_選考フロー'
export const SHEET_REQUIREMENTS = '募集要項'

const clean = (v: string | undefined) => (v ?? '').trim()

/**
 * 軸の説明。
 *
 * 表は「A. 軸名 | 見出しの観点」の行のあとに、観点の続きが**次の行から
 * 1列目に**ぶら下がる形をしている。次の見出し行（`B.` など）まで集める。
 */
export interface CriterionDetail {
  /** `A`〜`I`。表の記号そのまま。 */
  mark: string
  /** 軸の名前（`evaluation_criteria.name` と突き合わせる鍵）。 */
  name: string
  /** 判断の観点。**改行で並べる。** */
  description: string
}

/** 「A. 名前」の形。記号と名前に割る。 */
const MARK = /^([A-I])[.．]\s*(.+)$/

export function planCriterionDetails(book: Workbook): CriterionDetail[] {
  const rows = book.rows(SHEET_CRITERIA_DETAIL)
  const out: CriterionDetail[] = []
  let current: CriterionDetail | null = null

  for (const r of rows) {
    // ★ 見出しが0列目にあるとは限らない（表は列をずらして書かれている）。
    //   **先頭の非空セル**を見出しとして扱う。
    const cells = r.map(clean)
    const at = cells.findIndex((c) => c !== '')
    if (at < 0) continue
    const first = cells[at]!
    const rest = cells.slice(at + 1).filter(Boolean)
    const m = MARK.exec(first.split('\n')[0]!.trim())

    if (m) {
      if (current) out.push(current)
      // 見出しの行に、軸名の続き（改行）と観点が同居していることがある。
      const nameLines = first.split('\n').map((s) => s.trim()).filter(Boolean)
      const name = MARK.exec(nameLines[0]!)![2]!.trim()
      const extra = nameLines.slice(1)
      current = { mark: m[1]!, name, description: [...extra, ...rest].join('\n') }
      continue
    }
    if (!current) continue
    // 見出しでない行は、いまの軸の観点として積む。
    const line = [first, ...rest].filter(Boolean).join(' ')
    if (line) current.description = current.description ? `${current.description}\n${line}` : line
  }
  if (current) out.push(current)

  // 説明が空の軸は返さない（**空文字で上書きしない**）。
  return out.filter((c) => c.description.trim() !== '')
}

/**
 * 段の説明。
 *
 * 選考フロー表は「特別選考フロー」と「通常選考フロー」の2つが縦に並ぶ。
 * どちらも段の名前（`グループ面接` `最終面接` `書類選考`）が1列目に立ち、
 * 「詳細」の列に説明がある。**段の名前で束ねる**（同じ段は改行で足す）。
 */
export interface StepDetail { name: string; description: string }

/** DB の段の名前と、表の書き方の対応。**表の語をこちらで作らない。** */
export const STEP_ALIASES: Record<string, string> = {
  書類選考: '書類選考',
  書類審査: '書類選考',
  グループ面接: 'グループ面接',
  最終面接: '最終面接',
  エントリー: '応募受付',
  特別選考フロー: '特別選考',
}

export function planStepDetails(book: Workbook): StepDetail[] {
  const rows = book.rows(SHEET_FLOW)
  const byStep = new Map<string, string[]>()
  let currentStep: string | null = null

  for (const r of rows) {
    const cells = r.map(clean)
    const head = cells.find((c) => c !== '') ?? ''
    const alias = STEP_ALIASES[head]
    if (alias) currentStep = alias
    if (!currentStep) continue
    // 説明らしい文だけを拾う ―― 「。」で終わる長めの文。
    // 日付・担当者名・制作物名を説明として混ぜない。
    for (const c of cells) {
      if (c.length < 12 || !c.includes('。')) continue
      const list = byStep.get(currentStep) ?? []
      if (!list.includes(c)) list.push(c)
      byStep.set(currentStep, list)
    }
  }

  return [...byStep].map(([name, lines]) => ({ name, description: lines.join('\n') }))
    .filter((s) => s.description.trim() !== '')
}

/** 募集要項の1条文。 */
export interface Requirement { category: string; body: string; sortOrder: number }

export function planRequirements(book: Workbook): Requirement[] {
  const rows = book.rows(SHEET_REQUIREMENTS)
  const out: Requirement[] = []
  let category = ''
  let order = 0

  for (const r of rows) {
    const cells = r.map(clean)
    const first = cells.find((c) => c !== '') ?? ''
    if (first === '') continue
    // 見出し行（「共通軸 | ユース選抜 | 企業選抜」）で束を切り替える。
    if (cells.filter((c) => c !== '').length >= 2 && first.endsWith('軸')) {
      category = first
      order = 0
      continue
    }
    // PJT の設計表は募集**要項**ではない。条件の行だけを採る。
    if (first.startsWith('PJT') || first.includes('枠数') || first.includes('チーム構成')) {
      category = ''
      continue
    }
    if (!category) continue
    for (const c of cells.filter((v) => v !== '')) {
      order += 1
      out.push({ category, body: c, sortOrder: order })
    }
  }

  return out
}

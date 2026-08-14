import { Workbook } from './xlsx.ts'

/**
 * 2期生の応募フォーム回答を読む判定（実行⑯。C-156）。
 *
 * 依頼者の指示 ――「エクセルから、去年の二期生の申請フォームの入力内容を
 * 抽出して、新DBからも見れるようにしろ」。
 *
 * ★ 対象は4枚。**どれも同じ形（1行＝1件の回答）だが、列は少しずつ違う。**
 *   列番号で決め打ちせず、**見出し行を読んで対応させる。**
 *   （追加募集は43列、特別選考枠は32列。決め打ちすると静かにずれる）
 *
 * ★ 値は**そのままの語で**残す。運営の質問文を要約しない ――
 *   質問文そのものが、その回答が何なのかを示している。
 *
 * ★ 置き場所は候補者メモ（0027）。**新しい表を作らない。**
 *   「この人が何を書いて応募したか」は人にぶら下がる事実で、
 *   人の画面で読めることが依頼者の求めた「見れる」である。
 *   `involvement` に出どころを書くので、あとから束ねて取り出せる。
 */

/** 読むシート。**空白まで含めて原本のまま。** */
export const FORM_SHEETS = [
  '2期生応募フォーム(rawdate)',
  '2期生応募フォーム(rawdate) のコピー',
  '【追加募集】2期生応募フォーム(rawdate) ',
  '特別選考枠',
] as const

/** メモの `involvement`（出どころの札）。**人の画面でこの札が見出しになる。** */
export const FORM_INVOLVEMENT = '2期の応募フォーム'

/** 見出しの中で、氏名が入っている列を指す語。 */
const NAME_HEADS = ['お名前', 'おなまえ']

/** 本文へ入れない列（別の場所に既にある・札として使う）。 */
const SKIP_HEADS = ['タイムスタンプ', 'お名前', 'おなまえ（かな）']

/** 1件の回答。 */
export interface FormAnswer {
  sheet: string
  /** 表の行番号（1 始まり）。**氏名の代わりに、これで報告する。** */
  row: number
  fullName: string
  /** 見出しと答えの組。**空の答えは持たない。** */
  entries: Array<{ question: string; answer: string }>
}

const clean = (v: string | undefined) => (v ?? '').trim()

/** 見出し行を探す。「お名前」を含む行が見出しである。 */
export const findHeaderRow = (rows: string[][]): number =>
  rows.findIndex((r) => r.some((c) => NAME_HEADS.some((h) => clean(c).startsWith(h))))

export function planFormAnswers(book: Workbook): FormAnswer[] {
  const out: FormAnswer[] = []

  for (const sheet of FORM_SHEETS) {
    const rows = book.rows(sheet)
    const headRow = findHeaderRow(rows)
    if (headRow < 0) continue
    const head = rows[headRow]!
    const nameCol = head.findIndex((c) => clean(c).startsWith('お名前'))
    if (nameCol < 0) continue

    for (let i = headRow + 1; i < rows.length; i++) {
      const r = rows[i]!
      const fullName = clean(r[nameCol])
      if (!fullName) continue

      const entries: Array<{ question: string; answer: string }> = []
      for (const [col, rawHead] of head.entries()) {
        const question = clean(rawHead)
        if (!question || SKIP_HEADS.some((h) => question.startsWith(h))) continue
        const answer = clean(r[col])
        if (!answer) continue
        entries.push({ question, answer })
      }
      if (entries.length === 0) continue

      out.push({ sheet, row: i + 1, fullName, entries })
    }
  }

  return out
}

/**
 * メモの本文に組み立てる。
 *
 * ★ **切り詰めない。** 回答は300文字級が10問並ぶので、1件で数千文字になる。
 *   `person_notes` の本文は 2000 文字で運用しているので（`BODY_MAX`）、
 *   **超えたら分けて残す**（切ると、切れた先が記録から消える）。
 */
export const BODY_MAX = 2000

export function composeBodies(answer: FormAnswer): string[] {
  const blocks = answer.entries.map((e) => `【${e.question}】\n${e.answer}`)
  const bodies: string[] = []
  let current = ''
  for (const b of blocks) {
    // 1問だけで上限を超える回答は、その1問で1枚にする（それ以上は割らない）。
    if (b.length >= BODY_MAX) {
      if (current) { bodies.push(current); current = '' }
      bodies.push(b.slice(0, BODY_MAX))
      continue
    }
    if (current && current.length + b.length + 2 > BODY_MAX) {
      bodies.push(current)
      current = b
    } else {
      current = current ? `${current}\n\n${b}` : b
    }
  }
  if (current) bodies.push(current)
  return bodies
}

/** 何枚目かを札に書く。1枚なら番号を付けない。 */
export const involvementFor = (index: number, total: number): string =>
  (total <= 1 ? FORM_INVOLVEMENT : `${FORM_INVOLVEMENT}（${index + 1}/${total}）`)

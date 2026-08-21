import { Workbook, serialToDate } from './xlsx.ts'

/**
 * 提携団体リスト（`011_提携団体(学校ゼミ)リスト`）を読む判定（実行⑯。C-153）。
 *
 * 依頼者の指示 ――「2期の団体連携は、3期にも引き継げ」
 * 「勝手に取りこぼしてんじゃねぇよ」。
 *
 * ★★ **取りこぼしの本体はここだった。** ★★
 *
 *   表   179 団体（団体名称がある行）
 *   本番  28 団体
 *
 *   実行⑩の取り込みは `db/private` の旧DBから読んでおり、**この表は
 *   1行も読んでいなかった。** 推薦枠ステイタス（41件）を入れるために
 *   0035 で表まで作ってあるのに、**中身は0件のまま**だった。
 *
 * ★ 団体は**期を持たない**（`partners` に season_id が無い）。
 *   つまり入れた時点で2期にも3期にも同じ団体が居る ―― これが「引き継ぐ」の
 *   実体である。**3期用の複製は作らない**（同じ団体が2行になる）。
 *
 * ★ 期を持つのは推薦枠ステイタス（0035）だけ。**それは2期の事実として入れる。**
 *   3期へ写さない ―― 「2期にアポ実施済み」は3期に起きた出来事ではない。
 *   **引き継ぐのは関係であって、出来事ではない。**
 *
 * ★ 表にあってこの製品に置き場所が無い値は**入れない。** 数だけ報告する。
 *   置き場所を思いつきで作ると、同じ事実が2箇所に載る（0035 と同じ判断）。
 */

/** シート名。**空白まで含めて原本のまま。** */
export const SHEET_PARTNERS = '011_提携団体(学校ゼミ)リスト'

/** 列（0 始まり）。見出しは4行目（0 始まりで 3）。 */
export const PARTNER_COL = {
  headerRow: 3,
  status: 0,
  no: 1,
  name: 2,
  contact: 3,
  department: 4,
  internalOwner: 5,
  partneredOn: 6,
  quota: 7,
  actionLog: 8,
  contactInfo: 9,
  method: 10,
  memo: 11,
  bestTiming: 12,
  relatedStudents: 13,
  remarks: 14,
} as const

/**
 * 表の推薦枠ステイタス → 0035 のマスタの符丁。
 *
 * ★ **運営の語をそのまま対応させる。** 言い換えない（0035 の値は
 *   この4つの語のために作ってある）。表に無い語が来たら対応させず、
 *   未対応として数える ―― 勝手に近い値へ寄せない。
 */
export const STATUS_CODE: Record<string, string> = {
  未連絡: 'not_contacted',
  メール送信済み: 'mailed',
  アポ実施済み: 'met',
  対象外: 'out_of_scope',
}

export interface PartnerRow {
  /** 表の行番号（1 始まり）。**氏名や団体名の代わりに、これで報告する。** */
  row: number
  name: string
  contactName: string | null
  contactEmail: string | null
  /** 提携期日。読めない値は null。**近い日に寄せない。** */
  firstContactDate: string | null
  /** 担当部署。`partners.category` に入れる ―― 表がこの列で団体を仕分けている。 */
  category: string | null
  /** 推薦枠ステイタスの符丁（0035）。表が空、または未対応の語なら null。 */
  statusCode: string | null
  /** 対応させられなかったステイタスの生値。**捨てずに数える。** */
  unmappedStatus: string | null
}

export interface PartnerPlan {
  partners: PartnerRow[]
  /** 値はあるが団体名称が空で、指す手段が無い行。**入れない。** */
  skipped: number
  /** 表にあって、この製品に置き場所が無い値の件数。 */
  unplaced: { label: string; rows: number }[]
}

const clean = (v: string | undefined) => (v ?? '').trim()
const blank = (v: string | undefined) => clean(v) || null

/** 連絡先の欄からメールだけを取り出す。 */
export const emailOf = (contact: string): string | null =>
  /[\w.+-]+@[\w-]+\.[\w.-]+/.exec(contact)?.[0] ?? null

export function planPartners(book: Workbook): PartnerPlan {
  const rows = book.rows(SHEET_PARTNERS)
  const partners: PartnerRow[] = []
  let skipped = 0
  const unplacedCount = new Map<string, number>()
  const countUnplaced = (label: string, v: string | undefined) => {
    if (clean(v)) unplacedCount.set(label, (unplacedCount.get(label) ?? 0) + 1)
  }

  const seen = new Set<string>()
  for (let i = PARTNER_COL.headerRow + 1; i < rows.length; i++) {
    const r = rows[i]!
    const name = clean(r[PARTNER_COL.name])
    if (!name) {
      if (r.some((cell) => clean(cell))) skipped++
      continue
    }
    // 表の中で同じ団体名が2度出ることがある。**名前は一意**（0001 の制約）なので、
    // 先に出たほうを採る。後ろの行で上書きすると、どちらが正かが決まらない。
    if (seen.has(name)) { skipped++; continue }
    seen.add(name)

    const rawStatus = clean(r[PARTNER_COL.status])
    const code = rawStatus ? (STATUS_CODE[rawStatus] ?? null) : null
    const contactInfo = clean(r[PARTNER_COL.contactInfo])

    countUnplaced('アクションログ', r[PARTNER_COL.actionLog])
    countUnplaced('連携方法', r[PARTNER_COL.method])
    countUnplaced('メモ備考', r[PARTNER_COL.memo])
    countUnplaced('最適連絡時期', r[PARTNER_COL.bestTiming])
    countUnplaced('関連するアカデミア生', r[PARTNER_COL.relatedStudents])
    countUnplaced('推薦可能人数', r[PARTNER_COL.quota])
    countUnplaced('社内担当', r[PARTNER_COL.internalOwner])
    countUnplaced('備考', r[PARTNER_COL.remarks])

    partners.push({
      row: i + 1,
      name,
      contactName: blank(r[PARTNER_COL.contact]),
      contactEmail: contactInfo ? emailOf(contactInfo) : null,
      firstContactDate: serialToDate(clean(r[PARTNER_COL.partneredOn])),
      category: blank(r[PARTNER_COL.department]),
      statusCode: code,
      unmappedStatus: rawStatus && !code ? rawStatus : null,
    })
  }

  return {
    partners,
    skipped,
    unplaced: [...unplacedCount].map(([label, rows]) => ({ label, rows }))
      .sort((a, b) => b.rows - a.rows),
  }
}

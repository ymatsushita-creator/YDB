import { Workbook, serialToDate } from './xlsx.ts'

/**
 * 依頼者から受け取った `2期応募管理.xlsx` を読む判定（実行⑫）。
 *
 * ★ **DB に触らない。** 何が入るかを決めるだけで、書き込みは
 *   `scripts/import-approach-2026.ts` が行う（C-61 と同じ分け方）。
 *
 * ★ 依頼者の指示 ――
 *   「false となっている人は去年。なっていない人は今年のアプローチ」
 *
 *   実データで裏を取った。**「面談実施」の欄がある人だけが FALSE/TRUE を持ち**、
 *   欄が無い人は 296 人。欄がある 186 人に合格 32・辞退 2・応募完了 1 が
 *   集中しており、欄が無い 296 人は「対応不要 147・未接触 35」だった。
 *   → **欄あり＝去年（2期）、欄なし＝今年（3期）。**
 *
 * ★ 値を作らない。学年や所属を姓名へ切り分けたり、運営のステータスを
 *   この製品の語へ翻訳したりしない（`HANDOFF.md`「運営の言葉を翻訳して
 *   記録しない」）。翻訳できないものは**そのままの文字列でメモに残す。**
 */

/** 受け取った表のシート名。**空白まで含めて原本のまま。** */
export const SHEET_APPROACH = '003_2期生アプローチリスト '
export const SHEET_INTERVIEW = '005_面談シート'
export const SHEET_CRITERIA = '特別選考'

/** アプローチリストの列（0 始まり）。見出し行は 5 行目にある。 */
export const APPROACH = {
  headerRow: 5,
  referral: 0,
  name: 1,
  kana: 2,
  introducer: 3,
  owner: 4,
  contact: 5,
  affiliation: 6,
  profile: 7,
  affiliationKind: 8,
  course: 9,
  channelMajor: 10,
  channelDetail: 11,
  measure: 12,
  actionLog: 13,
  nextAction: 14,
  handover: 15,
  yomi: 16,
  confidence: 17,
  status: 18,
  statusAug: 19,
  /** ★ この欄が FALSE かどうかで期を決める（依頼者の指示）。 */
  interviewDone: 22,
} as const

/** 面談シートの列。見出し行は 2 行目。 */
export const INTERVIEW = {
  headerRow: 2,
  meetsCondition: 1,
  name: 2,
  kana: 3,
  introducer: 4,
  owner: 5,
  affiliation: 6,
  metOn: 7,
  profile: 8,
  affiliationKind: 9,
  course: 10,
  result: 11,
  confidence: 12,
  /** 判断軸のコメント欄。**列は飛ぶ**（19〜21 は空の列）。 */
  axes: [13, 14, 15, 16, 17, 18, 22, 23, 24],
} as const

/**
 * 判断軸9つ（依頼者の表「特別選考」の基準設計そのまま）。
 *
 * ★ **こちらで言い換えていない。** A〜C は満たすべき前提、
 *   D〜I は「強く評価する条件」として表に並んでいたものである。
 *
 * ★ 満点は決めない ―― 表に点数の定義が無い。面談シートの欄も
 *   「点数＆コメント」と書かれているだけで、実際に入っているのは文章である。
 *   **無い点数を作らない**ので、登録は 4 点満点（既存の面接軸と同じ幅）とし、
 *   点そのものは取り込まない（下の `axisComments` はメモへ入れる）。
 */
export const JUDGEMENT_AXES: Array<{ name: string; kind: 'required' | 'strong' }> = [
  { name: 'NEOの環境を“使い倒せる”時間と覚悟', kind: 'required' },
  { name: 'Be Playfulへの適合', kind: 'required' },
  { name: '他者と事業を進める前提を持っている', kind: 'required' },
  { name: 'すでに「小さく踏み出している」', kind: 'strong' },
  { name: '語るテーマが「自分ごと」', kind: 'strong' },
  { name: 'フィードバック耐性', kind: 'strong' },
  { name: '周囲を巻き込んで“場”を生んだ経験', kind: 'strong' },
  { name: '未完成だが、伸び代が異常', kind: 'strong' },
  { name: 'NEO側が“賭けたい”と思える直感', kind: 'strong' },
]

export interface ApproachPerson {
  /** 表の行番号（1 始まり）。**氏名ではなく行で数える。** */
  row: number
  /** 氏名。**姓と名に切らない**（区切りが無い。C-74 と同じ判断）。 */
  fullName: string
  kana: string | null
  /** 去年（2期）か、今年（3期）か。 */
  cohort: 2 | 3
  /** 期判定に使った表の生値。再取り込み時の訂正にも使う。 */
  interviewDone: string | null
  email: string | null
  /** 表の値のうち、この製品の語へ翻訳できないもの。**そのまま残す。** */
  facts: Array<{ label: string; value: string }>
}

export interface ApproachPlan {
  people: ApproachPerson[]
  /** 期ごとの人数。 */
  byCohort: { 2: number; 3: number }
  /** 氏名以外に値があるのに氏名が空で、指す手段が無い行。**入れない。** */
  skipped: number
}

const clean = (v: string | undefined) => (v ?? '').trim()
const blank = (v: string | undefined) => clean(v) || null

/** 連絡手段の欄からメールだけを取り出す。**それ以外は連絡手段の記録として残す。** */
export const extractEmail = (contact: string): string | null => {
  const m = /[\w.+-]+@[\w-]+\.[\w.-]+/.exec(contact)
  return m ? m[0] : null
}

export function planApproach(book: Workbook): ApproachPlan {
  const rows = book.rows(SHEET_APPROACH)
  const people: ApproachPerson[] = []
  let skipped = 0

  for (let i = APPROACH.headerRow + 1; i < rows.length; i++) {
    const r = rows[i]!
    const fullName = clean(r[APPROACH.name])
    if (!fullName) {
      // 書式だけ残った末尾行は「取り込めなかった応募者」ではない。
      if (r.some((cell) => clean(cell))) skipped++
      continue
    }

    // ★ FALSE だけが2期。それ以外（TRUE・空欄）は3期。
    const cell = clean(r[APPROACH.interviewDone])

    const contact = clean(r[APPROACH.contact])
    const facts: Array<{ label: string; value: string }> = []
    const add = (label: string, value: string) => {
      const v = clean(value)
      if (v) facts.push({ label, value: v })
    }
    add('所属', r[APPROACH.affiliation] ?? '')
    add('所属分類', r[APPROACH.affiliationKind] ?? '')
    add('コース属性', r[APPROACH.course] ?? '')
    add('流入経路（大分類）', r[APPROACH.channelMajor] ?? '')
    add('流入経路（詳細）', r[APPROACH.channelDetail] ?? '')
    add('紹介者', r[APPROACH.introducer] ?? '')
    add('対応者', r[APPROACH.owner] ?? '')
    add('ヨミ', r[APPROACH.yomi] ?? '')
    add('参加確度', r[APPROACH.confidence] ?? '')
    add('応募・対応ステータス', r[APPROACH.status] ?? '')
    add('2026年8月時点ステータス', r[APPROACH.statusAug] ?? '')
    add('属人情報', r[APPROACH.profile] ?? '')
    add('申し送り事項', r[APPROACH.handover] ?? '')
    add('アクションログ', r[APPROACH.actionLog] ?? '')
    add('ネクストアクション', r[APPROACH.nextAction] ?? '')
    if (contact && !extractEmail(contact)) add('連絡手段', contact)
    if (clean(r[APPROACH.interviewDone]) === 'TRUE') add('面談実施', 'あり')

    people.push({
      row: i + 1,
      fullName,
      kana: blank(r[APPROACH.kana]),
      cohort: cell === 'FALSE' ? 2 : 3,
      interviewDone: cell || null,
      email: contact ? extractEmail(contact) : null,
      facts,
    })
  }

  return {
    people,
    byCohort: {
      2: people.filter((p) => p.cohort === 2).length,
      3: people.filter((p) => p.cohort === 3).length,
    },
    skipped,
  }
}

export interface InterviewRecord {
  row: number
  fullName: string
  kana: string | null
  /** 面談日（`YYYY-MM-DD`）。読めない値は null。**近い日に寄せない。** */
  metOn: string | null
  owner: string | null
  result: string | null
  confidence: string | null
  /** 判断軸ごとの所見。**点は入っていない**ので文章のまま持つ。 */
  axisComments: Array<{ axis: string; comment: string }>
}

export function planInterviews(book: Workbook): InterviewRecord[] {
  const rows = book.rows(SHEET_INTERVIEW)
  const out: InterviewRecord[] = []

  for (let i = INTERVIEW.headerRow + 1; i < rows.length; i++) {
    const r = rows[i]!
    const fullName = clean(r[INTERVIEW.name])
    if (!fullName) continue

    const axisComments: Array<{ axis: string; comment: string }> = []
    INTERVIEW.axes.forEach((col, n) => {
      const comment = clean(r[col])
      if (comment) axisComments.push({ axis: JUDGEMENT_AXES[n]!.name, comment })
    })

    out.push({
      row: i + 1,
      fullName,
      kana: blank(r[INTERVIEW.kana]),
      metOn: serialToDate(clean(r[INTERVIEW.metOn])),
      owner: blank(r[INTERVIEW.owner]),
      result: blank(r[INTERVIEW.result]),
      confidence: blank(r[INTERVIEW.confidence]),
      axisComments,
    })
  }
  return out
}

/**
 * 氏名の突き合わせ鍵。
 *
 * ★ **空白を落として比べるだけ。** 姓と名に切らない ――
 *   「架空太郎」は 架空/太郎 とも 架空太/郎 とも読め、切り方が人ごとに
 *   違うと同一人物の判定がその場で崩れる（C-74 で確認済み）。
 *
 * ★ これは**同姓同名を1人に潰す**。それでも氏名で突き合わせるのは、
 *   同じ表の中で二重登録を作るほうが害が大きいからである。
 *   生年月日が届いたら、鍵をそちらへ移す。
 */
export const nameKey = (fullName: string): string =>
  fullName.replace(/[\s　]/g, '')

/** 取り込みの印。**実在の担当者に付け替えていない**（C-75 と同じ）。 */
export const IMPORT_ACTOR = '応募管理表 取り込み'
/** メモの「どう関わったか」（0030）。取り込みだと分かる語にする。 */
export const IMPORT_INVOLVEMENT = '応募管理表からの取り込み'

import { Workbook, serialToDate } from './xlsx.ts'

/**
 * 募集要項・ペルソナ・KPI目標を読む判定（実行⑯。依頼者の指示。C-162）。
 *
 * 依頼者の言葉 ――「2期応募2のエクセルから、要項やペルソナやKPIを
 * 持ってきて新規DBにも実装して、設計は自動でやって」。
 *
 * 読むのは3枚 ――
 *   募集要項            共通軸・選考トラックの比較表・選考基準
 *   015_ペルソナ（NEW）   集客対象の人物像
 *   006_ユース募集施策    施策別／コース別の目標人数と実績
 *
 * ★ 個人情報は1つも扱わない（氏名・連絡先が入る表はここでは読まない）。
 * ★ 要約しない。運営の語をそのまま組み立てる。
 */

export const SHEET_REQUIREMENTS = '募集要項'
export const SHEET_PERSONAS = '015_ペルソナ（NEW）'
export const SHEET_KPI = '006_ユース募集施策'

const clean = (v: string | undefined) => (v ?? '').trim()
const num = (v: string | undefined): number | null => {
  const n = Number(clean(v))
  return Number.isFinite(n) ? n : null
}

// -------------------------------------------------------------
// 募集要項 ―― 共通軸（既存。C-160 から引き継ぎ）
// -------------------------------------------------------------
export interface Requirement { category: string; body: string; sortOrder: number }

/** 共通軸の表（募集要項シートの先頭。ユース選抜／企業選抜の条件）。 */
export function planCommonRequirements(book: Workbook): Requirement[] {
  const rows = book.rows(SHEET_REQUIREMENTS)
  const out: Requirement[] = []
  let category = ''
  let order = 0

  for (const r of rows) {
    const cells = r.map(clean)
    const first = cells.find((c) => c !== '') ?? ''
    if (first === '') continue
    if (cells.filter((c) => c !== '').length >= 2 && first.endsWith('軸')) {
      category = first
      order = 0
      continue
    }
    if (first.startsWith('PJT') || first.includes('枠数') || first.includes('チーム構成')
      || /^[①-⑨0-9１-９]/.test(first) || first.includes('項目')) {
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

// -------------------------------------------------------------
// 募集要項 ―― 選考トラックの比較表（新規。C-162）
//
// 「一般公募_ユース選抜 | 項目 | 地元企業キャリア型 | 起業挑戦キャリア型 | クリエイター枠」
// のような見出し行を探し、以降の行を「項目名: 値」として各トラックへ配る。
//
// ★ 見出し行は「タイトル・項目・トラック名…」、データ行は
//   「（空）・項目名・値・値…」―― **項目名も見出しの「項目」と同じ列**に来る
//   （タイトル列はデータ行では単に空になるだけで、列そのものはずれない）。
// -------------------------------------------------------------
export function planTrackRequirements(book: Workbook): Requirement[] {
  const rows = book.rows(SHEET_REQUIREMENTS)
  const out: Requirement[] = []
  const orderOf = new Map<string, number>()

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!
    const headCol = r.findIndex((c) => clean(c) === '項目')
    if (headCol < 0) continue
    const tracks = r.slice(headCol + 1).map(clean).filter((c) => c !== '')
    if (tracks.length === 0) continue
    const labelCol = headCol

    // 次の見出し行、または空行が2つ続くまでを、このトラック表の範囲とする。
    let blanks = 0
    for (let j = i + 1; j < rows.length; j++) {
      const row = rows[j]!
      if (row.findIndex((c) => clean(c) === '項目') >= 0) break
      const label = clean(row[labelCol])
      const values = tracks.map((_, k) => clean(row[headCol + 1 + k]))
      if (label === '' && values.every((v) => v === '')) {
        blanks += 1
        if (blanks >= 2) break
        continue
      }
      blanks = 0
      if (label === '') continue
      for (const [k, track] of tracks.entries()) {
        const v = values[k]
        if (!v) continue
        const order = (orderOf.get(track) ?? 0) + 1
        orderOf.set(track, order)
        out.push({ category: track, body: `${label}: ${v}`, sortOrder: order })
      }
    }
  }
  return out
}

/**
 * 選考基準（「7. 選考について」の直下）。
 *
 * 見出し語（「選考基準」「応募時に必ず聞く質問（例）」）を目印に探す。
 * 位置では決めない ―― 表の版が変わって行がずれても、見出し語が残っていれば読める。
 */
export function planSelectionRequirements(book: Workbook): Requirement[] {
  const rows = book.rows(SHEET_REQUIREMENTS)
  const HEADS = ['選考基準', '応募時に必ず聞く質問']
  const out: Requirement[] = []
  let category = ''
  let order = 0

  for (const r of rows) {
    const cells = r.map(clean).filter((c) => c !== '')
    const first = cells[0] ?? ''
    if (!first) continue
    if (HEADS.some((h) => first.startsWith(h))) {
      category = first
      order = 0
      continue
    }
    // 次の大見出し（「8. …」のような数字始まり）で範囲を閉じる。
    if (/^[0-9０-９]+[.．]/.test(first)) { category = ''; continue }
    if (!category) continue
    order += 1
    out.push({ category, body: first, sortOrder: order })
  }
  return out
}

// -------------------------------------------------------------
// ペルソナ（015_ペルソナ（NEW））
// -------------------------------------------------------------
export interface Persona {
  segment: string
  name: string
  headcount: number | null
  tagline: string | null
  problem: string | null
  valueProposition: string | null
  features: string | null
  target: string | null
  targetNeeds: string | null
  desiredFeeling: string | null
  guestCandidates: string | null
  exitImage: string | null
}

export function planPersonas(book: Workbook): Persona[] {
  const rows = book.rows(SHEET_PERSONAS)
  const out: Persona[] = []
  let segment = ''

  for (const r of rows) {
    const name = clean(r[1])
    if (!name) continue
    // 「人数」だけの合計行（例: 総数36）は氏名が無いので既に弾かれる。
    if (clean(r[0])) segment = clean(r[0])
    if (!segment) continue

    const guest = [clean(r[10]), clean(r[11])].filter(Boolean).join('\n（参考イベント）')
    out.push({
      segment,
      name,
      headcount: num(r[2]),
      tagline: clean(r[3]) || null,
      problem: clean(r[4]) || null,
      valueProposition: clean(r[5]) || null,
      features: clean(r[6]) || null,
      target: clean(r[7]) || null,
      targetNeeds: clean(r[8]) || null,
      desiredFeeling: clean(r[9]) || null,
      guestCandidates: guest || null,
      exitImage: clean(r[12]) || null,
    })
  }
  return out
}

// -------------------------------------------------------------
// KPI（006_ユース募集施策）
// -------------------------------------------------------------
export interface CourseTarget {
  category: string
  courseLabel: string
  segmentLabel: string | null
  targetAccepted: number | null
  targetApplicants: number | null
  targetBriefing: number | null
  targetReach: number | null
  tactics: Tactic[]
}

export interface Tactic {
  label: string
  briefingActual: number | null
  reachActual: number | null
  progressRatio: number | null
  priority: string | null
  detail: string | null
  startsOn: string | null
  endsOn: string | null
  owner: string | null
  remark: string | null
}

export function planCourseTargets(book: Workbook): CourseTarget[] {
  const rows = book.rows(SHEET_KPI)
  const out: CourseTarget[] = []

  // --- ブロック1: 施策別（先頭の小さい表） ---
  // 「施策別 | イベント集客 | … | 想定合格者 | 応募者 | 説明会 | リーチ数」の並び。
  // 列は [1]区分 [2]コース名 [4]想定合格者 [5]応募者 [6]説明会 [7]リーチ数。
  const b1head = rows.findIndex((r) => clean(r[1]) === '施策別')
  if (b1head >= 0) {
    let category = ''
    for (let i = b1head; i < rows.length; i++) {
      const r = rows[i]!
      const cat = clean(r[1])
      const label = clean(r[2])
      if (cat) category = cat
      if (!label || label === '合計') { if (label === '合計' || (!label && !cat && i > b1head + 1)) break; if (!label) continue }
      if (!category) continue
      out.push({
        category, courseLabel: label, segmentLabel: null,
        targetAccepted: num(r[4]), targetApplicants: num(r[5]),
        targetBriefing: num(r[6]), targetReach: num(r[7]),
        tactics: [],
      })
    }
  }

  // --- ブロック2: コース別（下の詳細表。施策の実績・優先順位つき） ---
  const b2head = rows.findIndex((r) => clean(r[1]) === 'コース別')
  if (b2head >= 0) {
    let courseLabel = ''
    let current: CourseTarget | null = null
    // ★ 見出し行（'コース別' の行）自身に最初のコースの実データが同居している
    //   （'施策別' と同じ形）。見出し行から数える ―― +1 すると最初の行を落とす。
    for (let i = b2head; i < rows.length; i++) {
      const r = rows[i]!
      const cat = clean(r[2])
      const seg = clean(r[3])
      const label = clean(r[9])
      const target = num(r[4])
      if (!cat && !seg && !label && !target) {
        if (clean(r[3]) === '総数') break
        continue
      }
      if (clean(r[3]) === '総数') break
      if (cat) courseLabel = cat
      // 新しいコース区分（想定合格者数が入っている行）が来たら、新しい束を作る。
      if (target !== null) {
        current = {
          category: 'コース別', courseLabel, segmentLabel: seg || null,
          targetAccepted: target, targetApplicants: num(r[5]),
          targetBriefing: num(r[6]), targetReach: num(r[7]),
          tactics: [],
        }
        out.push(current)
      }
      if (label && current) {
        current.tactics.push({
          label,
          briefingActual: num(r[10]),
          reachActual: num(r[11]),
          progressRatio: num(r[12]),
          priority: clean(r[13]) || null,
          detail: clean(r[14]) || null,
          startsOn: serialToDate(clean(r[15])),
          endsOn: serialToDate(clean(r[16])),
          owner: clean(r[17]) || null,
          remark: clean(r[18]) || null,
        })
      }
    }
  }

  return out
}

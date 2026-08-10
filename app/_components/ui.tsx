import type { ReactNode } from 'react'

/**
 * ★ 見出しに添える説明（`note`）は持たない。**依頼者の指示で全画面から外した。**
 *   定義や単位を画面に書き足さない ―― 読む相手は運営であって、
 *   毎回同じ説明を読まされる相手ではない。
 */
export function Card({
  children, title, tint,
}: { children: ReactNode; title?: string; tint?: string }) {
  return (
    <section className={tint ?? 'card-base'}>
      {title && <h2 className="section-title">{title}</h2>}
      {children}
    </section>
  )
}

export function Kpi({
  label, value, meta, tone, fill,
}: {
  label: string
  value: ReactNode
  meta?: ReactNode
  /** `alert` は「0 でないこと自体が問題」の数に使う（止まっている件数など）。 */
  tone?: 'muted' | 'alert'
  /** 0..1 を超えると警告色。定員や目標に対する充足に使う。 */
  fill?: { ratio: number; over?: boolean }
}) {
  return (
    <div className="card-base kpi">
      <span className="kpi-label">{label}</span>
      <span className={`kpi-value${tone ? ` ${tone}` : ''}`}>{value}</span>
      {fill && (
        <meter
          className={`meter${fill.over ? ' over' : fill.ratio >= 1 ? ' good' : ''}`}
          value={Math.min(1, Math.max(0, fill.ratio))}
          min="0"
          max="1"
        />
      )}
      {meta && <span className="kpi-meta">{meta}</span>}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>
}

export const num = (n: number | string | null | undefined) =>
  n === null || n === undefined ? '—' : Number(n).toLocaleString('ja-JP')

export const pct = (a: number, b: number) =>
  b === 0 ? '—' : `${((a / b) * 100).toFixed(1)}%`

/** date 列は UTC 深夜の Date として返る。暦日をそのまま読む。 */
/**
 * `YYYY-MM-DD`。**受け取っていないときは空文字。**
 *
 * 0023 で生年月日が「無いこともある」になった。無いものを
 * 1970-01-01 のような値で埋めない ―― 埋めると嘘の事実が1つ増える。
 */
export const ymd = (d: Date | null | undefined) =>
  (d ? new Date(d).toISOString().slice(0, 10) : '')
export const md = (d: Date) => new Date(d).toISOString().slice(5, 10).replace('-', '/')

/**
 * timestamptz の表示。
 *
 * こちらは実際の瞬間なので、`toISOString()` で切ると UTC の壁時計になり、
 * JST の朝9時より前の出来事が前日に見える。集計側で `jst_date()` を通して
 * 潰した A-1 と同じ間違いを、表示側でやらないようにする。
 * 運用タイムゾーンを明示して書き出す。
 */
const jstFormat = (opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', ...opts })

const DATETIME = jstFormat({
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
})
const DAY = jstFormat({ year: 'numeric', month: '2-digit', day: '2-digit' })

export const jstDateTime = (d: Date | null | undefined) =>
  d ? DATETIME.format(new Date(d)) : '—'
export const jstDay = (d: Date | null | undefined) => (d ? DAY.format(new Date(d)) : '—')

/**
 * 候補者の到達状態タグ。
 *
 * 未応募だけは「接点判定窓の内側にいるか」を併記する。到達状態は年度内の最高到達点、
 * 窓は基準日時点で接点が生きているかで、そもそも別の軸である。
 * ここを1語で済ませると、年度サマリの接点継続中（直近 N 日に接点がある人）と
 * 桁が違うのに同じ名前になり、①の答えが画面ごとに変わる。
 */
export function LevelBadge({
  level, inWindow,
}: { level: string; inWindow?: boolean | null }) {
  if (level === 'accepted') return <span className="badge-tag-green">合格</span>
  if (level === 'applicant') return <span className="badge-tag-blue">応募</span>
  if (inWindow === false) return <span className="badge-tag-gray">未応募・接点休止</span>
  return <span className="badge-tag-purple">未応募・接点継続中</span>
}

/**
 * 未記入の欄。
 *
 * ★ **「記入できるのに空」と「導出できないから空」は別物である。**
 *
 *   未記入   … 電話番号や学部のように、人が入れる欄が空のまま
 *   算出なし … 評価がまだ無いので成績が出ない、規則が無いので確度が出ない
 *
 * 前者だけを赤くする。後者まで赤くすると、**誰も直せないものが
 * 「直すべきもの」として並ぶ。** 画面が催促しているのに手の打ちようがない、
 * という状態を作らない。
 *
 * 色だけで伝えない ―― 赤い欄には必ず「未記入」の文字を置く。
 */
export function Unset() {
  return <span className="unset">未記入</span>
}

/** 記入できる欄の値。空なら未記入として赤く出す。 */
export const filled = (v: string | null | undefined) =>
  v === null || v === undefined || v.trim() === '' ? <Unset /> : v

/** 導出できないだけの空欄。**未記入ではない**ので赤くしない。 */
export function NotDerived({ children }: { children?: ReactNode }) {
  return <span className="not-derived">{children ?? '算出なし'}</span>
}

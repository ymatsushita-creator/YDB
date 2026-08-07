import type { ReactNode } from 'react'
import Link from 'next/link'
import type { Season } from '../../src/queries/dashboard.ts'

export function Card({
  children, title, note, tint,
}: { children: ReactNode; title?: string; note?: string; tint?: string }) {
  return (
    <section className={tint ?? 'card-base'}>
      {title && (
        <h2 className="section-title" style={{ marginBottom: note ? 4 : 12 }}>
          {title}
          {note && <span className="section-note">{note}</span>}
        </h2>
      )}
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
        <div className="meter">
          <div
            className={`meter-fill${fill.over ? ' over' : fill.ratio >= 1 ? ' good' : ''}`}
            style={{ width: `${Math.min(100, Math.max(0, fill.ratio * 100))}%` }}
          />
        </div>
      )}
      {meta && <span className="kpi-meta">{meta}</span>}
    </div>
  )
}

export function SeasonTabs({
  seasons, currentId, basePath,
}: { seasons: Season[]; currentId: string; basePath: string }) {
  return (
    <div className="season-tabs">
      {seasons.map((s) => (
        <Link
          key={s.id}
          href={`${basePath}?season=${s.id}`}
          className={s.id === currentId ? 'pill-tab-active' : 'pill-tab'}
          style={{ padding: '8px 16px', textDecoration: 'none' }}
        >
          {s.is_live && <span className="live-dot" />}
          {s.enrollment_year} 年度
        </Link>
      ))}
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
export const ymd = (d: Date) => new Date(d).toISOString().slice(0, 10)
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
 * 段（林・木・幹）のタグ。
 *
 * 林だけは「窓の内側にいるか」を併記する。段は年度内の最高到達点、
 * 窓は基準日時点で接点が生きているかで、そもそも別の軸である。
 * ここを1語で済ませると、年度サマリの林（直近 N 日に接点がある人）と
 * 桁が違うのに同じ名前になり、①の答えが画面ごとに変わる。
 */
export function LevelBadge({
  level, inWindow,
}: { level: string; inWindow?: boolean | null }) {
  if (level === 'accepted') return <span className="badge-tag-green">幹 合格</span>
  if (level === 'applicant') return <span className="badge-tag-blue">木 応募</span>
  if (inWindow === false) return <span className="badge-tag-gray">林 休眠</span>
  return <span className="badge-tag-purple">林 接点あり</span>
}

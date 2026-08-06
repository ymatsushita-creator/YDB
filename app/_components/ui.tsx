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
  tone?: 'muted'
  /** 0..1 を超えると警告色。定員や目標に対する充足に使う。 */
  fill?: { ratio: number; over?: boolean }
}) {
  return (
    <div className="card-base kpi">
      <span className="kpi-label">{label}</span>
      <span className={`kpi-value${tone === 'muted' ? ' muted' : ''}`}>{value}</span>
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

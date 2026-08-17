import { serialToDate } from './xlsx.ts'

export const EVENT_SHEET = '4月イベント一覧'
export const EVENT_HEADER_ROW = 4

export interface PlannedEvent {
  row: number
  title: string
  days: string[]
  startsAt: string
  endsAt: string
  place: string | null
  owner: string
  url: string | null
  note: string | null
}

const clean = (v: string | undefined) => (v ?? '').trim()

const daysOf = (raw: string, year: number): string[] => {
  const serial = serialToDate(raw)
  if (serial) return [serial]
  return [...raw.matchAll(/(?:^|,)\s*(\d{1,2})\/(\d{1,2})/g)]
    .map((m) => `${year}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}`)
}

const timesOf = (raw: string): [string, string] | null => {
  const m = /(\d{1,2}:\d{2})\s*[~〜－–—-]\s*(\d{1,2}:\d{2})/.exec(raw)
  if (!m) return null
  const normalize = (v: string) => {
    const [h, min] = v.split(':')
    return `${h!.padStart(2, '0')}:${min}`
  }
  return [normalize(m[1]!), normalize(m[2]!)]
}

/** 原本に日付・開始・終了がそろうイベントだけを計画する。 */
export const planEvents = (rows: string[][], year = 2026): {
  ready: PlannedEvent[]
  incomplete: number[]
} => {
  const ready: PlannedEvent[] = []
  const incomplete: number[] = []
  for (const [offset, r] of rows.slice(EVENT_HEADER_ROW).entries()) {
    const row = EVENT_HEADER_ROW + offset + 1
    const title = clean(r[1])
    if (!title) continue
    const days = daysOf(clean(r[2]), year)
    const times = timesOf(clean(r[3]))
    if (days.length === 0 || !times) { incomplete.push(row); continue }
    ready.push({
      row, title, days, startsAt: times[0], endsAt: times[1],
      place: clean(r[4]) || null, owner: clean(r[5]),
      url: clean(r[6]) || null, note: clean(r[7]) || null,
    })
  }
  return { ready, incomplete }
}

import Link from 'next/link'
import type { Appointment } from '../../src/queries/borderline.ts'

/**
 * ボーダーライン画面の部品（実行⑨）。
 *
 * ここに SQL は書かない。数の加工もしない。
 * 渡された事実を、単位と母集団を添えて置くだけにする。
 */

/**
 * 暦日の足し算。
 *
 * ★ `YYYY-MM-DD` を**そのまま暦日として**扱う。時刻を付けて Date にすると、
 *   `T00:00:00+09:00` は UTC では前日15時なので、`toISOString()` で
 *   1日戻る。最初これで週の見出しと格子が1日ずれた。
 *   **暦日の計算にタイムゾーンを往復させない。**
 */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** その週の月曜。週の始まりを画面ごとに決めない。 */
export function mondayOf(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  const back = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
  return addDays(day, -back)
}

const WEEKDAY = ['月', '火', '水', '木', '金', '土', '日']

const HOUR_FROM = 9
const HOUR_TO = 18

const KIND_CLASS: Record<string, string> = {
  first_contact: 'appt-first',
  document_check: 'appt-doc',
  scheduling: 'appt-sched',
  casual: 'appt-casual',
  interview: 'appt-interview',
  internal: 'appt-internal',
}

const jstParts = (d: Date) => {
  const t = new Date(new Date(d).getTime() + 9 * 3600_000)
  return { day: t.toISOString().slice(0, 10), hour: t.getUTCHours(), minute: t.getUTCMinutes() }
}

export const jstTime = (d: Date) => {
  const { hour, minute } = jstParts(d)
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/**
 * 週の日程。
 *
 * ★ 9時〜18時の外にある予定は、格子には置かず**下に別で並べる。**
 *   格子の外へはみ出させると、位置が時刻を表さなくなる
 *   （置き場所が無いものを、近い場所へ寄せてはいけない）。
 */
export function WeekCalendar({
  monday, appointments, today,
}: { monday: string; appointments: Appointment[]; today: string }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  const hours = Array.from({ length: HOUR_TO - HOUR_FROM }, (_, i) => HOUR_FROM + i)

  const placed = appointments.filter((a) => {
    const { hour } = jstParts(a.starts_at)
    return hour >= HOUR_FROM && hour < HOUR_TO
  })
  const outside = appointments.filter((a) => !placed.includes(a))

  return (
    <>
      <div className="cal" style={{ gridTemplateRows: `auto repeat(${hours.length}, 40px)` }}>
        <div className="cal-corner" />
        {days.map((d) => (
          <div key={d} className={`cal-head${d === today ? ' is-today' : ''}`}>
            {d.slice(5).replace('-', '/')}（{WEEKDAY[days.indexOf(d)]}）
          </div>
        ))}
        {hours.map((h) => (
          <div key={h} className="cal-hour" style={{ gridRow: hours.indexOf(h) + 2 }}>
            {String(h).padStart(2, '0')}:00
          </div>
        ))}
        {days.map((d, di) => hours.map((h, hi) => (
          <div
            key={`${d}-${h}`}
            className={`cal-cell${d === today ? ' is-today' : ''}`}
            style={{ gridColumn: di + 2, gridRow: hi + 2 }}
          />
        )))}
        {placed.map((a) => {
          const { day, hour } = jstParts(a.starts_at)
          const di = days.indexOf(day)
          if (di < 0) return null
          const span = Math.max(1, Math.min(
            HOUR_TO - hour,
            Math.round((new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 3600_000),
          ))
          return (
            <div
              key={a.appointment_id}
              className={`cal-event ${KIND_CLASS[a.kind_code] ?? 'appt-internal'}`}
              style={{ gridColumn: di + 2, gridRow: `${hour - HOUR_FROM + 2} / span ${span}` }}
            >
              <strong>{a.person_name ?? a.title}</strong>
              <span>{a.person_name ? a.kind_label : jstTime(a.starts_at)}</span>
            </div>
          )
        })}
      </div>

      {outside.length > 0 && (
        <p className="hh-note">
          {String(HOUR_FROM).padStart(2, '0')}:00〜{HOUR_TO}:00 の外にある予定が
          {outside.length} 件ある（格子には置いていない）:{' '}
          {outside.map((a) => `${jstTime(a.starts_at)} ${a.person_name ?? a.title}`).join(' ・ ')}
        </p>
      )}
    </>
  )
}

/** 順位。上位3位だけ王冠。色に依らず順位が読めるよう数字を必ず出す。 */
export function Rank({ rank }: { rank: number | null }) {
  if (rank === null) return <span className="rank-number dim">—</span>
  return (
    <span className="rank-mark">
      {rank <= 3 && <span className={`rank-crest rank-crest-${rank}`} aria-hidden>♛</span>}
      <span className="rank-number">{rank}</span>
    </span>
  )
}

/** 顔写真。無いときは名前の頭文字を置く（空欄を架空の画像で埋めない）。 */
export function Avatar({ src, name }: { src: string | null; name: string }) {
  const initial = name.replace(/\s/g, '').slice(0, 2)
  return src
    ? <img className="avatar" src={src} alt="" width={36} height={36} />
    : <span className="avatar avatar-fallback" aria-hidden>{initial}</span>
}

export function PersonLink({
  personId, seasonId, children,
}: { personId: string; seasonId: string; children: React.ReactNode }) {
  return (
    <Link href={`/borderline?season=${seasonId}&person=${personId}`}>{children}</Link>
  )
}

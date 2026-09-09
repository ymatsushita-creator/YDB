import Link from 'next/link'
import { getDb } from '../../../src/db/server.ts'
import { defaultSeason, getSeason, listSeasons } from '../../../src/queries/dashboard.ts'
import {
  getCalendarAppointment, listCalendarAttendees, listMonthAppointments,
} from '../../../src/queries/calendar.ts'
import { Breadcrumb, Shell, YearSwitch, seasonLabel } from '../../_components/shell.tsx'
import {
  addMonths, CalendarAttendancePopup, monthBounds, MonthCalendar,
} from '../../_components/calendar.tsx'

export const dynamic = 'force-dynamic'

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const one = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value

export default async function CalendarPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  const db = await getDb()
  const seasons = await listSeasons(db)
  const selected = params.season ? await getSeason(db, params.season) : null
  const season = selected ?? defaultSeason(seasons)

  if (!season) {
    return (
      <Shell active="borderline">
        <p className="hh-empty-shell">年度が1件も登録されていない。</p>
      </Shell>
    )
  }

  const requestedMonth = one(params.month)
  const month = requestedMonth && MONTH.test(requestedMonth)
    ? requestedMonth
    : new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 7)
  const { from, toBefore } = monthBounds(month)
  const appointments = await listMonthAppointments(db, season.id, from, toBefore)
  const requestedAppointment = one(params.appt)
  const appointmentId = requestedAppointment && UUID.test(requestedAppointment)
    ? requestedAppointment
    : null
  const appointment = appointmentId
    ? await getCalendarAppointment(db, appointmentId, season.id)
    : null
  const attendees = appointment
    ? await listCalendarAttendees(db, appointment.appointment_id, season.id)
    : []

  const href = (nextMonth: string, appointmentId?: string) =>
    `/borderline/calendar?${new URLSearchParams({
      season: season.id,
      month: nextMonth,
      ...(appointmentId ? { appt: appointmentId } : {}),
    })}`
  const closeHref = href(month)

  return (
    <Shell
      active="borderline"
      seasonId={season.id}
      years={<YearSwitch seasons={seasons} currentId={season.id} basePath="/borderline/calendar" />}
    >
      <Breadcrumb
        root={seasonLabel(season)}
        crumbs={[
          { label: '通常選考', href: `/borderline?season=${season.id}` },
          { label: '月カレンダー' },
        ]}
      />

      <section className="panel-card month-cal-panel">
        <header className="hh-head">
          <h1>月カレンダー</h1>
          <nav className="bl-week-nav" aria-label="月を移動">
            <Link className="bl-page btn-physical" href={href(addMonths(month, -1))}>‹</Link>
            <Link className="bl-page btn-physical" href={href(
              new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 7),
            )}>今月</Link>
            <Link className="bl-page btn-physical" href={href(addMonths(month, 1))}>›</Link>
          </nav>
        </header>
        <p className="hh-note month-cal-title">{month.replace('-', '年')}月</p>
        {appointments.length === 0 && (
          <p className="hh-empty">この月に登録された予定は無い。</p>
        )}
        <MonthCalendar
          month={month}
          appointments={appointments}
          hrefFor={(id) => href(month, id)}
        />
      </section>

      {appointment && (
        <CalendarAttendancePopup
          appointment={appointment}
          attendees={attendees}
          closeHref={closeHref}
        />
      )}
    </Shell>
  )
}

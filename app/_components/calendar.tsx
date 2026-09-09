import Link from 'next/link'
import type {
  CalendarAppointment, CalendarAppointmentDetail, CalendarAttendee,
} from '../../src/queries/calendar.ts'
import { addDays, jstStamp, Popup } from './borderline.tsx'

const WEEKDAY = ['月', '火', '水', '木', '金', '土', '日']

const dayKey = (value: Date | string) =>
  typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10)

export function monthBounds(month: string): { from: string; toBefore: string } {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number]
  const from = `${String(year).padStart(4, '0')}-${String(monthNumber).padStart(2, '0')}-01`
  const next = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10)
  return { from, toBefore: next }
}

export function addMonths(month: string, amount: number): string {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number]
  return new Date(Date.UTC(year, monthNumber - 1 + amount, 1)).toISOString().slice(0, 7)
}

const mondayOnOrBefore = (day: string) => {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]
  const back = (new Date(Date.UTC(year, month - 1, date)).getUTCDay() + 6) % 7
  return addDays(day, -back)
}

export function MonthCalendar({
  month, appointments, hrefFor,
}: {
  month: string
  appointments: CalendarAppointment[]
  hrefFor: (appointmentId: string) => string
}) {
  const { from, toBefore } = monthBounds(month)
  const first = mondayOnOrBefore(from)
  const lastDay = addDays(toBefore, -1)
  const last = addDays(mondayOnOrBefore(lastDay), 6)
  const count = Math.round(
    (Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000,
  ) + 1
  const days = Array.from({ length: count }, (_, index) => addDays(first, index))
  const byDay = new Map<string, CalendarAppointment[]>()
  for (const appointment of appointments) {
    const key = dayKey(appointment.starts_on)
    byDay.set(key, [...(byDay.get(key) ?? []), appointment])
  }

  return (
    <div className="month-cal-wrap">
      <div className="month-cal">
        {WEEKDAY.map((label) => (
          <div key={label} className="month-cal-weekday">{label}</div>
        ))}
        {days.map((day) => {
          const inMonth = day.startsWith(`${month}-`)
          return (
            <section
              key={day}
              className={`month-cal-day${inMonth ? '' : ' is-outside'}`}
            >
              <time dateTime={day} className="month-cal-date">{Number(day.slice(8))}</time>
              <ul className="month-cal-events">
                {(byDay.get(day) ?? []).map((appointment) => (
                  <li key={appointment.appointment_id}>
                    <Link
                      href={hrefFor(appointment.appointment_id)}
                      className="month-cal-event btn-physical"
                    >
                      <time dateTime={new Date(appointment.starts_at).toISOString()}>
                        {jstStamp(appointment.starts_at).slice(-5)}
                      </time>
                      <strong>{appointment.person_name ?? appointment.title}</strong>
                      <span>{appointment.kind_label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </div>
  )
}

export function CalendarAttendancePopup({
  appointment, attendees, closeHref,
}: {
  appointment: CalendarAppointmentDetail
  attendees: CalendarAttendee[]
  closeHref: string
}) {
  return (
    <Popup
      title={appointment.title}
      closeHref={closeHref}
      subtitle={
        <>
          {jstStamp(appointment.starts_at)} 〜 {jstStamp(appointment.ends_at)}
          {' ・ '}{appointment.kind_label}
          {' ・ '}担当 {appointment.owner_name ?? '未記録'}
          {' ・ '}参加 {attendees.length} 人
        </>
      }
    >
      <div className="scroll-pane popup-body">
        {attendees.length === 0 ? (
          <p className="hh-empty">参加者の記録は無い。</p>
        ) : (
          <ul className="calendar-attendee-list">
            {attendees.map((attendee) => (
              <li key={attendee.attendance_id}>
                <strong>{attendee.person_name}</strong>
                <span className="chip-green">
                  確度 {attendee.grade_code ?? '未記録'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Popup>
  )
}

import { all, maybeOne, type Db } from '../db/client.ts'

export interface CalendarAppointment {
  appointment_id: string
  kind_code: string
  kind_label: string
  title: string
  person_id: string | null
  person_name: string | null
  starts_at: Date
  ends_at: Date
  starts_on: Date
  owner_name: string | null
}

/**
 * ある期・月の予定。単位は予定1件、母集団は v_appointments が公開する有効な予定。
 * 終了日ではなく starts_on で月を決めるため、日をまたいでも開始日の1升だけに載る。
 */
export const listMonthAppointments = (
  db: Db, seasonId: string, fromOn: string, toBefore: string,
) => all<CalendarAppointment>(db, `
  SELECT a.appointment_id, a.kind_code, a.kind_label, a.title,
         a.person_id,
         p.family_name || ' ' || p.given_name AS person_name,
         a.starts_at, a.ends_at, a.starts_on, a.owner_name
    FROM v_appointments a
    LEFT JOIN persons p ON p.id = a.person_id
   WHERE a.season_id = $1
     AND a.starts_on >= $2::date
     AND a.starts_on < $3::date
   ORDER BY a.starts_at, a.appointment_id`, [seasonId, fromOn, toBefore])

export interface CalendarAppointmentDetail {
  appointment_id: string
  title: string
  kind_label: string
  starts_at: Date
  ends_at: Date
  owner_name: string | null
}

/** 単位は予定1件。取消済み等の除外は一覧と同じ v_appointments に従う。 */
export const getCalendarAppointment = (
  db: Db, appointmentId: string, seasonId: string,
) => maybeOne<CalendarAppointmentDetail>(db, `
  SELECT a.appointment_id, a.title, a.kind_label,
         a.starts_at, a.ends_at, a.owner_name
    FROM v_appointments a
   WHERE a.appointment_id = $1
     AND a.season_id = $2`, [appointmentId, seasonId])

export interface CalendarAttendee {
  attendance_id: string
  person_id: string
  person_name: string
  grade_code: string | null
}

/**
 * 単位は参加履歴1件。母集団は v_event_attendance に記録された当該予定の参加者。
 * 候補者一覧では絞らないため、現在その期の母集団から外れた人も履歴として出る。
 */
export const listCalendarAttendees = (
  db: Db, appointmentId: string, seasonId: string,
) => all<CalendarAttendee>(db, `
  SELECT ea.attendance_id, ea.person_id, ea.person_name, c.grade_code
    FROM v_event_attendance ea
    LEFT JOIN v_person_confidence c
           ON c.person_id = ea.person_id AND c.season_id = $2
   WHERE ea.appointment_id = $1
   ORDER BY c.grade_order NULLS LAST, ea.person_name, ea.person_id`,
  [appointmentId, seasonId])

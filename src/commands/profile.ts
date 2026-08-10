import { maybeOne, type Db } from '../db/client.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATA_IMAGE = /^data:image\/(jpeg|png|webp);base64,/

export interface ProfileInput {
  personId: string
  familyName: string
  givenName: string
  familyNameKana: string
  givenNameKana: string
  birthDate: string
  schoolId: string
  faculty: string
  email: string
  phone: string
  lineUserId: string
  referrerPersonId: string
  note: string
  /** undefined は写真を維持、null は削除、文字列は差し替え。 */
  photoDataUrl?: string | null
}

export type ProfileFailure =
  | 'person_not_found' | 'required' | 'bad_email' | 'bad_date'
  | 'school_not_found' | 'bad_referrer' | 'bad_photo' | 'duplicate_line'

export type ProfileResult = { ok: true } | { ok: false; reason: ProfileFailure }

const blankToNull = (value: string) => value.trim() || null

export async function updatePersonProfile(db: Db, input: ProfileInput): Promise<ProfileResult> {
  if (!UUID.test(input.personId)) return { ok: false, reason: 'person_not_found' }
  // ★ 姓だけは要る。無ければその人を指す手段が1つも無い。
  //   名・メール・生年月日は 0023 で「無いこともある」になった ――
  //   旧システムから移した人は持っていない。**必須にすると、
  //   その人のプロフィールを他の項目だけ直すことすらできなくなる。**
  if (!input.familyName.trim()) return { ok: false, reason: 'required' }
  if (input.email.trim() && !/^\S+@\S+\.\S+$/.test(input.email.trim())) {
    return { ok: false, reason: 'bad_email' }
  }
  if (input.birthDate.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(input.birthDate)) {
    return { ok: false, reason: 'bad_date' }
  }
  if (!UUID.test(input.schoolId)) return { ok: false, reason: 'school_not_found' }
  if (input.referrerPersonId && (!UUID.test(input.referrerPersonId) || input.referrerPersonId === input.personId)) {
    return { ok: false, reason: 'bad_referrer' }
  }
  if (input.photoDataUrl !== undefined && input.photoDataUrl !== null && !DATA_IMAGE.test(input.photoDataUrl)) {
    return { ok: false, reason: 'bad_photo' }
  }

  const target = await maybeOne<{ school_ok: boolean; referrer_ok: boolean }>(db, `
    SELECT EXISTS (SELECT 1 FROM schools WHERE id = $2 AND is_active) AS school_ok,
           ($3::uuid IS NULL OR EXISTS (
              SELECT 1 FROM persons WHERE id = $3 AND deleted_at IS NULL
           )) AS referrer_ok
      FROM persons
     WHERE id = $1 AND deleted_at IS NULL`, [
    input.personId, input.schoolId, input.referrerPersonId || null,
  ])
  if (!target) return { ok: false, reason: 'person_not_found' }
  if (!target.school_ok) return { ok: false, reason: 'school_not_found' }
  if (!target.referrer_ok) return { ok: false, reason: 'bad_referrer' }

  try {
    const { rows } = await db.query(`
      WITH next_revision AS (
        SELECT coalesce(max(revision_number), 0) + 1 AS n
          FROM person_profile_revisions WHERE person_id = $1
      ), updated AS (
        UPDATE persons
           SET family_name = btrim($2), given_name = btrim($3),
               family_name_kana = $4, given_name_kana = $5,
               birth_date = $6, school_id = $7, faculty = $8,
               email = nullif(btrim($9), ''), phone = $10, line_user_id = $11,
               referrer_person_id = $12, note = $13,
               photo_data_url = CASE WHEN $14::boolean THEN $15 ELSE photo_data_url END,
               updated_at = now()
         WHERE id = $1 AND deleted_at IS NULL
         RETURNING *
      )
      INSERT INTO person_profile_revisions
        (person_id, revision_number, family_name, given_name, family_name_kana,
         given_name_kana, birth_date, school_id, faculty, email, phone,
         line_user_id, referrer_person_id, note, photo_data_url)
      SELECT u.id, nr.n, u.family_name, u.given_name, u.family_name_kana,
             u.given_name_kana, u.birth_date, u.school_id, u.faculty, u.email,
             u.phone, u.line_user_id, u.referrer_person_id, u.note, u.photo_data_url
        FROM updated u CROSS JOIN next_revision nr
      RETURNING id`, [
      input.personId,
      input.familyName, input.givenName,
      blankToNull(input.familyNameKana), blankToNull(input.givenNameKana),
      blankToNull(input.birthDate), input.schoolId, blankToNull(input.faculty), input.email,
      blankToNull(input.phone), blankToNull(input.lineUserId),
      blankToNull(input.referrerPersonId), blankToNull(input.note),
      input.photoDataUrl !== undefined, input.photoDataUrl ?? null,
    ])
    return rows.length === 1 ? { ok: true } : { ok: false, reason: 'person_not_found' }
  } catch (error) {
    if (String(error).includes('persons_line_user_id_key')) return { ok: false, reason: 'duplicate_line' }
    throw error
  }
}

export async function setPersonApproachState(
  db: Db,
  input: { personId: string; seasonId: string; stateId: string; staffId: string; note: string },
): Promise<ProfileResult> {
  // UUID.test をそのまま渡さない。メソッドが非束縛になり this を失って
  // 「incompatible receiver undefined」で必ず例外になる。
  // 検証のつもりの行が、検証ではなく事故そのものになっていた。
  if (![input.personId, input.seasonId, input.stateId, input.staffId].every((v) => UUID.test(v))) {
    return { ok: false, reason: 'person_not_found' }
  }
  const target = await maybeOne<{ ok: boolean }>(db, `
    SELECT EXISTS (
      SELECT 1 FROM persons p, seasons s, approach_states a, staffs st
       WHERE p.id = $1 AND p.deleted_at IS NULL AND s.id = $2
         AND a.id = $3 AND a.is_active AND st.id = $4 AND st.is_active
    ) AS ok`, [input.personId, input.seasonId, input.stateId, input.staffId])
  if (!target?.ok) return { ok: false, reason: 'person_not_found' }

  await db.query(`
    INSERT INTO approach_events
      (person_id, season_id, approach_state_id, occurred_at, recorded_by_staff_id, note)
    VALUES ($1, $2, $3, now(), $4, $5)`, [
    input.personId, input.seasonId, input.stateId, input.staffId, blankToNull(input.note),
  ])
  return { ok: true }
}

import { maybeOne, type Db } from '../db/client.ts'
import { BLANK_CHARS, blank } from './text.ts'

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

/** 空白だけなら null。集合の定義は text.ts（C-126）。 */
const blankToNull = (value: string) => blank(value)

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
           -- ★ 落とす空白は**制約と同じ集合**にする（C-126）。既定の btrim は
           --   半角空白だけで、全角空白が残っていた ―― 表（スプシ）は落とすので、
           --   同じ文字を打っても記録が違っていた。集合は text.ts の1箇所。
           SET family_name = btrim($2, $16), given_name = btrim($3, $16),
               family_name_kana = $4, given_name_kana = $5,
               birth_date = $6, school_id = $7, faculty = $8,
               email = nullif(btrim($9, $16), ''), phone = $10, line_user_id = $11,
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
      BLANK_CHARS,
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
    VALUES ($1, $2, $3, ${AFTER_LAST_APPROACH}, $4, $5)`, [
    input.personId, input.seasonId, input.stateId, input.staffId, blankToNull(input.note),
  ])
  return { ok: true }
}

/**
 * 新しい出来事を、**同じ人・同じ期の直前の出来事より必ず後ろに置く。**
 *
 * ★ 時計が刻めないほど速く2件入ると、`occurred_at` も `created_at` も
 *   同じ値になり、現在の状態が**id（乱数）で決まる**（C-132 で測った。
 *   PGlite の時計はミリ秒刻みで、続けて打つと普通に同着する）。
 *   置いた順が現在に出ないのは、**あとから置いたほうが負ける**ということである。
 *
 * ★ `greatest` は NULL を無視するので、1件目は `now()` になる。
 *   ずらす幅は1マイクロ秒 ―― 「いつ起きたか」を歪めない最小の幅である。
 */
const AFTER_LAST_APPROACH = `greatest(now(),
    (SELECT max(occurred_at) + interval '1 microsecond' FROM approach_events
      WHERE person_id = $1 AND season_id = $2))`

export type CorrectApproachFailure = ProfileFailure | 'nothing_to_correct'

export type CorrectApproachResult =
  | { ok: true }
  | { ok: false; reason: CorrectApproachFailure }

/**
 * 直近のアプローチ状態を**訂正する**（実行⑮。C-131）。
 *
 * 置き直し（`setPersonApproachState`）との違いは2つ ――
 *
 *   ① 直前の記録を**打ち消す。** 誤った状態が履歴に残って
 *      「その日に動きがあった」ことにならない（0035 の判断と同じ）
 *   ② 見送り（`is_terminal`）を置いてしまっても**戻せる。**
 *      終端の状態は「これ以上こちらから動かさない」なので、
 *      押し間違いを直す道が無いと、その人は二度と一覧に戻らない
 *
 * ★ 打ち消し行には**正しい状態を載せる**（`correctDecision` と同じ形）。
 *   打ち消し行が元に取って代わるので、これが現在の状態になる。
 *
 * ★ 打ち消す相手は**記録層から引く。** 画面が見ていた行を渡させない ――
 *   渡させると、別の期・別の人の行を指す道ができる（0036 も拒む）。
 */
export async function correctApproachState(
  db: Db,
  input: { personId: string; seasonId: string; stateId: string; staffId: string; note: string },
): Promise<CorrectApproachResult> {
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

  // 直近の**有効な**出来事。並びはビューと同じ順で決める
  // ―― 順序が決まらないと、同じ問いに画面ごとに違う答えが出る。
  const last = await maybeOne<{ id: string }>(db, `
    SELECT id FROM v_effective_approach_events
     WHERE person_id = $1 AND season_id = $2
     ORDER BY occurred_at DESC, created_at DESC, id DESC
     LIMIT 1`, [input.personId, input.seasonId])
  // 何も置いていないものは訂正できない。**置くほうへ回す**
  // （無い記録を打ち消した行を作ると、履歴が嘘になる）。
  if (last === null) return { ok: false, reason: 'nothing_to_correct' }

  await db.query(`
    INSERT INTO approach_events
      (person_id, season_id, approach_state_id, occurred_at, recorded_by_staff_id,
       is_correction, corrects_event_id, note)
    VALUES ($1, $2, $3, ${AFTER_LAST_APPROACH}, $4, true, $5, $6)`, [
    input.personId, input.seasonId, input.stateId, input.staffId, last.id,
    blankToNull(input.note),
  ])
  return { ok: true }
}

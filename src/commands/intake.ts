import { maybeOne, one, all, type Db } from '../db/client.ts'
import { BLANK_CHARS, blank as blankText } from './text.ts'

/**
 * 候補者とアプローチを足す（依頼者の指示。実行⑩）。
 *
 * ★ **1回の保存で、5つの事実が同時に立つ。**
 *     ① 人（`persons`）
 *     ② 候補者番号（`candidate_numbers`。期ごとに1から）
 *     ③ 接点（`touchpoints`。どこで知ったか）
 *     ④ アプローチ状態（`approach_events`。初期値は未アプローチ）
 *     ⑤ フォーム回答との接合（あれば）
 *
 *   途中で落ちると「人は居るが番号が無い」「番号はあるが接点が無い」が
 *   残る。**まとめて1つの取引にする。**
 *
 * ★ 足りない値を作らない。生年月日もメールも無いまま登録できる（0023）。
 *
 * ★ **必須は姓だけである**（0054。依頼者の指示 2026-08-24）。
 *   学校・流入元・入力者も未選択で登録できる。学校と流入元は内部結合されて
 *   いるので NULL 可にすると**その人が一覧から黙って消える**（0023）――
 *   記録層は変えず、非活性のプレースホルダ行へ寄せる（下の `PLACEHOLDER`）。
 *   入力者は誰も結合していないので NULL のまま記録する（誰かを作らない）。
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY = /^\d{4}-\d{2}-\d{2}$/
/** 空白だけなら null。集合の定義は text.ts（C-126）。 */
const blank = blankText
const PHOTO = /^data:image\/(jpeg|png|webp);base64,/

/**
 * 未選択のときの寄せ先（0054。依頼者の指示 2026-08-24）。
 *
 * ★ **記録層は変えない。** 学校・流入元・入力者は NOT NULL のままで、
 *   未選択なら非活性のプレースホルダ行へ寄せる。NULL 可にすると内部結合で
 *   **その人が一覧から黙って消える**（0023 が学校について却下済み）。
 * ★ 非活性なので選ぶ画面には出ない。運営が「不明」を選べるようにする話ではない。
 * ★ 行が無ければ寄せられないので、そのときは**今まで通り落とす。**
 *   黙って別の行へ入れない。
 */
export const PLACEHOLDER = {
  school: '学校未記録',
  channel: '流入元不明',
} as const

export const placeholderId = async (
  db: Db, table: 'schools' | 'channels', name: string,
): Promise<string | null> => {
  const row = await maybeOne<{ id: string }>(db,
    `SELECT id FROM ${table} WHERE name = $1`, [name])
  return row?.id ?? null
}

export interface NewCandidateInput {
  seasonId: string
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
  note: string
  photoDataUrl?: string
  /** どこで知ったか。**接点はこのチャネルで積む。** 空なら「流入元不明」（0054）。 */
  channelId: string
  /** 接点の日。空なら今日。 */
  contactedOn: string
  /**
   * 記録した人。認証が無いので画面が選ぶ。**空でよい**（0054）。
   * ★ 空のときは NULL のまま記録する。誰かを作らない。
   * ★ 券は `staffId` を持てるが `app/login/actions.ts` は渡していないので、
   *   「いま入っている職員」に寄せることは今日はできない。
   */
  staffId: string
  /** 接合するフォーム回答。空なら接合しない。 */
  formResponseId: string
}

export type NewCandidateFailure =
  | 'season_not_found' | 'required' | 'bad_email' | 'bad_date'
  | 'school_not_found' | 'channel_not_found' | 'staff_not_found'
  | 'form_response_not_found' | 'form_response_taken' | 'duplicate_line' | 'bad_photo'

export type NewCandidateResult =
  | { ok: true; personId: string; number: number }
  | { ok: false; reason: NewCandidateFailure }

/**
 * 期ごとの次の番号。
 *
 * ★ **欠番を詰めない。** 最大値 + 1 で振る。
 *   空いている番号を埋めると、紙や口頭で番号を言い合っている運用と食い違う
 *   ―― 「3番の子」が2人現れる。
 *
 * ★ 一意制約（`candidate_numbers_season_number_key`）が最後の砦である。
 *   同時に2人登録しても、片方が落ちて番号は重ならない。
 */
export const nextCandidateNumber = async (db: Db, seasonId: string): Promise<number> => {
  const row = await maybeOne<{ next: number }>(db, `
    SELECT coalesce(max(number), 0) + 1 AS next
      FROM candidate_numbers WHERE season_id = $1`, [seasonId])
  return row?.next ?? 1
}

export async function addCandidate(
  db: Db, input: NewCandidateInput,
): Promise<NewCandidateResult> {
  if (!UUID.test(input.seasonId)) return { ok: false, reason: 'season_not_found' }
  // 姓だけは要る。無ければその人を指す手段が1つも無い（0023 と同じ規律）。
  if (!blank(input.familyName)) return { ok: false, reason: 'required' }
  // ★ 学校・流入元・入力者は**任意**（0054）。未選択なら下で寄せ先を引く。
  //   形が違う値が入っているのは未選択ではないので、これは今まで通り落とす。
  const wantSchool = blank(input.schoolId)
  if (wantSchool && !UUID.test(wantSchool)) return { ok: false, reason: 'school_not_found' }
  const wantChannel = blank(input.channelId)
  if (wantChannel && !UUID.test(wantChannel)) return { ok: false, reason: 'channel_not_found' }
  const wantStaff = blank(input.staffId)
  if (wantStaff && !UUID.test(wantStaff)) return { ok: false, reason: 'staff_not_found' }

  const email = blank(input.email)
  if (email && !/^\S+@\S+\.\S+$/.test(email)) return { ok: false, reason: 'bad_email' }
  const birthDate = blank(input.birthDate)
  if (birthDate && !DAY.test(birthDate)) return { ok: false, reason: 'bad_date' }
  const contactedOn = blank(input.contactedOn)
  if (contactedOn && !DAY.test(contactedOn)) return { ok: false, reason: 'bad_date' }
  const photoDataUrl = blank(input.photoDataUrl)
  if (photoDataUrl && !PHOTO.test(photoDataUrl)) return { ok: false, reason: 'bad_photo' }

  const season = await maybeOne(db, `SELECT 1 FROM seasons WHERE id = $1`, [input.seasonId])
  if (!season) return { ok: false, reason: 'season_not_found' }

  // 選ばれていれば実在を確かめ、選ばれていなければ寄せ先を引く。
  // どちらも取れなければ落とす ―― 寄せ先が無いのに別の行へ入れない。
  const schoolId = wantSchool
    ? (await maybeOne(db, `SELECT 1 FROM schools WHERE id = $1`, [wantSchool])
      ? wantSchool : null)
    : await placeholderId(db, 'schools', PLACEHOLDER.school)
  if (!schoolId) return { ok: false, reason: 'school_not_found' }

  const channelId = wantChannel
    ? (await maybeOne(db, `SELECT 1 FROM channels WHERE id = $1`, [wantChannel])
      ? wantChannel : null)
    : await placeholderId(db, 'channels', PLACEHOLDER.channel)
  if (!channelId) return { ok: false, reason: 'channel_not_found' }

  // ★ 入力者は寄せ先を作らない。**未選択なら NULL のまま記録する**（0054）――
  //   「入力者未記録」という職員の行を置くと、本番シードが職員を持たない
  //   という壁（tests/22）と、職員が居ると走る 0007 の引き継ぎ（tests/52）が
  //   両方壊れる。居ない人を作るより、分からないと書くほうが正しい。
  let staffId: string | null = null
  if (wantStaff) {
    if (!await maybeOne(db, `SELECT 1 FROM staffs WHERE id = $1`, [wantStaff])) {
      return { ok: false, reason: 'staff_not_found' }
    }
    staffId = wantStaff
  }

  const formResponseId = blank(input.formResponseId)
  if (formResponseId) {
    if (!UUID.test(formResponseId)) return { ok: false, reason: 'form_response_not_found' }
    const fr = await maybeOne<{ person_id: string | null }>(db,
      `SELECT person_id FROM form_responses WHERE id = $1`, [formResponseId])
    if (!fr) return { ok: false, reason: 'form_response_not_found' }
    // すでに別の人へ結び付いている回答を、黙って付け替えない。
    if (fr.person_id) return { ok: false, reason: 'form_response_taken' }
  }

  try {
    await db.exec('BEGIN')

    // ★ 世界の印は**期から取る**（0029）。デモ期で追加した人は架空の人になる。
    //   ここで付けないと、次の approach_events で境界のトリガに弾かれる ――
    //   弾かれるのは正しいが、原因は「印を付け忘れたこと」のほうである。
    const person = await one<{ id: string }>(db, `
      INSERT INTO persons
        (family_name, given_name, family_name_kana, given_name_kana,
         birth_date, school_id, faculty, email, phone, line_user_id, note, photo_data_url,
         is_demo)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
              (SELECT s.is_demo FROM seasons s WHERE s.id = $13))
      RETURNING id`, [
      blank(input.familyName), blank(input.givenName) ?? '',
      blank(input.familyNameKana), blank(input.givenNameKana),
      birthDate, schoolId, blank(input.faculty), email,
      blank(input.phone), blank(input.lineUserId), blank(input.note), photoDataUrl,
      input.seasonId,
    ])

    const number = await nextCandidateNumber(db, input.seasonId)
    await db.query(`
      INSERT INTO candidate_numbers (season_id, person_id, number)
      VALUES ($1, $2, $3)`, [input.seasonId, person.id, number])

    // 接点。**どこで知ったかは、接点として積む**（流入元の集計はここを見る）。
    await db.query(`
      INSERT INTO touchpoints (person_id, channel_id, occurred_at)
      VALUES ($1, $2, coalesce($3::date, jst_today()))`,
    [person.id, channelId, contactedOn])

    // アプローチ状態の初期値。これが無いと一覧（`v_headhunting_list`）に載らない。
    await db.query(`
      INSERT INTO approach_events
        (person_id, season_id, approach_state_id, occurred_at, recorded_by_staff_id, note)
      SELECT $1, $2, s.id, now(), $3, $4
        FROM approach_states s WHERE s.code = 'not_approached'`,
    [person.id, input.seasonId, staffId, '候補者として登録した'])

    if (formResponseId) {
      await db.query(`
        UPDATE form_responses
           SET person_id = $2, matched_at = now(),
               matched_by_staff_id = $3, match_method = 'manual'
         WHERE id = $1`, [formResponseId, person.id, staffId])
    }

    await db.exec('COMMIT')
    return { ok: true, personId: person.id, number }
  } catch (e: unknown) {
    await db.exec('ROLLBACK')
    const message = e instanceof Error ? e.message : String(e)
    if (/persons_line_user_id_key/.test(message)) {
      return { ok: false, reason: 'duplicate_line' }
    }
    throw e
  }
}

export type AddCandidateCode = 'saved' | NewCandidateFailure

export const ADD_CANDIDATE_MESSAGE: Record<AddCandidateCode, string> = {
  saved: '候補者を登録した。',
  season_not_found: 'その期は見つからなかった。',
  required: '姓は空にできない。',
  bad_email: 'メールの形が違う。',
  bad_date: '日付は YYYY-MM-DD で入れる。',
  // ★ この3つは**未選択では出ない**（0054）。出るのは次のどちらかである ――
  //   ① 形が違う値・実在しない値が入っている（未選択ではない）
  //   ② 未選択だが、寄せ先の行が無い（学校「学校未記録」/ 流入元「流入元不明」）
  //   ②のとき運用者に選ばせても直らないので、「選べ」と言わない。
  school_not_found: 'その学校は選べない。',
  channel_not_found: 'その流入元は選べない。',
  staff_not_found: 'その記録者は選べない。',
  form_response_not_found: 'そのフォーム回答は見つからなかった。',
  form_response_taken: 'そのフォーム回答は、すでに別の人へ結び付いている。',
  duplicate_line: 'その LINE ID は別の人が使っている。',
  bad_photo: '写真は JPEG / PNG / WebP の 2MB 以下。',
}

// -------------------------------------------------------------
// アプローチ（団体への接触）を足す
// -------------------------------------------------------------

export interface NewReachInput {
  /** 既存の団体。空なら `partnerName` で新しく作る。 */
  partnerId: string
  partnerName: string
  category: string
  contactName: string
  contactEmail: string
  /** 接触した日。 */
  occurredOn: string
  method: string
  /** 推定リーチ。**分からなければ空のまま。0 と空は違う。** */
  estimatedReach: string
  note: string
  photoDataUrl?: string
}

export type NewReachFailure =
  | 'partner_required' | 'bad_date' | 'bad_estimate' | 'partner_not_found' | 'bad_photo'

export type NewReachResult =
  | { ok: true; partnerId: string }
  | { ok: false; reason: NewReachFailure }

export async function addPartnerReach(
  db: Db, input: NewReachInput,
): Promise<NewReachResult> {
  const occurredOn = blank(input.occurredOn)
  if (!occurredOn || !DAY.test(occurredOn)) return { ok: false, reason: 'bad_date' }
  const photoDataUrl = blank(input.photoDataUrl)
  if (photoDataUrl && !PHOTO.test(photoDataUrl)) return { ok: false, reason: 'bad_photo' }

  // ★ 空と 0 は違う。「分からない」を 0 にすると「届かなかった」になる。
  const raw = blank(input.estimatedReach)
  let estimated: number | null = null
  if (raw !== null) {
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 0) return { ok: false, reason: 'bad_estimate' }
    estimated = n
  }

  let partnerId = blank(input.partnerId)
  if (partnerId) {
    if (!UUID.test(partnerId)) return { ok: false, reason: 'partner_not_found' }
    const found = await maybeOne(db, `SELECT 1 FROM partners WHERE id = $1`, [partnerId])
    if (!found) return { ok: false, reason: 'partner_not_found' }
  } else {
    const name = blank(input.partnerName)
    if (!name) return { ok: false, reason: 'partner_required' }
    // 同じ名前なら足さない（`partners_name_key`）。
    partnerId = (await one<{ id: string }>(db, `
      INSERT INTO partners (name, category, contact_name, contact_email, photo_data_url)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (name) DO UPDATE SET
        category      = coalesce(partners.category, EXCLUDED.category),
        contact_name  = coalesce(partners.contact_name, EXCLUDED.contact_name),
        contact_email = coalesce(partners.contact_email, EXCLUDED.contact_email),
        photo_data_url = coalesce(partners.photo_data_url, EXCLUDED.photo_data_url)
      RETURNING id`,
    [name, blank(input.category), blank(input.contactName), blank(input.contactEmail), photoDataUrl])).id
  }

  // 年度は日付から決める。どの期にも入らない接触は NULL のまま（寄せない）。
  await db.query(`
    INSERT INTO partner_reaches (partner_id, season_id, occurred_on, method, estimated_reach, note)
    VALUES ($1,
            (SELECT s.id FROM seasons s
              WHERE $2::date BETWEEN s.outreach_start_date AND s.selection_end_date
              ORDER BY s.enrollment_year LIMIT 1),
            $2::date, $3, $4, $5)`,
  [partnerId, occurredOn, blank(input.method), estimated, blank(input.note)])

  return { ok: true, partnerId }
}

export type AddReachCode = 'saved' | NewReachFailure

export const ADD_REACH_MESSAGE: Record<AddReachCode, string> = {
  saved: 'アプローチを記録した。',
  partner_required: '団体を選ぶか、名前を入れる。',
  bad_date: '接触した日は YYYY-MM-DD で入れる。',
  bad_estimate: '推定リーチは 0 以上の整数で入れる。分からなければ空のまま。',
  partner_not_found: 'その団体は見つからなかった。',
  bad_photo: '写真は JPEG / PNG / WebP の 2MB 以下。',
}

// -------------------------------------------------------------
// フォーム回答の取り込みと、自動接合
// -------------------------------------------------------------

export interface FormResponseInput {
  source: string
  formKey: string
  responseKey: string
  submittedAt: string
  respondentName: string
  respondentKana: string
  respondentEmail: string
  respondentPhone: string
  respondentLine: string
  /** 「どこで知ったか」の回答そのまま。 */
  channelAnswer: string
  raw: Record<string, unknown>
}

/**
 * フォーム回答を受け取る。
 *
 * ★ **同じ回答は1件。** `(source, form_key, response_key)` が鍵で、
 *   2回届いても増えない。フォームの連携は再送が普通に起きる。
 *
 * ★ 「どこで知ったか」は、**名前が完全に一致するチャネルだけ**へ写す。
 *   似ている名前へ寄せない ―― 寄せた瞬間、SNS 別の集計が実際と違う値を出す。
 *   写せなければ `channel_answer` に文字列のまま残す。
 */
export async function ingestFormResponse(
  db: Db, input: FormResponseInput,
): Promise<{ ok: true; id: string; matched: boolean }> {
  const answer = blank(input.channelAnswer)
  const channel = answer
    ? await maybeOne<{ id: string }>(db,
      `SELECT id FROM channels WHERE name = $1 AND is_active`, [answer])
    : null

  const row = await one<{ id: string }>(db, `
    INSERT INTO form_responses
      (source, form_key, response_key, submitted_at,
       respondent_name, respondent_kana, respondent_email,
       respondent_phone, respondent_line, channel_id, channel_answer, raw)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
    ON CONFLICT (source, form_key, response_key) DO UPDATE
      SET source = form_responses.source
    RETURNING id`, [
    input.source, input.formKey, input.responseKey, input.submittedAt,
    blank(input.respondentName), blank(input.respondentKana),
    blank(input.respondentEmail), blank(input.respondentPhone),
    blank(input.respondentLine), channel?.id ?? null, answer,
    JSON.stringify(input.raw ?? {}),
  ])

  const matched = await autoMatchFormResponse(db, row.id)
  return { ok: true, id: row.id, matched }
}

/**
 * フォーム回答を、人へ自動で結び付ける。
 *
 * ★ **一致するものが1人だけのときしか結び付けない。**
 *   2人以上に当たったら手で選ばせる。自動で「たぶんこの人」を選ぶと、
 *   別人の記録に回答がぶら下がる。
 *
 * ★ 氏名では結び付けない。同姓同名で確実に取り違える。
 *   使うのは**その人だけが持つ値**（メール・LINE・電話）に限る。
 */
export async function autoMatchFormResponse(db: Db, id: string): Promise<boolean> {
  const r = await maybeOne<{
    person_id: string | null
    respondent_email: string | null
    respondent_line: string | null
    respondent_phone: string | null
  }>(db, `
    SELECT person_id, respondent_email, respondent_line, respondent_phone
      FROM form_responses WHERE id = $1`, [id])
  if (!r || r.person_id) return false

  // ★ 落とす空白は**書き込み側と同じ集合**にする（C-126）。既定の `btrim` は
  //   半角空白だけなので、全角空白が付いたまま入っていた古い値と
  //   突き合わせられない ―― **同じ人が別人に見える。**
  const attempts: Array<[string, string | null, string]> = [
    ['auto_email', r.respondent_email, 'lower(btrim(p.email, $2)) = lower(btrim($1, $2))'],
    ['auto_line', r.respondent_line, 'btrim(p.line_user_id, $2) = btrim($1, $2)'],
    ['auto_phone', r.respondent_phone, 'btrim(p.phone, $2) = btrim($1, $2)'],
  ]

  for (const [method, value, where] of attempts) {
    if (!value) continue
    const hits = await all<{ id: string }>(db, `
      SELECT p.id FROM persons p
       WHERE p.deleted_at IS NULL AND ${where}
       LIMIT 2`, [value, BLANK_CHARS])
    // 2人以上に当たったら結び付けない。**手で選ばせる。**
    if (hits.length !== 1) continue
    await db.query(`
      UPDATE form_responses
         SET person_id = $2, matched_at = now(), match_method = $3
       WHERE id = $1 AND person_id IS NULL`, [id, hits[0]!.id, method])
    return true
  }
  return false
}

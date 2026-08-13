import { maybeOne, type Db } from '../db/client.ts'
import { BLANK_CHARS } from './text.ts'
import { addCandidate, addPartnerReach, ADD_CANDIDATE_MESSAGE } from './intake.ts'
import {
  updatePersonProfile, setPersonApproachState, type ProfileFailure,
} from './profile.ts'
import type { NewReachFailure } from './intake.ts'
import { listCandidateSheetRows, type CandidateSheetRow } from '../queries/sheet.ts'
import {
  setPartnerEngagement, updatePartnerReach, setPartnerRecommendationState,
  SET_ENGAGEMENT_MESSAGE, UPDATE_REACH_MESSAGE, SET_RECOMMENDATION_MESSAGE,
} from './partner.ts'
import {
  addStaff, renameStaff, ADD_STAFF_MESSAGE, RENAME_STAFF_MESSAGE,
} from './staff.ts'

/**
 * 表（スプシ形式）のまとめて保存（依頼者の指示。実行⑫）。
 *
 * ★★ **判定を表のために書き直さない。** ★★
 *   行ごとに既存のコマンドを呼ぶだけである
 *   （`addCandidate` / `updatePersonProfile` / `setPersonApproachState` /
 *    `setPartnerEngagement` / `updatePartnerReach`）。
 *   入口が増えても規則は1つ ―― 採点の入口を2つにしたとき（C-59 / C-63）と同じ扱い。
 *
 * ★ **行ごとに1取引。** 依頼者の判断は「通る行だけ入れて、不正行は表に残す」。
 *   10行のうち1行が不正なだけで9行を捨てると、打ち直しになる。
 *   失敗した行は**入力値のまま画面に残り**、理由が横に出る。
 *
 * ★ 変わっていない行は**触らない。** 空の更新でも履歴（0018）は1版積まれるので、
 *   保存を押すたびに全員分の版が増える ―― 版が増えることは「直した」という
 *   意味を持つので、意味の無い版を作らない。
 *
 * ★ 空の行は無視する。表には空行が残っているのが普通で、
 *   それを「入力漏れ」として毎回赤くすると、本当の失敗が埋もれる。
 */

export interface CandidateRowInput {
  /** 既存行なら人の ID。空なら新規行。 */
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
  note: string
  /** どこで知ったか。**新規行だけ**が使う（接点は積む記録なので直せない）。 */
  channelId: string
  /** 接点の日。空なら今日（`addCandidate` の規則）。 */
  contactedOn: string
  /** アプローチ状態。**既存行だけ**が使う。変えた行だけ新しい状態を積む。 */
  approachStateId: string
  /** 入力者（記録した人）。依頼者の指示で**行ごとの列**。 */
  staffId: string
  /**
   * 結び付けるフォーム回答（列にはしない。行と一緒に運ぶ）。
   * 空なら接合しない。**新規行だけ**が使う。
   */
  formResponseId?: string
}

export type RowResult =
  /**
   * `id` は保存した相手（人・団体・接触）。行に貼り直すために返す。
   * `lead` は行の先頭に出す読み取りの値（候補者番号など）――
   * 保存で初めて決まるものがあるので、返さないと**画面だけ空のまま**になる。
   */
  | { index: number; ok: true; id: string; created: boolean; changed: boolean; lead?: string }
  | { index: number; ok: false; message: string }

export interface SheetSaveResult {
  created: number
  updated: number
  failed: number
  /** 空行を除いた、扱った行の結果。**画面はこれを行に貼り直す。** */
  rows: RowResult[]
}

/** 空白とみなす文字。**記録層の `*_not_blank` 制約と同じ集合**にする（0015）。 */

const t = (v: string | null | undefined) => (v ?? '').trim()
const same = (a: string | null | undefined, b: string | null | undefined) =>
  (t(a) === '' ? '' : t(a)) === (t(b) === '' ? '' : t(b))

/** 新規行が「まだ何も打たれていない」か。選択列も含めて全部空なら空行。 */
const isEmptyNewRow = (r: CandidateRowInput): boolean =>
  [r.familyName, r.givenName, r.familyNameKana, r.givenNameKana, r.birthDate,
    r.schoolId, r.faculty, r.email, r.phone, r.lineUserId, r.note,
    r.channelId, r.contactedOn, r.staffId].every((v) => t(v) === '')

const profileChanged = (row: CandidateRowInput, now: CandidateSheetRow): boolean =>
  !same(row.familyName, now.family_name)
  || !same(row.givenName, now.given_name)
  || !same(row.familyNameKana, now.family_name_kana)
  || !same(row.givenNameKana, now.given_name_kana)
  || !same(row.birthDate, now.birth_date)
  || !same(row.schoolId, now.school_id)
  || !same(row.faculty, now.faculty)
  || !same(row.email, now.email)
  || !same(row.phone, now.phone)
  || !same(row.lineUserId, now.line_user_id)
  || !same(row.note, now.note)

export async function saveCandidateSheet(
  db: Db,
  input: { seasonId: string; rows: CandidateRowInput[] },
): Promise<SheetSaveResult> {
  // 現在値を1回だけ読む。**行ごとに引き直さない**（同じ問いを何度も投げない）。
  const current = new Map<string, CandidateSheetRow>(
    (await listCandidateSheetRows(db, input.seasonId)).map((r) => [r.person_id, r]))

  const rows: RowResult[] = []
  let created = 0
  let updated = 0
  let failed = 0

  for (const [index, row] of input.rows.entries()) {
    const personId = t(row.personId)

    if (personId === '') {
      if (isEmptyNewRow(row)) continue

      const result = await addCandidate(db, {
        seasonId: input.seasonId,
        familyName: row.familyName,
        givenName: row.givenName,
        familyNameKana: row.familyNameKana,
        givenNameKana: row.givenNameKana,
        birthDate: row.birthDate,
        schoolId: row.schoolId,
        faculty: row.faculty,
        email: row.email,
        phone: row.phone,
        lineUserId: row.lineUserId,
        note: row.note,
        channelId: row.channelId,
        contactedOn: row.contactedOn,
        staffId: row.staffId,
        formResponseId: t(row.formResponseId),
      })
      if (!result.ok) {
        rows.push({ index, ok: false, message: ADD_CANDIDATE_MESSAGE[result.reason] })
        failed++
        continue
      }
      // 候補者番号は保存で確定する（出した番号を予約しない）。**画面へ返す。**
      rows.push({
        index, ok: true, id: result.personId, created: true, changed: true,
        lead: String(result.number),
      })
      created++
      continue
    }

    const now = current.get(personId)
    if (!now) {
      // 一覧に無い人の行を受け取らない（画面に出した母集団の外である）。
      rows.push({ index, ok: false, message: 'その候補者はこの期の一覧に居ない。' })
      failed++
      continue
    }

    let changed = false

    if (profileChanged(row, now)) {
      const result = await updatePersonProfile(db, {
        personId,
        familyName: row.familyName,
        givenName: row.givenName,
        familyNameKana: row.familyNameKana,
        givenNameKana: row.givenNameKana,
        birthDate: row.birthDate,
        schoolId: row.schoolId,
        faculty: row.faculty,
        email: row.email,
        phone: row.phone,
        lineUserId: row.lineUserId,
        // ★ 表に出していない列は**現在値をそのまま渡す。**
        //   更新は全列を書くので、空で渡すと紹介者が黙って消える。
        referrerPersonId: now.referrer_person_id ?? '',
        note: row.note,
        // 写真は表から外した（依頼者の指示）。undefined = 維持。
        photoDataUrl: undefined,
      })
      if (!result.ok) {
        rows.push({ index, ok: false, message: PROFILE_MESSAGE[result.reason] })
        failed++
        continue
      }
      changed = true
    }

    const stateId = t(row.approachStateId)
    if (stateId !== '' && stateId !== (now.approach_state_id ?? '')) {
      const result = await setPersonApproachState(db, {
        personId,
        seasonId: input.seasonId,
        stateId,
        staffId: t(row.staffId),
        note: '表から状態を記録した',
      })
      if (!result.ok) {
        rows.push({ index, ok: false, message: PROFILE_MESSAGE[result.reason] })
        failed++
        continue
      }
      changed = true
    }

    rows.push({ index, ok: true, id: personId, created: false, changed })
    if (changed) updated++
  }

  return { created, updated, failed, rows }
}

/**
 * プロフィール更新の言葉。
 *
 * `updatePersonProfile` は言葉を持っていなかった（画面ごとに書いていた）。
 * 表からも同じ理由で落ちるので、**ここ1箇所**に置く。
 */
export const PROFILE_MESSAGE: Record<ProfileFailure, string> = {
  person_not_found: 'その候補者が見つからない。',
  required: '姓は空にできない。',
  bad_email: 'メールの形が違う。',
  bad_date: '日付は YYYY-MM-DD で入れる。',
  school_not_found: '学校を選ぶ。',
  bad_referrer: '紹介者が選べない。',
  bad_photo: '写真は JPEG / PNG / WebP の 2MB 以下。',
  duplicate_line: 'その LINE ID は別の人が使っている。',
}


// -------------------------------------------------------------
// 団体の表
// -------------------------------------------------------------

export interface PartnerRowInput {
  partnerId: string
  category: string
  contactName: string
  contactEmail: string
  /** 先方のどの部署か（0034。応募管理表 011 の「担当部署」）。 */
  contactDepartment: string
  /** NEO 側の受け持ち（0034。応募管理表 011 の「社内担当」）。 */
  internalOwner: string
  /** NEO としてどう関わるか（0031）。 */
  engagement: string
  /** その期の推薦枠ステイタス（0035）。空なら触らない。 */
  recommendationStateId: string
  /** 記録した人（行ごと）。 */
  staffId: string
}

/**
 * 団体の行を保存する。
 *
 * ★ 名前は表で直せない ―― 名前は団体の同一性そのもの（`partners_name_key`）で、
 *   直すと接触記録も集計も全部その団体のものとして繋ぎ直ることになる。
 *   直す必要が出たときは、そのための道を別に作る。
 *
 * ★ 関わり方は現在値なので**変更履歴を積む**（`setPartnerEngagement`）。
 *   分類・窓口はそのまま上書きする ―― 集計に使っていない属性で、
 *   依頼者から履歴の指示も受けていない。**要らない履歴を作らない。**
 */
export async function savePartnerSheet(
  db: Db, input: { rows: PartnerRowInput[]; seasonId?: string },
): Promise<SheetSaveResult> {
  const rows: RowResult[] = []
  let updated = 0
  let failed = 0

  for (const [index, row] of input.rows.entries()) {
    const partnerId = t(row.partnerId)
    if (partnerId === '') continue

    const now = await maybeOne<{
      category: string | null; contact_name: string | null
      contact_email: string | null; engagement: string | null
      contact_department: string | null; internal_owner: string | null
    }>(db, `
      SELECT category, contact_name, contact_email, engagement,
             contact_department, internal_owner
        FROM partners WHERE id = $1`, [partnerId])
    if (!now) {
      rows.push({ index, ok: false, message: SET_ENGAGEMENT_MESSAGE.partner_not_found })
      failed++
      continue
    }

    let changed = false

    if (!same(row.engagement, now.engagement)) {
      const result = await setPartnerEngagement(db, {
        partnerId, engagement: row.engagement, staffId: row.staffId,
      })
      if (!result.ok) {
        rows.push({ index, ok: false, message: SET_ENGAGEMENT_MESSAGE[result.reason] })
        failed++
        continue
      }
      changed = changed || result.changed
    }

    const attrsChanged = !same(row.category, now.category)
      || !same(row.contactName, now.contact_name)
      || !same(row.contactEmail, now.contact_email)
      || !same(row.contactDepartment, now.contact_department)
      || !same(row.internalOwner, now.internal_owner)
    if (attrsChanged) {
      const email = t(row.contactEmail)
      if (email !== '' && !/^\S+@\S+\.\S+$/.test(email)) {
        rows.push({ index, ok: false, message: '窓口のメールの形が違う。' })
        failed++
        continue
      }
      // ★ 落とす空白は**制約と同じ集合**にする（0015）。`btrim` の既定は
      //   半角スペースだけなので、全角スペースだけの値が「空ではない」ものとして
      //   残り、`*_not_blank` に弾かれて**行ごと保存できなくなる。**
      //   （制約を持たない列では、代わりに「見えない値」が静かに溜まる。）
      await db.query(`
        UPDATE partners
           SET category = nullif(btrim($2, $7), ''),
               contact_name = nullif(btrim($3, $7), ''),
               contact_email = nullif(btrim($4, $7), ''),
               contact_department = nullif(btrim($5, $7), ''),
               internal_owner = nullif(btrim($6, $7), '')
         WHERE id = $1`,
      [partnerId, row.category, row.contactName, row.contactEmail,
        row.contactDepartment, row.internalOwner, BLANK_CHARS])
      changed = true
    }

    // 推薦枠ステイタス（0035）。**期ごと**なので、どの期を見ているかが要る。
    // 空欄は「まだ置いていない」であって「未連絡にする」ではない ―― 触らない。
    const wantState = t(row.recommendationStateId)
    if (wantState !== '' && input.seasonId) {
      const result = await setPartnerRecommendationState(db, {
        partnerId, seasonId: input.seasonId,
        stateId: wantState, staffId: row.staffId,
      })
      if (!result.ok) {
        rows.push({ index, ok: false, message: SET_RECOMMENDATION_MESSAGE[result.reason] })
        failed++
        continue
      }
      changed = changed || result.changed
    }

    rows.push({ index, ok: true, id: partnerId, created: false, changed })
    if (changed) updated++
  }

  return { created: 0, updated, failed, rows }
}


// -------------------------------------------------------------
// 接触の表
// -------------------------------------------------------------

export interface ReachRowInput {
  /** 既存行なら接触の ID。空なら新規行。 */
  reachId: string
  occurredOn: string
  method: string
  /** 空は「分からない」。**0 は「届かなかった」**。 */
  estimatedReach: string
  note: string
  staffId: string
}

const isEmptyReachRow = (r: ReachRowInput): boolean =>
  [r.occurredOn, r.method, r.estimatedReach, r.note].every((v) => t(v) === '')

/**
 * その団体の接触記録を保存する。
 *
 * 新規行は `addPartnerReach`（`intake.ts`）と同じ規則で足す ――
 * ただし**団体はこの画面で決まっている**ので、名前から作る経路は使わない。
 */
export async function saveReachSheet(
  db: Db,
  input: { partnerId: string; rows: ReachRowInput[] },
): Promise<SheetSaveResult> {
  const rows: RowResult[] = []
  let created = 0
  let updated = 0
  let failed = 0

  for (const [index, row] of input.rows.entries()) {
    const reachId = t(row.reachId)

    if (reachId === '') {
      if (isEmptyReachRow(row)) continue
      const result = await addPartnerReach(db, {
        partnerId: input.partnerId,
        partnerName: '', category: '', contactName: '', contactEmail: '',
        occurredOn: row.occurredOn,
        method: row.method,
        estimatedReach: row.estimatedReach,
        note: row.note,
      })
      if (!result.ok) {
        rows.push({ index, ok: false, message: REACH_ADD_MESSAGE[result.reason] })
        failed++
        continue
      }
      rows.push({ index, ok: true, id: input.partnerId, created: true, changed: true })
      created++
      continue
    }

    const result = await updatePartnerReach(db, {
      reachId,
      occurredOn: row.occurredOn,
      method: row.method,
      estimatedReach: row.estimatedReach,
      note: row.note,
      staffId: row.staffId,
    })
    if (!result.ok) {
      rows.push({ index, ok: false, message: UPDATE_REACH_MESSAGE[result.reason] })
      failed++
      continue
    }
    rows.push({ index, ok: true, id: reachId, created: false, changed: result.changed })
    if (result.changed) updated++
  }

  return { created, updated, failed, rows }
}

/** 接触を足すときの言葉。`ADD_REACH_MESSAGE` のうち、表で起きうるものだけ。 */
const REACH_ADD_MESSAGE: Record<NewReachFailure, string> = {
  partner_required: '団体が決まっていない。',
  bad_date: '接触した日は YYYY-MM-DD で入れる。',
  bad_estimate: '推定リーチは 0 以上の整数で入れる。分からなければ空のまま。',
  partner_not_found: 'その団体は見つからなかった。',
  bad_photo: '写真は JPEG / PNG / WebP の 2MB 以下。',
}


// -------------------------------------------------------------
// 入力者の表（実行⑬）
// -------------------------------------------------------------

export interface StaffRowInput {
  /** 既存行なら職員の ID。空なら新規行。 */
  staffId: string
  displayName: string
}

/**
 * 入力者の表を保存する（依頼者の指示。実行⑬）。
 *
 * 「面接シート以外のフォームがスプシ形式になっているか」―― `/staff/new` は
 * 1件ずつ足す素のフォームで、**まとめて足せず、打ち間違いも直せなかった。**
 *
 * ★ 判定は既存のコマンド（`addStaff` / `renameStaff`）を行ごとに呼ぶだけ。
 *   表のために規則を書き直さない（この表の他の入口と同じ扱い）。
 *
 * ★ 同じ名前は**止めない**（C-96 の判断のまま）。実在の同姓同名を
 *   登録できなくなるほうが害が大きい。既に居ることは言葉で伝える。
 */
export async function saveStaffSheet(
  db: Db, input: { rows: StaffRowInput[] },
): Promise<SheetSaveResult> {
  const rows: RowResult[] = []
  let created = 0
  let updated = 0
  let failed = 0

  for (const [index, row] of input.rows.entries()) {
    const staffId = t(row.staffId)
    const name = t(row.displayName)

    // 空の行は無視する（表には空行が残っているのが普通）。
    if (staffId === '' && name === '') continue

    if (staffId === '') {
      const result = await addStaff(db, { displayName: name })
      if (!result.ok) {
        rows.push({ index, ok: false, message: ADD_STAFF_MESSAGE[result.reason] })
        failed++
        continue
      }
      rows.push({
        index, ok: true, id: result.staffId, created: true, changed: true,
        lead: result.duplicateName ? '同じ名前が既に居る' : undefined,
      })
      created++
      continue
    }

    const result = await renameStaff(db, { staffId, displayName: name })
    if (!result.ok) {
      rows.push({ index, ok: false, message: RENAME_STAFF_MESSAGE[result.reason] })
      failed++
      continue
    }
    rows.push({
      index, ok: true, id: staffId, created: false, changed: result.changed,
      lead: result.duplicateName ? '同じ名前が既に居る' : undefined,
    })
    if (result.changed) updated++
  }

  return { created, updated, failed, rows }
}

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { intakeWritePath } from './intake-dir.ts'
import { openPostgres } from '../src/db/postgres.ts'
import { openPglite } from '../src/db/pglite.ts'
import { all as allRows, maybeOne, scalar, type Db } from '../src/db/client.ts'
import {
  planImport, legacyFormResponseId, legacyPersonRef, SCHOOL_UNKNOWN,
  collectStaffNames, IMPORT_ACTOR, INITIAL_APPROACH_CODE,
  FINAL_CRITERIA, toRecommendation, NO_RATIONALE,
  type LegacyCandidate, type Supplement, type MissingField,
  type LegacyFinalInterview,
} from '../src/import/legacy_2026.ts'
import {
  collectPartnerReaches, primaryContact, internalHandlers,
  type LegacyPartnership,
} from '../src/import/legacy_partners.ts'
import { isPortOpen } from './guard.ts'

/**
 * 旧 NEO-Youth の 2期を本番へ入れる（実行⑩。依頼者の指示）。
 *
 *   node scripts/import-legacy-2026.ts              突き合わせだけ（既定）
 *   node scripts/import-legacy-2026.ts --worksheet  足りない値を埋める表を書き出す
 *   node scripts/import-legacy-2026.ts --apply      実際に入れる
 *
 * ★ 既定は**書かない。** 何件入って何件入らないかを数で出すだけ。
 *   取り込みは一度きりの操作ではなく、値がそろうたびに何度も走る。
 *   走らせるたびに書かれると、そろっていない段階で中途半端に入る。
 *
 * ★ 出力に個人情報を出さない。
 *   旧IDと件数だけを出す。氏名・メールは**画面にも報告書にも出さない**
 *   （CLAUDE.md）。埋める表 `--worksheet` は氏名を含むので、
 *   リポジトリの外（受領ディレクトリ）にしか書かない。
 *
 * ★ 冪等。応募は `form_response_id`、人は `source_ref`（0023）で重ねない。
 */

const LEGACY_DIR = intakeWritePath('db-private', 'legacy-youthdb-2026-08-07', 'tables')
const SUPPLEMENT_PATH = intakeWritePath('db-private', 'legacy-supplements-2026.json')
const COHORT = 2

const mode = process.argv.includes('--apply') ? 'apply'
  : process.argv.includes('--worksheet') ? 'worksheet'
    : 'report'

const MISSING_LABEL: Record<MissingField, string> = {
  given_name: '名（氏名に姓と名の区切りが無い。姓に氏名まるごとを入れる）',
  birth_date: '生年月日（旧データに列そのものが無い。NULL のまま入れる）',
  email: 'メール（NULL のまま入れる）',
  school: '学校（「学校未記録」へ寄せる）',
}

/** 記録層の列名（欠けているものの名前）→ 補完表の項目名。 */
const FIELD_TO_INPUT: Record<MissingField, keyof Supplement> = {
  given_name: 'givenName',
  birth_date: 'birthDate',
  email: 'email',
  school: 'school',
}

const readJson = async <T>(path: string, fallback: T): Promise<T> => {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (e: unknown) {
    if ((e as { code?: string }).code === 'ENOENT') return fallback
    throw e
  }
}

const rows = await readJson<LegacyCandidate[]>(join(LEGACY_DIR, 'youth_candidates.json'), [])
if (rows.length === 0) {
  console.error(`旧データが読めない: ${LEGACY_DIR}/youth_candidates.json`)
  console.error(`原本はリポジトリの外に置く ―― ${LEGACY_DIR}`)
  process.exit(1)
}

const supplements = await readJson<Record<string, Supplement>>(SUPPLEMENT_PATH, {})
const plan = planImport(rows, supplements)

console.log(`旧 youth_candidates ${rows.length} 件`)
console.log(`補完表 ${Object.keys(supplements).length} 件`
  + (Object.keys(supplements).length === 0 ? `（${SUPPLEMENT_PATH} が無い）` : ''))
console.log('')
console.log(`入る   ${plan.ready.length} 件`
  + (plan.readyWithoutApplication > 0
    ? `（うち ${plan.readyWithoutApplication} 件は応募日が無いので、人だけ入れて応募は作らない）`
    : ''))
console.log(`入らない ${plan.blocked.length} 件（氏名が無い行だけ）`)
console.log('')
console.log('受け取れなかった値（入れたうえで、無いまま残す。重複あり）')
for (const [field, count] of Object.entries(plan.missingCounts) as [MissingField, number][]) {
  if (count > 0) console.log(`  ${String(count).padStart(3)} 件  ${MISSING_LABEL[field]}`)
}

if (mode === 'worksheet') {
  // ★ 氏名を含む。リポジトリの外（受領ディレクトリ）にしか書かない。
  const sheet: Record<string, Supplement & { _name: string; _status: string }> = {}
  for (const b of plan.blocked) {
    const row = rows.find((r) => r.id === b.legacyId)!
    const existing = supplements[String(b.legacyId)] ?? {}
    sheet[String(b.legacyId)] = {
      _name: row.name,
      _status: row.status,
      ...existing,
      // 足りないものだけ空欄で置く。埋まっているものは触らない。
      ...Object.fromEntries(b.missing.map((m) => {
        const key = FIELD_TO_INPUT[m]
        return [key, existing[key] ?? '']
      })),
    }
  }
  // 受け入れディレクトリを新しく用意した環境では db-private/ がまだ無い。
  // backup-file.ts / db-restore.ts と同じく、書く前に作る。
  await mkdir(dirname(SUPPLEMENT_PATH), { recursive: true })
  await writeFile(SUPPLEMENT_PATH, `${JSON.stringify(sheet, null, 2)}\n`, 'utf8')
  console.log('')
  console.log(`埋める表を書き出した: ${SUPPLEMENT_PATH}`)
  console.log('`_name` と `_status` は目印。空欄を埋めて、もう一度この命令を実行する。')
  process.exit(0)
}

if (mode === 'report') {
  console.log('')
  console.log('書き込んでいない。入れるときは --apply を付ける。')
  console.log('足りない値を埋める表が要るときは --worksheet を付ける。')
  process.exit(0)
}

// ---- ここから書き込み ----

// ★ 開発サーバの検査は **PGlite を使うときだけ**。
//   PGlite の dataDir にはプロセス間ロックが無く、同時に開くと黙って壊れる。
//   本番（DATABASE_URL）へ繋ぐときは、その衝突は起きない。
if (!process.env.DATABASE_URL
    && (await isPortOpen(3111) || await isPortOpen(3000) || await isPortOpen(3112))) {
  console.error('開発サーバが動いている。PGlite の dataDir を同時に開くと壊れる。')
  process.exit(1)
}

console.log('')
console.log(process.env.DATABASE_URL
  ? '書き込み先: DATABASE_URL（本番）'
  : '書き込み先: .pgdata（手元の砂場）')

if (plan.ready.length === 0) {
  console.error('')
  console.error('入れられる行が1件も無い。')
  process.exit(1)
}

const db: Db = process.env.DATABASE_URL
  ? await openPostgres(process.env.DATABASE_URL)
  : await openPglite(join(process.cwd(), '.pgdata'))

const seasonId = await maybeOne<{ id: string }>(db,
  `SELECT id FROM seasons WHERE cohort_number = $1`, [COHORT])
if (!seasonId) {
  console.error(`${COHORT}期が登録されていない。先にシードを流す。`)
  await db.close()
  process.exit(1)
}

// -------------------------------------------------------------
// 職員（0024）と、取り込みを表す行
// -------------------------------------------------------------
// ★ アプローチ状態を記録するには職員が要る。本番に1人も居なかった。
//   旧データにある担当者の**氏名だけ**を入れる。メールは作らない。
const staffRows = [
  ...await readJson<Array<Record<string, unknown>>>(
    join(LEGACY_DIR, 'youth_candidates.json'), []),
]
const candidateRows = await readJson<Array<Record<string, unknown>>>(
  join(LEGACY_DIR, 'candidates.json'), [])
const partnershipRows = await readJson<Array<Record<string, unknown>>>(
  join(LEGACY_DIR, 'youth_partnerships.json'), [])

const staffNames = [...new Set([
  ...collectStaffNames(staffRows, ['interview_handler']),
  ...collectStaffNames(candidateRows, ['sec2_evaluator']),
  ...collectStaffNames(partnershipRows, ['internal_handler']),
  // 窓口ごとにも内部担当が居る。**団体直下だけ見ると取りこぼす。**
  ...(partnershipRows as unknown as LegacyPartnership[])
    .flatMap((p) => internalHandlers(p)),
])]

let insertedStaffs = 0
for (const name of staffNames) {
  const existing = await maybeOne(db,
    `SELECT 1 FROM staffs WHERE display_name = $1`, [name])
  if (existing) continue
  await db.query(
    `INSERT INTO staffs (display_name, email) VALUES ($1, NULL)`, [name])
  insertedStaffs += 1
}

// 取り込みが作った行だと分かる名前。**非活性**なので担当の選択肢には出ない。
// `display_name` に一意制約は無いので、探してから作る。
const actorId = (await maybeOne<{ id: string }>(db,
  `SELECT id FROM staffs WHERE display_name = $1`, [IMPORT_ACTOR]))?.id
  ?? await scalar<string>(db, `
    INSERT INTO staffs (display_name, email, is_active)
    VALUES ($1, NULL, false) RETURNING id`, [IMPORT_ACTOR])

const approachStateId = await scalar<string>(db,
  `SELECT id FROM approach_states WHERE code = $1`, [INITIAL_APPROACH_CODE])

let insertedPersons = 0
let existingPersons = 0
let insertedApplications = 0
let existingApplications = 0
let insertedApproach = 0
let insertedNumbers = 0

for (const p of plan.ready) {
  // 学校マスタ。同じ名前なら足さない（schools_name_key）。
  // 分からない人は「学校未記録」（非活性）へ寄せる ―― NULL にすると
  // 9箇所の内部結合で**その人が一覧から黙って消える**（0023）。
  const schoolId = await scalar<string>(db, `
    INSERT INTO schools (name) VALUES ($1)
    ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
    RETURNING id`, [p.school ?? SCHOOL_UNKNOWN])

  // 人。**旧IDで見分ける**（0023 の `source_ref`）。
  // 氏名と生年月日で照合していたが、生年月日が無い人が居るので
  // それだけでは別人と混ざりうる。取り込み元をそのまま鍵にする。
  const ref = legacyPersonRef(p.legacyId)
  const found = await maybeOne<{ id: string }>(db,
    `SELECT id FROM persons WHERE source_ref = $1`, [ref])

  let personId: string
  if (found) {
    personId = found.id
    existingPersons += 1
  } else {
    // ★ `created_at` は旧システムの登録時刻をそのまま使う。
    //   年度の母集団は「選考終了日までに識別されたか」で決まるので、
    //   取り込んだ時刻を入れると**全員がその期の外へ落ちる。**
    personId = await scalar<string>(db, `
      INSERT INTO persons
        (family_name, given_name, family_name_kana, given_name_kana,
         birth_date, school_id, email, source_ref, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, coalesce($9::timestamptz, now()))
      RETURNING id`,
    [p.familyName, p.givenName, p.familyNameKana, p.givenNameKana,
      p.birthDate, schoolId, p.email, ref, p.createdAt])
    insertedPersons += 1
  }

  // ★ アプローチ状態を1件置く。**「未アプローチ」は嘘ではない** ――
  //   この人について、こちらは声掛けの記録を1つも持っていない。
  //   これが無いと `v_headhunting_list` に載らず、
  //   ヘッドハンティングにもボーダーラインにも出てこない。
  const hasApproach = await maybeOne(db, `
    SELECT 1 FROM approach_events WHERE person_id = $1 AND season_id = $2`,
  [personId, seasonId.id])
  if (!hasApproach) {
    await db.query(`
      INSERT INTO approach_events
        (person_id, season_id, approach_state_id, occurred_at,
         recorded_by_staff_id, note)
      VALUES ($1, $2, $3, coalesce($4::timestamptz, now()), $5, $6)`,
    [personId, seasonId.id, approachStateId, p.createdAt, actorId,
      '旧システムから移した。声掛けの記録は無い'])
    insertedApproach += 1
  }

  // ★ 候補者番号（0025）。**識別した順**に振る。
  //   振らないでおくと、追加画面の「次の番号」が 1 から始まり、
  //   すでに 61 人居るのに 1 番が2人になる。
  const hasNumber = await scalar<boolean>(db, `
    SELECT EXISTS (
      SELECT 1 FROM candidate_numbers WHERE person_id = $1 AND season_id = $2)`,
  [personId, seasonId.id])
  if (!hasNumber) {
    await db.query(`
      INSERT INTO candidate_numbers (season_id, person_id, number, assigned_at)
      SELECT $1, $2, coalesce(max(number), 0) + 1, coalesce($3::timestamptz, now())
        FROM candidate_numbers WHERE season_id = $1`,
    [seasonId.id, personId, p.createdAt])
    insertedNumbers += 1
  }

  if (p.submittedAt === null) continue

  const formResponseId = legacyFormResponseId(p.legacyId)
  const app = await maybeOne<{ id: string }>(db,
    `SELECT id FROM applications WHERE form_response_id = $1`, [formResponseId])
  if (app) {
    existingApplications += 1
    continue
  }
  await db.query(`
    INSERT INTO applications (person_id, season_id, submitted_at, form_response_id)
    VALUES ($1, $2, $3, $4)`, [personId, seasonId.id, p.submittedAt, formResponseId])
  insertedApplications += 1
}

// -------------------------------------------------------------
// 最終面接（旧 candidates）
// -------------------------------------------------------------
// ★ 段は**最終面接だけ**入れる。旧データが持っているのはその1段の
//   シートだけで、書類選考・グループ面接の点は記録が無い。
//   無い段の評価を作ると、「まだ誰も見ていない」が「0点で通した」に化ける。
const finalStep = await maybeOne<{ id: string }>(db, `
  SELECT ss.id FROM selection_steps ss
    JOIN seasons se ON se.id = ss.season_id
   WHERE se.cohort_number = $1 AND ss.name = '最終面接'`, [COHORT])

const criteriaIds = new Map<string, string>()
if (finalStep) {
  const rowsC = await allRows<{ id: string; name: string }>(db, `
    SELECT id, name FROM evaluation_criteria WHERE selection_step_id = $1`, [finalStep.id])
  for (const c of rowsC) criteriaIds.set(c.name, c.id)
}

const nameKey = (n: string | null | undefined) =>
  (n ?? '').replace(/[\s　]/g, '')

// 旧 youth_candidates の氏名 → 旧ID。面接シートは氏名でしか結び付かない。
const idByName = new Map<string, number>()
for (const r of rows) idByName.set(nameKey(r.name), r.id)

let insertedEvaluations = 0
let insertedScores = 0
let insertedSheets = 0
let skippedInterviews = 0

if (finalStep && criteriaIds.size > 0) {
  const finals = await readJson<LegacyFinalInterview[]>(
    join(LEGACY_DIR, 'candidates.json'), [])

  for (const f of finals) {
    const legacyId = idByName.get(nameKey(f.name))
    if (legacyId === undefined) { skippedInterviews += 1; continue }

    const person = await maybeOne<{ id: string }>(db,
      `SELECT id FROM persons WHERE source_ref = $1`, [legacyPersonRef(legacyId)])
    const application = person && await maybeOne<{ id: string }>(db,
      `SELECT id FROM applications WHERE form_response_id = $1`,
      [legacyFormResponseId(legacyId)])
    // 応募が無い人には面接を作らない。**評価は応募にぶら下がる。**
    if (!person || !application) { skippedInterviews += 1; continue }

    // 面接官。氏名でしか結び付かないので、居なければ担当なしで入れる。
    const interviewer = await maybeOne<{ id: string }>(db,
      `SELECT id FROM staffs WHERE display_name = $1`, [(f.sec2_evaluator ?? '').trim()])

    let evaluation = await maybeOne<{ id: string }>(db, `
      SELECT id FROM evaluations
       WHERE application_id = $1 AND selection_step_id = $2`,
    [application.id, finalStep.id])

    if (!evaluation) {
      const id = await scalar<string>(db, `
        INSERT INTO evaluations
          (application_id, selection_step_id, interviewer_staff_id,
           state, assigned_at, submitted_at)
        VALUES ($1, $2, $3, 'submitted',
                coalesce($4::timestamptz, now()), coalesce($4::timestamptz, now()))
        RETURNING id`,
      [application.id, finalStep.id, interviewer?.id ?? null, f.created_at])
      evaluation = { id }
      insertedEvaluations += 1
    }

    // 6軸の点。**根拠は旧データに無い**ので、無いことをそのまま書く。
    for (const c of FINAL_CRITERIA) {
      const criteriaId = criteriaIds.get(c.name)
      const score = f[c.column] as number | null
      if (!criteriaId || typeof score !== 'number') continue
      const already = await maybeOne(db, `
        SELECT 1 FROM evaluation_scores
         WHERE evaluation_id = $1 AND criteria_id = $2`, [evaluation.id, criteriaId])
      if (already) continue
      await db.query(`
        INSERT INTO evaluation_scores (evaluation_id, criteria_id, score, rationale)
        VALUES ($1, $2, $3, $4)`, [evaluation.id, criteriaId, score, NO_RATIONALE])
      insertedScores += 1
    }

    // 面接シート。**面接日は入れない** ―― 旧 `final_date` は
    // 「4/9(木) 14:00 - 14:30」「電話出ない」など、日付でない値が混ざる。
    const hasSheet = await maybeOne(db,
      `SELECT 1 FROM interview_sheets WHERE evaluation_id = $1`, [evaluation.id])
    if (!hasSheet) {
      const recommendation = toRecommendation(f.overall)
      const blank = (v: string | null) => ((v ?? '').trim() || null)
      const sheetId = await scalar<string>(db, `
        INSERT INTO interview_sheets
          (evaluation_id, first_impression, check_point_notes, strengths, concerns,
           overall_comment, recommendation)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [evaluation.id, blank(f.sec2_comment), blank(f.check_points),
        blank(f.strengths), blank(f.concerns), blank(f.overall_comment),
        recommendation || null])
      await db.query(`
        INSERT INTO interview_sheet_revisions
          (sheet_id, evaluation_id, revision_number, first_impression,
           check_point_notes, strengths, concerns, overall_comment,
           recommendation, changed_by_staff_id, changed_at)
        VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, coalesce($10::timestamptz, now()))`,
      [sheetId, evaluation.id, blank(f.sec2_comment), blank(f.check_points),
        blank(f.strengths), blank(f.concerns), blank(f.overall_comment),
        recommendation || null, actorId, f.created_at])
      insertedSheets += 1
    }
  }
}

// -------------------------------------------------------------
// 関連団体（旧 youth_partnerships。依頼者の指示）
// -------------------------------------------------------------
// ★ 推定リーチ（何人に届いたか）は旧データに無い。**作らない。**
//   `estimated_reach` は NULL のまま ―― 0 を入れると
//   「届かなかった」という別の事実になる。
const partnerships = (await readJson<LegacyPartnership[]>(
  join(LEGACY_DIR, 'youth_partnerships.json'), []))
  .filter((p) => !p.deleted_at && (p.university ?? '').trim())

let insertedPartners = 0
let insertedReaches = 0

for (const lp of partnerships) {
  const name = lp.university.trim()
  const contact = primaryContact(lp)

  // `partners` は名前が一意。同じ団体を2回作らない。
  // ★ 追加したかどうかは**入れる前に**見る。入れた後に
  //   「接触記録があるか」で判定していたら、2周目に複数行が返って落ちた。
  const before = await maybeOne<{ id: string }>(db,
    `SELECT id FROM partners WHERE name = $1`, [name])
  const partnerId = await scalar<string>(db, `
    INSERT INTO partners (name, contact_name, contact_email)
    VALUES ($1, $2, $3)
    ON CONFLICT (name) DO UPDATE SET
      contact_name  = coalesce(partners.contact_name, EXCLUDED.contact_name),
      contact_email = coalesce(partners.contact_email, EXCLUDED.contact_email)
    RETURNING id`, [name, contact.name, contact.email])
  if (!before) insertedPartners += 1

  // 接触記録。**同じ日・同じ内容は1件**（旧データは2箇所に同じ物を持つ）。
  for (const r of collectPartnerReaches(lp)) {
    // ★ 件数で見ない。**同じ日・同じ内容の行が複数あっても1件と数える。**
    //   `maybeOne` は2行目で落ちる（実際それで2周目が止まった）。
    const dup = await scalar<boolean>(db, `
      SELECT EXISTS (
        SELECT 1 FROM partner_reaches
         WHERE partner_id = $1 AND occurred_on = $2::date
           AND coalesce(note, '') = $3)`, [partnerId, r.occurredOn, r.note])
    if (dup) continue
    // 年度は日付から決める。どの期の期間にも入らない接触は NULL のまま
    // （**近い期へ寄せない**）。
    await db.query(`
      INSERT INTO partner_reaches (partner_id, season_id, occurred_on, note)
      VALUES ($1,
              (SELECT s.id FROM seasons s
                WHERE $2::date BETWEEN s.outreach_start_date AND s.selection_end_date
                ORDER BY s.enrollment_year LIMIT 1),
              $2::date, $3)`, [partnerId, r.occurredOn, r.note || null])
    insertedReaches += 1
  }
}

console.log('')
console.log(`職員 追加 ${insertedStaffs} 件（旧データの担当者名。メールは無い）`)
console.log(`人   追加 ${insertedPersons} 件 ・ すでに居た ${existingPersons} 件`)
console.log(`応募 追加 ${insertedApplications} 件 ・ すでに有った ${existingApplications} 件`)
console.log(`アプローチ状態 追加 ${insertedApproach} 件（すべて「未アプローチ」）`)
console.log(`候補者番号 追加 ${insertedNumbers} 件（識別した順に1から）`)
console.log(`関連団体 追加 ${insertedPartners} 件 ・ 接触記録 ${insertedReaches} 件`
  + '（推定リーチは旧データに無いので空のまま）')
console.log(`最終面接 追加 ${insertedEvaluations} 件 ・ 点 ${insertedScores} 件`
  + ` ・ 面接シート ${insertedSheets} 件`
  + (skippedInterviews > 0 ? ` ・ 見送り ${skippedInterviews} 件（応募が無い）` : ''))
console.log('')
console.log('入れた段は**最終面接だけ**。書類選考とグループ面接は'
  + '旧データに点が無い（無い段の評価を作ると「0点で通した」に化ける）。')
console.log('接点は入れていない。')
console.log('受け取れなかった値は、画面では「未記入」として出る。'
  + '**埋めていない。**')

await db.close()

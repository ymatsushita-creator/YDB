import { all, maybeOne, scalar, type Db } from '../db/client.ts'

/**
 * 幻のデモ期（依頼者の指示。実行⑪）。
 *
 * 実データと同じ DB に、**架空の期を1つ**置く。境界は 0029 の
 * `seasons.is_demo` / `persons.is_demo` が持ち、集計は混ざらない。
 *
 * ★ 架空であることを、名前で分かるようにする。
 *   `src/seed/demo.ts`（使い捨ての DB 用）は実在しそうな氏名を使う。
 *   **あれと同じ流儀をここへ持ち込まない** ―― 実データの隣に「佐藤 蓮」が
 *   並ぶと、見た人は実在の候補者だと読む。氏名は「デモ 候補者01」、
 *   学校は「デモ高校」、メールは `@demo.invalid`（RFC 2606 で
 *   絶対に実在しない TLD）にする。
 *
 * ★ 何度流しても同じデータになる。
 *   乱数は固定種。日付は `asOf`（既定は JST の今日）からの相対で置く。
 *   すでにデモ期があれば**作らない**（作り直すと、その中で試した記録が消える）。
 *
 * ★ 実在の期には1行も触らない。
 */

const FIRST_NAMES = [
  '候補者01', '候補者02', '候補者03', '候補者04', '候補者05', '候補者06', '候補者07',
  '候補者08', '候補者09', '候補者10', '候補者11', '候補者12', '候補者13', '候補者14',
]

const SCHOOL = 'デモ高校'
const STAFF_EMAIL = 'demo-ops@demo.invalid'
const STEPS = ['応募受付', '書類選考', 'グループ面接', '最終面接']
const CRITERIA = ['笑顔', 'リスペクト', '前提超越', '熱量', '地頭力', '素直さ']

/** 期の年。実在しない年にする（実在の期と番号で並ばないように）。 */
export const DEMO_YEAR = 9999

export interface DemoSeasonStats {
  seasonId: string
  created: boolean
  persons: number
  touchpoints: number
  applications: number
  appointments: number
  notes: number
}

/** 固定種の乱数。同じ種なら同じデータになる。 */
const rng = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}

const day = (base: string, n: number) => {
  const [y, m, d] = base.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

const at = (base: string, n: number, hour: number) =>
  `${day(base, n)}T${String(hour).padStart(2, '0')}:00:00+09:00`

export async function seedDemoSeason(
  db: Db, opts: { asOf?: string } = {},
): Promise<DemoSeasonStats> {
  const today = opts.asOf
    ?? new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
  const rand = rng(20261111)
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))

  const existing = await maybeOne<{ id: string }>(db,
    `SELECT id FROM seasons WHERE is_demo ORDER BY enrollment_year LIMIT 1`)
  if (existing) {
    return {
      seasonId: existing.id, created: false,
      persons: 0, touchpoints: 0, applications: 0, appointments: 0, notes: 0,
    }
  }

  await db.exec('BEGIN')
  try {
    // --- 期。今日を挟む窓に置く（画面が「いま動いている期」として読める）---
    const seasonId = await scalar<string>(db, `
      INSERT INTO seasons
        (enrollment_year, cohort_number, outreach_start_date, application_open_date,
         application_close_date, selection_end_date, target_application_count,
         capacity, is_demo)
      VALUES ($1, NULL, $2, $3, $4, $5, 40, 12, true)
      RETURNING id`,
    [DEMO_YEAR, day(today, -120), day(today, -60), day(today, 20), day(today, 60)])

    const stepIds = await all<{ id: string }>(db, `
      INSERT INTO selection_steps (season_id, sort_order, name)
      SELECT $1, i, n FROM unnest($2::text[]) WITH ORDINALITY AS t(n, i)
      RETURNING id`, [seasonId, STEPS])
    const finalStep = stepIds[3]!.id

    await db.query(`
      INSERT INTO evaluation_criteria (selection_step_id, name, scale_max, sort_order)
      SELECT $1, n, 4, i FROM unnest($2::text[]) WITH ORDINALITY AS t(n, i)`,
    [finalStep, CRITERIA])

    // --- マスタ。名前で架空と分かるものだけを足す ---
    const schoolId = await scalar<string>(db, `
      INSERT INTO schools (name) VALUES ($1)
      ON CONFLICT (name) DO UPDATE SET name = excluded.name
      RETURNING id`, [SCHOOL])
    const staffId = await scalar<string>(db, `
      INSERT INTO staffs (display_name, email) VALUES ('デモ 運営', $1)
      ON CONFLICT (email) DO UPDATE SET display_name = excluded.display_name
      RETURNING id`, [STAFF_EMAIL])

    const channels = await all<{ id: string; name: string }>(db,
      `SELECT id, name FROM channels WHERE is_active ORDER BY name`)
    if (channels.length === 0) throw new Error('チャネルのマスタが空。先にシードを入れる。')

    // --- 人 ---
    const personIds: string[] = []
    for (const [i, name] of FIRST_NAMES.entries()) {
      const id = await scalar<string>(db, `
        INSERT INTO persons
          (family_name, given_name, birth_date, school_id, faculty, email, is_demo)
        VALUES ('デモ', $1, $2, $3, $4, $5, true)
        RETURNING id`,
      [name, `${2004 + (i % 4)}-${String((i % 12) + 1).padStart(2, '0')}-15`,
        schoolId, i % 3 === 0 ? 'デモ学部' : null,
        `demo${String(i + 1).padStart(2, '0')}@demo.invalid`])
      personIds.push(id)

      await db.query(`
        INSERT INTO candidate_numbers (season_id, person_id, number)
        VALUES ($1, $2, $3)`, [seasonId, id, i + 1])
    }

    // --- アプローチ状態。母集団に載せるために必ず1件は要る ---
    const states = await all<{ id: string; code: string }>(db,
      `SELECT id, code FROM approach_states WHERE NOT is_terminal ORDER BY sort_order`)
    for (const [i, personId] of personIds.entries()) {
      const state = states[i % states.length]!
      await db.query(`
        INSERT INTO approach_events
          (person_id, season_id, approach_state_id, occurred_at, recorded_by_staff_id, note)
        VALUES ($1, $2, $3, $4, $5, 'デモ期の初期状態')`,
      [personId, seasonId, state.id, at(today, -100 + i, 10), staffId])
    }

    // --- 接点 ---
    let touchpoints = 0
    for (const [i, personId] of personIds.entries()) {
      for (let k = 0; k < int(1, 4); k += 1) {
        await db.query(`
          INSERT INTO touchpoints (person_id, channel_id, occurred_at, note)
          VALUES ($1, $2, $3, 'デモの接点')`,
        [personId, pick(channels).id, at(today, -90 + i * 3 + k * 7, 11 + (k % 6))])
        touchpoints += 1
      }
    }

    // --- 応募と評価。選考タブと面接が空にならない程度に ---
    let applications = 0
    for (const [i, personId] of personIds.entries()) {
      if (i >= 9) break
      const applicationId = await scalar<string>(db, `
        INSERT INTO applications (person_id, season_id, submitted_at)
        VALUES ($1, $2, $3) RETURNING id`, [personId, seasonId, at(today, -50 + i, 12)])
      applications += 1

      // 段を進める。i が大きいほど先の段に居る。
      const reached = Math.min(1 + (i % 4), 3)
      for (let s = 0; s < reached; s += 1) {
        await db.query(`
          INSERT INTO status_histories
            (application_id, transition_type, selection_step_id, occurred_at,
             changed_by_staff_id, note)
          VALUES ($1, 'advance', $2, $3, $4, 'デモの通過')`,
        [applicationId, stepIds[s]!.id, at(today, -45 + i + s * 5, 13), staffId])
      }

      // いま居る段の評価。半分は提出済み、半分は判断待ちにする
      // （滞留と担当未割当が画面に現れる）。
      const stepId = stepIds[reached]!.id
      const submitted = i % 2 === 0
      const evaluationId = await scalar<string>(db, `
        INSERT INTO evaluations
          (application_id, selection_step_id, interviewer_staff_id, state,
           assigned_at, submitted_at)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [applicationId, stepId, i % 3 === 0 ? null : staffId,
        submitted ? 'submitted' : 'pending',
        at(today, -20 + i, 10), submitted ? at(today, -18 + i, 15) : null])

      if (submitted && stepId === finalStep) {
        await db.query(`
          INSERT INTO evaluation_scores (evaluation_id, criteria_id, score, rationale)
          SELECT $1, c.id, 2 + (c.sort_order % 3), 'デモの根拠（架空）'
            FROM evaluation_criteria c WHERE c.selection_step_id = $2`,
        [evaluationId, finalStep])
      }
    }

    // --- 予定。今週に置く（カレンダーが空だと形が分からない）---
    const kinds = await all<{ id: string; code: string }>(db,
      `SELECT id, code FROM appointment_kinds WHERE is_active ORDER BY sort_order`)
    const withPerson = kinds.filter((k) => k.code !== 'internal')
    const monday = day(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7))
    let appointments = 0
    for (let i = 0; i < 5; i += 1) {
      const kind = withPerson[i % withPerson.length]!
      await db.query(`
        INSERT INTO appointments
          (season_id, person_id, kind_id, title, starts_at, ends_at, owner_staff_id, note)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'デモの予定')`,
      [seasonId, personIds[i]!, kind.id, `デモ面談 ${i + 1}`,
        at(monday, i, 10 + i), at(monday, i, 11 + i), staffId])
      appointments += 1
    }
    // 相手の要らない予定を1つ。参加者を記録する練習台になる。
    const internal = kinds.find((k) => k.code === 'internal')
    if (internal) {
      await db.query(`
        INSERT INTO appointments
          (season_id, kind_id, title, starts_at, ends_at, owner_staff_id, note)
        VALUES ($1, $2, 'デモ説明会', $3, $4, $5, '参加者を記録できる')`,
      [seasonId, internal.id, at(monday, 2, 14), at(monday, 2, 16), staffId])
      appointments += 1
    }

    // --- メモ。書いた人は手入力の自己申告（0027）---
    let notes = 0
    for (const [i, personId] of personIds.slice(0, 3).entries()) {
      await db.query(`
        INSERT INTO person_notes (person_id, author_name, noted_at, body)
        VALUES ($1, 'デモ 運営', $2, $3)`,
      [personId, at(today, -10 + i, 16),
        'デモのメモ（架空）。面談で話した内容をここに書く。'])
      notes += 1
    }

    await db.exec('COMMIT')
    return {
      seasonId, created: true,
      persons: personIds.length, touchpoints, applications, appointments, notes,
    }
  } catch (e: unknown) {
    await db.exec('ROLLBACK')
    throw e
  }
}

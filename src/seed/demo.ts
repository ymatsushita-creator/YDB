import type { Db } from '../db/client.ts'

/**
 * デモ用のデータ生成。
 *
 * 乱数は固定シードで、何度流しても同じデータになる。再現できない
 * デモデータは、ダッシュボードの数字がおかしいときに原因を切り分けられない。
 *
 * 参照データ（db/seeds/）とは分ける。あちらは実在のマスタ、こちらは作り物。
 */

/** mulberry32。短く、状態が32bitで、系列が実用上十分に散る。 */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FAMILY = ['佐藤','鈴木','高橋','田中','伊藤','渡辺','山本','中村','小林','加藤',
  '吉田','山田','佐々木','山口','松本','井上','木村','林','清水','斎藤']
const GIVEN = ['陽菜','蓮','結衣','悠真','咲良','大翔','葵','湊','杏','颯太',
  '莉子','樹','美咲','悠人','花','律','菜月','optimism','翼','琉生'].filter((s) => /[ぁ-ん一-龥ァ-ヶ]/.test(s))
const SCHOOLS = ['第一高等学校','明星学園高校','桜丘高等学校','北稜高校','東雲学院',
  '緑ヶ丘高等学校','中央高校','西湖高等学校','南陽高校','啓明学園','清和高等学校','天籟高校']
const PARTNERS = ['NPO法人みらい教育','県教育委員会','市立図書館連携事業','起業支援センターK',
  '高校生新聞社','ユースセンターまち','地域創生ファンド','大学連携コンソーシアム']
const STEPS = ['書類選考', '一次面接', '二次面接', '最終面接']
const CRITERIA: Record<string, Array<[string, number]>> = {
  書類選考:   [['志望動機の具体性', 5], ['行動実績', 5]],
  一次面接:   [['主体性', 5], ['言語化力', 5], ['探究の深さ', 5]],
  二次面接:   [['課題設定力', 5], ['他者との協働', 5], ['やり切る力', 5]],
  最終面接:   [['変化への意志', 5], ['プログラム適合', 5]],
}

const iso = (d: Date) => d.toISOString()
const addDays = (base: string, n: number) => {
  const d = new Date(`${base}T00:00:00+09:00`)
  d.setUTCDate(d.getUTCDate() + n)
  return d
}
/** JST の指定日の指定時刻。 */
const at = (base: string, dayOffset: number, hour: number, minute = 0) => {
  const d = addDays(base, dayOffset)
  d.setUTCHours(hour - 9, minute, 0, 0)
  return iso(d)
}
const daysBetween = (a: string, b: string) =>
  Math.round((+new Date(`${b}T00:00:00Z`) - +new Date(`${a}T00:00:00Z`)) / 86400000)

interface SeasonPlan {
  year: number
  outreachStart: string
  applicationOpen: string
  applicationClose: string
  selectionEnd: string
  capacity: number
  target: number
  /** 応募まで至る割合と、各ステップの通過率。 */
  applyRate: number
  passRates: number[]
}

// 通過率は各年度の定員におおよそ着地するよう選んである。
// 定員を大きく超える合格者が出るデータでは、充足率の表示が意味を持たない。
//
// 2027年度は進行中の年度として置いてある。過去の年度だけだと、
// 滞留や担当未割当といった(2)で見たいものがデータに一切現れない。
const PLANS: SeasonPlan[] = [
  { year: 2024, outreachStart: '2023-09-01', applicationOpen: '2023-11-01',
    applicationClose: '2023-12-15', selectionEnd: '2024-02-20',
    capacity: 24, target: 150, applyRate: 0.30, passRates: [0.62, 0.58, 0.60, 0.74] },
  { year: 2025, outreachStart: '2024-09-01', applicationOpen: '2024-11-01',
    applicationClose: '2024-12-15', selectionEnd: '2025-02-20',
    capacity: 30, target: 220, applyRate: 0.34, passRates: [0.58, 0.52, 0.52, 0.76] },
  { year: 2026, outreachStart: '2025-09-01', applicationOpen: '2025-11-01',
    applicationClose: '2025-12-15', selectionEnd: '2026-02-20',
    capacity: 36, target: 300, applyRate: 0.36, passRates: [0.55, 0.50, 0.50, 0.70] },
  { year: 2027, outreachStart: '2026-04-01', applicationOpen: '2026-07-01',
    applicationClose: '2026-08-31', selectionEnd: '2026-11-30',
    capacity: 40, target: 340, applyRate: 0.38, passRates: [0.55, 0.50, 0.50, 0.70] },
]

export interface DemoStats {
  persons: number
  touchpoints: number
  applications: number
  histories: number
  evaluations: number
  scores: number
}

export interface DemoOptions {
  /** 乱数のシード。同じ値なら同じデータになる。 */
  seed?: number
  /**
   * 「今日」。これより後の出来事は生成しない。
   * 進行中の年度では、まだ起きていない選考が pending の評価として残り、
   * ダッシュボード(2)の滞留・担当未割当がデータに現れる。
   */
  asOf?: string
}

export async function seedDemo(db: Db, opts: DemoOptions = {}): Promise<DemoStats> {
  const rand = rng(opts.seed ?? 20260806)
  const asOf = opts.asOf ? +new Date(`${opts.asOf}T23:59:59+09:00`) : Date.now()
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))

  // --- マスタ ---
  const schoolIds = await insertReturning(db,
    `INSERT INTO schools (name) SELECT unnest($1::text[]) RETURNING id`, [SCHOOLS])
  const partnerIds = await insertReturning(db,
    `INSERT INTO partners (name, category, first_contact_date)
     SELECT unnest($1::text[]), 'npo', '2023-04-01'::date RETURNING id`, [PARTNERS])

  const channels = await db.query<{ id: string; name: string }>(
    `SELECT id, name FROM channels ORDER BY name`)
  if (channels.rows.length === 0) {
    throw new Error('参照データが未投入。db/seeds を先に流すこと')
  }
  const channelIds = channels.rows.map((c) => c.id)
  const partnerChannelId = channels.rows.find((c) => c.name === '提携団体イベント')!.id
  const scoutChannelId = channels.rows.find((c) => c.name === 'スカウト')!.id

  const staffNames = ['川西 直樹','森 あかり','大野 隆','西田 咲','原 健一',
    '藤本 みなみ','小池 亮','宮田 千尋','東 拓海','白石 遥']
  const staffIds = await insertReturning(db,
    `INSERT INTO staffs (display_name, email)
     SELECT n, 'staff' || i || '@example.test'
       FROM unnest($1::text[]) WITH ORDINALITY AS t(n, i) RETURNING id`, [staffNames])

  const withdrawReasons = (await db.query<{ id: string }>(
    `SELECT id FROM withdraw_reasons WHERE code <> 'other'`)).rows.map((r) => r.id)

  // --- Season と選考フロー ---
  interface Criterion { id: string; reapplicantOnly: boolean }
  const seasons: Array<{
    id: string; plan: SeasonPlan; stepIds: string[]; criteriaByStep: Criterion[][]
  }> = []

  for (const plan of PLANS) {
    const [{ id }] = await insertRows<{ id: string }>(db,
      `INSERT INTO seasons (enrollment_year, outreach_start_date, application_open_date,
                            application_close_date, selection_end_date, capacity,
                            target_application_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [plan.year, plan.outreachStart, plan.applicationOpen, plan.applicationClose,
       plan.selectionEnd, plan.capacity, plan.target])

    const stepIds: string[] = []
    const criteriaByStep: Criterion[][] = []
    for (const [i, name] of STEPS.entries()) {
      const [{ id: stepId }] = await insertRows<{ id: string }>(db,
        `INSERT INTO selection_steps (season_id, sort_order, name, sla_days)
         VALUES ($1,$2,$3,$4) RETURNING id`, [id, i + 1, name, [10, 7, 7, 5][i]])
      stepIds.push(stepId)

      const specs = CRITERIA[name]!
      const ids = await insertReturning(db,
        `INSERT INTO evaluation_criteria (selection_step_id, name, scale_max, sort_order)
         SELECT $1, n, m, o FROM unnest($2::text[], $3::int[]) WITH ORDINALITY AS t(n, m, o)
         RETURNING id`,
        [stepId, specs.map((s) => s[0]), specs.map((s) => s[1])])

      const criteria: Criterion[] = ids.map((cid) => ({ id: cid, reapplicantOnly: false }))

      // 再応募者限定の軸は最終面接にだけ置く。
      if (name === '最終面接') {
        const [{ id: reapp }] = await insertRows<{ id: string }>(db,
          `INSERT INTO evaluation_criteria
             (selection_step_id, name, scale_max, applies_to, sort_order)
           VALUES ($1, '前回からの変化', 5, 'reapplicant_only', 99) RETURNING id`, [stepId])
        criteria.push({ id: reapp, reapplicantOnly: true })
      }
      criteriaByStep.push(criteria)
    }
    seasons.push({ id, plan, stepIds, criteriaByStep })
  }

  // --- 森（団体リーチ） ---
  for (const s of seasons) {
    const rows: Array<[string, string, string, string, number]> = []
    for (const pid of partnerIds) {
      for (let k = 0; k < int(1, 3); k++) {
        rows.push([pid, s.id,
          iso(addDays(s.plan.outreachStart, int(0, 55))).slice(0, 10),
          pick(['出張授業', '合同説明会', 'メール配信', '校内掲示']),
          int(20, 300)])
      }
    }
    await db.query(
      `INSERT INTO partner_reaches (partner_id, season_id, occurred_on, method, estimated_reach)
       SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::date[], $4::text[], $5::int[])`,
      cols(rows))
  }

  // --- 人・接点・応募 ---
  const stats: DemoStats = {
    persons: 0, touchpoints: 0, applications: 0, histories: 0, evaluations: 0, scores: 0,
  }
  /** 過去に応募して不合格・辞退になった人。翌年度の再応募母集団になる。 */
  let returning: string[] = []

  for (const s of seasons) {
    const { plan } = s
    // その年度で「すでに起きたこと」の締め。進行中の年度では今日が締めになる。
    const horizon = Math.min(+new Date(`${plan.selectionEnd}T23:59:59+09:00`), asOf)
    if (+new Date(`${plan.outreachStart}T00:00:00+09:00`) > horizon) continue

    const outreachDays = daysBetween(plan.outreachStart, plan.applicationClose)
    const newPeople = Math.round(plan.target / plan.applyRate)

    // 識別（林に入る）。集客期間に一様に散らし、今日より後は切る。
    const personRows: Array<[string, string, string, string, string, string]> = []
    for (let i = 0; i < newPeople; i++) {
      const day = int(0, outreachDays)
      const createdAtIso = at(plan.outreachStart, day, int(9, 21), int(0, 59))
      if (+new Date(createdAtIso) > horizon) continue
      personRows.push([
        pick(FAMILY), pick(GIVEN),
        `${plan.year - 18}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`,
        pick(schoolIds),
        `demo${plan.year}_${i}@example.test`,
        createdAtIso,
      ])
    }
    if (personRows.length === 0) continue
    const newIds = await insertReturning(db,
      `INSERT INTO persons (family_name, given_name, birth_date, school_id, email, created_at)
       SELECT * FROM unnest($1::text[],$2::text[],$3::date[],$4::uuid[],$5::text[],$6::timestamptz[])
       RETURNING id`, cols(personRows))
    stats.persons += newIds.length

    const createdAt = new Map<string, string>()
    newIds.forEach((id, i) => createdAt.set(id, personRows[i]![5]))

    // 接点
    const tpRows: Array<[string, string, string | null, string]> = []
    for (const id of newIds) {
      const first = createdAt.get(id)!
      tpRows.push([id, pick(channelIds), null, first])
      for (let k = 0; k < int(0, 3); k++) {
        const ch = pick(channelIds)
        const later = new Date(+new Date(first) + int(1, 70) * 86400000)
        if (+later > horizon) continue
        tpRows.push([id, ch, ch === partnerChannelId ? pick(partnerIds) : null, iso(later)])
      }
    }
    // 前年度の不合格者への再アプローチ（スカウト）
    for (const id of returning) {
      if (rand() < 0.45) {
        const scoutAt = at(plan.outreachStart, int(0, 40), int(10, 19))
        if (+new Date(scoutAt) > horizon) continue
        tpRows.push([id, scoutChannelId, null, scoutAt])
      }
    }
    await db.query(
      `INSERT INTO touchpoints (person_id, channel_id, partner_id, occurred_at, is_scout)
       SELECT a, b, c, d, b = $5 FROM unnest($1::uuid[],$2::uuid[],$3::uuid[],$4::timestamptz[])
              AS t(a,b,c,d)`,
      [...cols(tpRows), scoutChannelId])
    stats.touchpoints += tpRows.length

    // 応募
    const applicants = newIds.filter(() => rand() < plan.applyRate)
    const reapplicants = returning.filter(() => rand() < 0.22)
    const applyWindow = daysBetween(plan.applicationOpen, plan.applicationClose)

    const appRows: Array<[string, string, string, boolean]> = []
    for (const id of [...applicants, ...reapplicants]) {
      // 締切直前に寄る現実的な分布。乱数を2乗して後ろへ偏らせる。
      const day = Math.round(applyWindow * (1 - (1 - rand()) ** 2))
      const submittedAt = at(plan.applicationOpen, day, int(7, 23), int(0, 59))
      if (+new Date(submittedAt) > horizon) continue
      appRows.push([id, s.id, submittedAt, reapplicants.includes(id)])
    }
    if (appRows.length === 0) { returning = []; continue }
    const appIds = await insertReturning(db,
      `INSERT INTO applications (person_id, season_id, submitted_at, is_reapplication)
       SELECT * FROM unnest($1::uuid[],$2::uuid[],$3::timestamptz[],$4::bool[]) RETURNING id`,
      cols(appRows))
    stats.applications += appIds.length

    // 選考の進行
    const nextReturning: string[] = []
    const histories: Array<[string, string, string | null, string, string, string | null]> = []
    const evals: Array<[string, string, string | null, string, string, string | null]> = []
    const scoreRows: Array<[number, string, number, string]> = []  // evalIndex は後で解決

    for (const [ai, appId] of appIds.entries()) {
      const personId = appRows[ai]![0]
      const isReapplication = appRows[ai]![3]
      const submitted = new Date(appRows[ai]![2])
      let cursor = +submitted
      let alive = true

      for (const [si, stepId] of s.stepIds.entries()) {
        if (!alive) break
        cursor += int(3, 12) * 86400000
        const assignedAt = iso(new Date(cursor))
        const interviewer = si === 0 ? null : pick(staffIds)

        if (cursor > horizon) break   // このステップにはまだ到達していない

        // 評価行はステップ到達時に生成される。第1ステップのみ担当未割当。
        // 判断がまだ下りていない（今日より後の）評価は pending のまま残り、
        // これが(2)の滞留・担当未割当として見えるものになる。
        const decided = cursor + int(1, 9) * 86400000
        const stillOpen = decided > horizon
        evals.push([appId, stepId, interviewer,
          stillOpen ? 'pending' : 'submitted', assignedAt,
          stillOpen ? null : iso(new Date(decided))])

        const evalIndex = evals.length - 1
        if (!stillOpen) {
          // 再応募者限定の軸は再応募でなければ付けない。トリガが弾く。
          for (const c of s.criteriaByStep[si]!) {
            if (c.reapplicantOnly && !isReapplication) continue
            scoreRows.push([evalIndex, c.id, int(2, 5), pick([
              '面談で語られた具体的な取り組みに裏づけがあった',
              '自分の言葉で経緯を説明できていた',
              '実際に手を動かした形跡が資料から読み取れた',
              '課題の設定が具体的で、範囲を絞れていた',
            ])])
          }
        }

        if (stillOpen) { alive = false; break }
        cursor = decided

        if (rand() < plan.passRates[si]!) {
          histories.push([appId, 'advance', stepId, iso(new Date(cursor)), pick(staffIds), null])
        } else {
          histories.push([appId, 'reject', null, iso(new Date(cursor)), pick(staffIds), null])
          nextReturning.push(personId)
          alive = false
        }
      }

      // 内定辞退
      if (alive && rand() < 0.12) {
        cursor += int(2, 14) * 86400000
        if (cursor <= horizon) {
          histories.push([appId, 'withdraw', null, iso(new Date(cursor)),
            pick(staffIds), pick(withdrawReasons)])
          nextReturning.push(personId)
        }
      }
    }

    if (histories.length > 0) {
      await db.query(
        `INSERT INTO status_histories
           (application_id, transition_type, selection_step_id, occurred_at,
            changed_by_staff_id, withdraw_reason_id)
         SELECT * FROM unnest($1::uuid[],$2::text[],$3::uuid[],$4::timestamptz[],
                              $5::uuid[],$6::uuid[])`,
        cols(histories))
      stats.histories += histories.length
    }

    const evalIds = evals.length === 0 ? [] : await insertReturning(db,
      `INSERT INTO evaluations
         (application_id, selection_step_id, interviewer_staff_id, state, assigned_at, submitted_at)
       SELECT * FROM unnest($1::uuid[],$2::uuid[],$3::uuid[],$4::text[],
                            $5::timestamptz[],$6::timestamptz[]) RETURNING id`,
      cols(evals))
    stats.evaluations += evalIds.length

    const resolved = scoreRows.map(([ei, cid, sc, r]) => [evalIds[ei]!, cid, sc, r] as const)
    if (resolved.length > 0) {
      await db.query(
        `INSERT INTO evaluation_scores (evaluation_id, criteria_id, score, rationale)
         SELECT * FROM unnest($1::uuid[],$2::uuid[],$3::int[],$4::text[])`,
        cols(resolved.map((r) => [...r] as [string, string, number, string])))
      stats.scores += resolved.length
    }

    returning = nextReturning
  }

  // --- 訂正が入った実例を少しだけ混ぜる ---
  // 訂正のないデータで作ったダッシュボードは、訂正が来た日に壊れる。
  const toCorrect = (await db.query<{ id: string; application_id: string }>(
    `SELECT sh.id, sh.application_id FROM status_histories sh
      WHERE sh.transition_type = 'reject' AND sh.corrects_history_id IS NULL
      ORDER BY sh.occurred_at DESC LIMIT 6`)).rows

  for (const [i, h] of toCorrect.entries()) {
    const fs = await db.query<{ selection_step_id: string }>(
      `SELECT fs.selection_step_id FROM v_final_selection_step fs
         JOIN applications a ON a.season_id = fs.season_id WHERE a.id = $1`, [h.application_id])
    // 不合格を取り消して合格に訂正する（半分）、取り消しをさらに訂正する（半分）
    const [{ id: correction }] = await insertRows<{ id: string }>(db,
      `INSERT INTO status_histories
         (application_id, transition_type, selection_step_id, occurred_at,
          changed_by_staff_id, is_correction, corrects_history_id)
       VALUES ($1, 'advance', $2, now(), (SELECT id FROM staffs LIMIT 1), true, $3)
       RETURNING id`, [h.application_id, fs.rows[0]?.selection_step_id ?? null, h.id])
    stats.histories++

    if (i % 2 === 1) {
      await db.query(
        `INSERT INTO status_histories
           (application_id, transition_type, occurred_at, changed_by_staff_id,
            is_correction, corrects_history_id)
         VALUES ($1, 'reject', now(), (SELECT id FROM staffs LIMIT 1), true, $2)`,
        [h.application_id, correction])
      stats.histories++
    }
  }

  return stats
}

// -------------------------------------------------------------
// 配列をカラム方向に転置する。unnest で一括挿入するため。
// 1行ずつ INSERT すると PGlite では往復回数がそのまま時間になる。
// -------------------------------------------------------------
function cols<T extends readonly unknown[]>(rows: T[]): unknown[][] {
  const width = rows[0]?.length ?? 0
  return Array.from({ length: width }, (_, i) => rows.map((r) => r[i]))
}

async function insertRows<T>(db: Db, sql: string, params: unknown[]): Promise<T[]> {
  const { rows } = await db.query<T>(sql, params)
  return rows
}

async function insertReturning(db: Db, sql: string, params: unknown[]): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(sql, params)
  return rows.map((r) => r.id)
}

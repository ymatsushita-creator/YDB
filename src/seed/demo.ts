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
  '莉子','樹','美咲','悠人','花','律','菜月','奏','翼','琉生']
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
  voided: number
  deleted_persons: number
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

  // 無効化理由。counts_as_application の両方を引く。
  // どちらか片方しか使わないデータだと、A-2 の分岐が一度も踏まれない。
  const voidCounts = await insertOne<{ id: string }>(db,
    `SELECT id FROM void_reasons WHERE code = 'withdrawn_before_screening'`, [])
  const voidNotCounts = await insertOne<{ id: string }>(db,
    `SELECT id FROM void_reasons WHERE code = 'identity_merge_error'`, [])

  // --- Season と選考フロー ---
  interface Criterion { id: string; reapplicantOnly: boolean }
  const seasons: Array<{
    id: string; plan: SeasonPlan; stepIds: string[]; criteriaByStep: Criterion[][]
  }> = []

  for (const plan of PLANS) {
    const { id } = await insertOne<{ id: string }>(db,
      `INSERT INTO seasons (enrollment_year, outreach_start_date, application_open_date,
                            application_close_date, selection_end_date, capacity,
                            target_application_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [plan.year, plan.outreachStart, plan.applicationOpen, plan.applicationClose,
       plan.selectionEnd, plan.capacity, plan.target])

    const stepIds: string[] = []
    const criteriaByStep: Criterion[][] = []
    for (const [i, name] of STEPS.entries()) {
      const { id: stepId } = await insertOne<{ id: string }>(db,
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
        const { id: reapp } = await insertOne<{ id: string }>(db,
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
    persons: 0, touchpoints: 0, applications: 0, voided: 0, deleted_persons: 0,
    histories: 0, evaluations: 0, scores: 0,
  }
  /** 過去に応募して不合格・辞退になった人。翌年度の再応募母集団になる。 */
  let returning: string[] = []
  /**
   * 卒業生スタッフの person_id。
   * この人たちが紹介者にも面接官にもなりうるため、利益相反が自然に生まれる。
   * 利益相反が一件も起きないデータでは、検出ビューが動いているか分からない。
   */
  const alumniPersonIds: string[] = []

  for (const s of seasons) {
    const { plan } = s
    // その年度で「すでに起きたこと」の締め。進行中の年度では今日が締めになる。
    const horizon = Math.min(+new Date(`${plan.selectionEnd}T23:59:59+09:00`), asOf)
    if (+new Date(`${plan.outreachStart}T00:00:00+09:00`) > horizon) continue

    const outreachDays = daysBetween(plan.outreachStart, plan.applicationClose)
    const newPeople = Math.round(plan.target / plan.applyRate)

    // 識別（林に入る）。集客期間に一様に散らし、今日より後は切る。
    const personRows: Array<
      [string, string, string, string, string, string, string | null]
    > = []
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
        // 卒業生からの紹介。紹介チャネルの合格率が実力かバイアスかを
        // 後から検証できるよう、紹介の事実を Person に残す（資料3-4）。
        alumniPersonIds.length > 0 && rand() < 0.12 ? pick(alumniPersonIds) : null,
      ])
    }
    if (personRows.length === 0) continue
    const newIds = await insertReturning(db,
      `INSERT INTO persons
         (family_name, given_name, birth_date, school_id, email, created_at, referrer_person_id)
       SELECT * FROM unnest($1::text[],$2::text[],$3::date[],$4::uuid[],$5::text[],
                            $6::timestamptz[],$7::uuid[])
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

    // 一部を無効化する。集計に残るもの（選考前の取り下げ）と、
    // 代替が生まれるので残さないもの（名寄せ誤り）の両方を作る。
    // 実データには必ず現れる形なので、デモにも無いと画面が検証できない。
    const voided: Array<[string, string, string]> = []
    for (const [ai, appId] of appIds.entries()) {
      if (rand() >= 0.03) continue
      const voidedAt = new Date(+new Date(appRows[ai]![2]) + int(1, 20) * 86400000)
      if (+voidedAt > horizon) continue
      voided.push([appId, rand() < 0.5 ? voidCounts.id : voidNotCounts.id, iso(voidedAt)])
    }
    if (voided.length > 0) {
      await db.query(
        `UPDATE applications a
            SET voided_at = v.at, void_reason_id = v.reason
           FROM unnest($1::uuid[], $2::uuid[], $3::timestamptz[]) AS v(id, reason, at)
          WHERE a.id = v.id`, cols(voided))
      stats.voided += voided.length
    }

    // 選考の進行
    const nextReturning: string[] = []
    const acceptedPersons: string[] = []
    const histories: Array<[string, string, string | null, string, string, string | null]> = []
    const evals: Array<
      [string, string, string | null, string, string, string | null, string | null]
    > = []
    const scoreRows: Array<[number, string, number, string]> = []  // evalIndex は後で解決

    const voidedIds = new Set(voided.map((v) => v[0]))
    for (const [ai, appId] of appIds.entries()) {
      if (voidedIds.has(appId)) continue
      const personId = appRows[ai]![0]
      const isReapplication = appRows[ai]![3]
      const submitted = new Date(appRows[ai]![2])
      let cursor = +submitted
      let alive = true
      // 地平線に達して選考が途中で止まったのか、最終ステップまで通ったのか。
      // 区別しないと、まだ選考中の人が「合格者」として卒業生スタッフになる。
      let reachedFinal = false

      for (const [si, stepId] of s.stepIds.entries()) {
        if (!alive) break
        cursor += int(3, 12) * 86400000
        const assignedAt = iso(new Date(cursor))
        const interviewer = si === 0 ? null : pick(staffIds)

        if (cursor > horizon) { alive = false; break }   // まだ到達していない

        // 評価行はステップ到達時に生成される。第1ステップのみ担当未割当。
        // 判断がまだ下りていない（今日より後の）評価は pending のまま残り、
        // これが(2)の滞留・担当未割当として見えるものになる。
        const decided = cursor + int(1, 9) * 86400000
        const stillOpen = decided > horizon
        // 保留は「判断を止めている」状態。理由が必須なので必ず読める形で残る。
        const held = stillOpen && rand() < 0.12
        evals.push([appId, stepId, interviewer,
          held ? 'held' : stillOpen ? 'pending' : 'submitted', assignedAt,
          stillOpen ? null : iso(new Date(decided)),
          held ? pick([
            '追加提出を依頼して返答待ち',
            '面接官の間で評価が割れており再面接を検討中',
            '本人の都合で日程を再調整中',
            '保護者の同意確認待ち',
          ]) : null])

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
          if (si === s.stepIds.length - 1) reachedFinal = true
        } else {
          histories.push([appId, 'reject', null, iso(new Date(cursor)), pick(staffIds), null])
          nextReturning.push(personId)
          alive = false
        }
      }

      if (reachedFinal) acceptedPersons.push(personId)

      // 内定辞退
      if (reachedFinal && rand() < 0.12) {
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
         (application_id, selection_step_id, interviewer_staff_id, state,
          assigned_at, submitted_at, hold_reason)
       SELECT * FROM unnest($1::uuid[],$2::uuid[],$3::uuid[],$4::text[],
                            $5::timestamptz[],$6::timestamptz[],$7::text[]) RETURNING id`,
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

    // 合格者の一部が翌年度から運営に入る。面接官として選考にも関わる。
    for (let k = 0; k < 2 && acceptedPersons.length > 0; k++) {
      const personId = pick(acceptedPersons)
      if (alumniPersonIds.includes(personId)) continue
      const existing = await db.query(
        `SELECT 1 FROM staffs WHERE person_id = $1`, [personId])
      if (existing.rows.length > 0) continue
      const { id: staffId } = await insertOne<{ id: string }>(db,
        `INSERT INTO staffs (person_id, display_name, email)
         SELECT $1, p.family_name || ' ' || p.given_name,
                'alumni_' || left(p.id::text, 8) || '@example.test'
           FROM persons p WHERE p.id = $1 RETURNING id`, [personId])
      staffIds.push(staffId)
      alumniPersonIds.push(personId)
    }

    returning = nextReturning
  }

  // --- 訂正が入った実例を少しだけ混ぜる ---
  // 訂正のないデータで作ったダッシュボードは、訂正が来た日に壊れる。
  // 訂正で「通過」にするステップは、その不合格が起きたステップでなければ
  // ならない。評価行のないステップに advance を入れると、
  // 「到達0・通過3」という読めない集計ができる。
  // 不合格の直前に割り当てられた評価が、落ちたステップを指している。
  // 並べ替えの第1キーを sh.id にすると、gen_random_uuid() で毎回別の6件が
  // 選ばれる。訂正データは「訂正が来た日に壊れないこと」を確かめるために
  // 入れているのに、そこだけ再現しないのでは意味がない。
  // occurred_at と application_id で決定的に並べる。
  const toCorrect = (await db.query<{
    id: string; application_id: string; selection_step_id: string
  }>(`
    SELECT DISTINCT ON (sh.occurred_at, sh.application_id)
           sh.id, sh.application_id, e.selection_step_id
      FROM status_histories sh
      JOIN evaluations e ON e.application_id = sh.application_id
                        AND e.assigned_at <= sh.occurred_at
     WHERE sh.transition_type = 'reject' AND sh.corrects_history_id IS NULL
     ORDER BY sh.occurred_at, sh.application_id, e.assigned_at DESC`)).rows.slice(0, 6)

  for (const [i, h] of toCorrect.entries()) {
    // 不合格を取り消して通過に訂正する（半分）、取り消しをさらに訂正する（半分）
    // 訂正の時刻に now() を使わない。過去の年度の記録を「今日」訂正すると、
    // 元の不合格は年度の系列から消えるのに訂正後の合格は系列に載らない、
    // という読めない状態になる。訂正は元の記録の翌日に起きたことにする。
    const { id: correction } = await insertOne<{ id: string }>(db,
      `INSERT INTO status_histories
         (application_id, transition_type, selection_step_id, occurred_at,
          changed_by_staff_id, is_correction, corrects_history_id)
       SELECT $1, 'advance', $2, orig.occurred_at + interval '1 day',
              orig.changed_by_staff_id, true, $3
         FROM status_histories orig WHERE orig.id = $3
       RETURNING id`, [h.application_id, h.selection_step_id, h.id])
    stats.histories++

    if (i % 2 === 1) {
      await db.query(
        `INSERT INTO status_histories
           (application_id, transition_type, occurred_at, changed_by_staff_id,
            is_correction, corrects_history_id)
         SELECT $1, 'reject', prev.occurred_at + interval '1 day',
                prev.changed_by_staff_id, true, $2
           FROM status_histories prev WHERE prev.id = $2`,
        [h.application_id, correction])
      stats.histories++
    }
  }

  // 個人情報削除の依頼（資料9-2）。応募していない Person から選ぶ。
  // 削除済みが1件も無いと、集計から外れているかを画面で確かめられない。
  const deleted = await db.query(`
    UPDATE persons SET deleted_at = now()
     WHERE id IN (
       SELECT p.id FROM persons p
        WHERE p.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.person_id = p.id)
          AND NOT EXISTS (SELECT 1 FROM staffs st WHERE st.person_id = p.id)
        ORDER BY p.created_at LIMIT 3)
     RETURNING id`)
  stats.deleted_persons = deleted.rows.length

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

/** RETURNING が必ず1行返す INSERT。返らなければ組み立ての前提が崩れている。 */
async function insertOne<T>(db: Db, sql: string, params: unknown[]): Promise<T> {
  const rows = await insertRows<T>(db, sql, params)
  if (rows.length !== 1) throw new Error(`expected 1 returned row, got ${rows.length}`)
  return rows[0]!
}

async function insertReturning(db: Db, sql: string, params: unknown[]): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(sql, params)
  return rows.map((r) => r.id)
}

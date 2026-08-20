import { scalar, type Db } from '../db/client.ts'

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
/**
 * 森（Forest）と、その中の林（Community）。
 *
 * 0012 で `partners` に親を1本足し、親を持たない団体を森、親を持つ団体を
 * 林とした。集計は `v_partner_forest` を通して林の接点を森へ畳むので、
 * **接点が森に直付けされる形と、林に付く形の両方**がデモに要る。
 * 片方しか無いと、畳んでいるかどうかが一度も確かめられない。
 *
 * 要注意の判定に効く形も、確率ではなく明示的に置く（C-13 と同じ理由）。
 *   noTouch        … リーチはあるのに、誰一人識別できていない森
 *   noReach        … 接点はあるが、団体リーチの記録が無い森
 *   touchUntilYear … その年度までしか接点が無い森（休眠）
 */
interface ForestPlan {
  name: string
  category: string
  communities: string[]
  noTouch?: boolean
  noReach?: boolean
  touchUntilYear?: number
}

const FORESTS: ForestPlan[] = [
  { name: '大学連携コンソーシアム', category: 'network',
    communities: ['高校生探究部会', '起業サークル連合'] },
  { name: 'NPO法人みらい教育', category: 'npo',
    communities: ['ユース起業ゼミ'] },
  { name: '起業支援センターK', category: 'company',
    communities: ['アクセラレータ生コミュニティ'] },
  { name: '県教育委員会', category: 'government', communities: [] },
  { name: '市立図書館連携事業', category: 'government', communities: [] },
  { name: '地域創生ファンド', category: 'company', communities: [] },
  // 接点はあるが、団体リーチの記録が無い。推定リーチが NULL の森。
  { name: 'ユースセンターまち', category: 'npo', communities: [], noReach: true },
  // 2025年度までしか接点が無い。休眠した森。
  { name: '高校生新聞社', category: 'media', communities: [], touchUntilYear: 2025 },
  // リーチはあるのに識別ゼロ。**この2つを割ってはならない**（domain.md 8節）。
  { name: '西部工業高等専門学校', category: 'school', communities: [], noTouch: true },
]
const STEPS = ['書類選考', '一次面接', '二次面接', '最終面接']
const CRITERIA: Record<string, Array<[string, number]>> = {
  書類選考:   [['志望動機の具体性', 5], ['行動実績', 5]],
  一次面接:   [['主体性', 5], ['言語化力', 5], ['探究の深さ', 5]],
  二次面接:   [['課題設定力', 5], ['他者との協働', 5], ['やり切る力', 5]],
  最終面接:   [['変化への意志', 5], ['プログラム適合', 5]],
}

const iso = (d: Date) => d.toISOString()

/**
 * JST の暦日に日数を足し、`YYYY-MM-DD` で返す。
 *
 * 暦日の足し算に Date を使うなら、基準を UTC 深夜に取る。
 * JST 深夜（`T00:00:00+09:00`）を基準にすると、その瞬間の UTC 日付は
 * 前日なので、`toISOString().slice(0, 10)` が1日ずれる。
 * A-1 と同じ間違いを、集計ではなくデータの生成側でやることになる。
 */
const addDays = (base: string, n: number) => {
  const d = new Date(`${base}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * JST の指定日の指定時刻。
 *
 * かつては UTC の時刻を `hour - 9` で組み立てていた。JST 深夜を基準にした
 * Date の UTC 日付が前日になるため、**どの時刻を渡しても指定日の1日前**に
 * なっていた。応募は at(applicationOpen, 0, ...) から作るので、
 * 最初の応募が応募開始日より前に発生していた。
 *
 * ファネルは応募開始日より前の出来事を初日に寄せる（0004 の clamped）ので
 * 集計値の辻褄は合ってしまい、表に出なかった。丸め込みが欠陥を隠す形は
 * 実行②の「表示の丸めで注記が嘘になった」と同じ。
 *
 * タイムゾーンつきのリテラルを組み立てて、暦の解釈を Date に任せない。
 */
const at = (base: string, dayOffset: number, hour: number, minute = 0) => {
  const day = addDays(base, dayOffset)
  const hh = String(hour).padStart(2, '0')
  const mm = String(minute).padStart(2, '0')
  return iso(new Date(`${day}T${hh}:${mm}:00+09:00`))
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
  /** 期（1期・2期…）。年度からは導けないので、計画に書く。 */
  cohort: number
}

// 通過率は各年度の定員におおよそ着地するよう選んである。
// 定員を大きく超える合格者が出るデータでは、充足率の表示が意味を持たない。
//
// ★ 期は3つ。**1期と2期は行われた募集、3期はこれからの募集**である。
//   実行⑨で 4 → 2 に減らし、依頼者の「次は三期」を受けて 3 にした。
//
//   過去に無い期を架空に足さない。デモが架空データであることと、
//   **行われていない募集を「行われた」ように見せることは別**で、
//   後者は運営に「その期の記録がどこかにある」と思わせる。
//   だから3期には**応募も評価も作らない**（募集開始が「今日」より後なので、
//   生成器が地平線で切って自然に0件になる）。
//
//   2期を進行中として置く。終わった期だけだと、滞留や担当未割当が
//   データに一切現れない。1期は終わった期で、再応募の母集団にもなる。
//
//   ★ 3期の日付は**デモ専用の仮の値**である。実際の日程は未受領で、
//     本番シード（db/seeds/）には3期を入れていない。
const PLANS: SeasonPlan[] = [
  { year: 2025, outreachStart: '2024-09-01', applicationOpen: '2024-11-01',
    applicationClose: '2024-12-15', selectionEnd: '2025-02-20',
    capacity: 30, target: 220, applyRate: 0.34, passRates: [0.58, 0.52, 0.52, 0.76],
    cohort: 1 },
  { year: 2026, outreachStart: '2025-09-01', applicationOpen: '2025-11-01',
    applicationClose: '2026-08-31', selectionEnd: '2026-11-30',
    capacity: 36, target: 300, applyRate: 0.36, passRates: [0.55, 0.50, 0.50, 0.70],
    cohort: 2 },
  // 3期。**これからの募集。** 集客開始が「今日」より後なので、
  // 接点も応募も生成されない ―― 空の期がどう見えるかを確かめる経路でもある。
  { year: 2027, outreachStart: '2026-09-01', applicationOpen: '2026-11-01',
    applicationClose: '2026-12-15', selectionEnd: '2027-02-20',
    capacity: 40, target: 340, applyRate: 0.38, passRates: [0.55, 0.50, 0.50, 0.70],
    cohort: 3 },
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
  approach_events: number
  score_snapshots: number
  appointments: number
  manual_tasks: number
}

interface Criterion { id: string; reapplicantOnly: boolean }

interface SeededSeason {
  id: string
  plan: SeasonPlan
  stepIds: string[]
  criteriaByStep: Criterion[][]
}

export interface DemoOptions {
  /** 乱数のシード。同じ値なら同じデータになる。 */
  seed?: number
  /**
   * 「今日」（JST の暦日）。これより後の出来事は生成しない。
   * 進行中の年度では、まだ起きていない選考が pending の評価として残り、
   * ダッシュボード(2)の滞留・担当未割当がデータに現れる。
   *
   * 省略すると JST の今日。**時刻まで含めた「いま」ではない。**
   * かつて Date.now() を既定にしていたため、同じ日に2回流しただけで
   * 地平線が数分ぶん動き、判断待ちの件数が食い違った。
   * 「何度流しても同じデータになる」と書いてあるのに、そうでなかった。
   */
  asOf?: string
}

export async function seedDemo(db: Db, opts: DemoOptions = {}): Promise<DemoStats> {
  const rand = rng(opts.seed ?? 20260806)
  // 既定は JST の今日の終わり。Date.now() だと同じ日でも実行時刻で動く。
  const jstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
  const asOf = +new Date(`${opts.asOf ?? jstToday()}T23:59:59+09:00`)
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))

  // --- マスタ ---
  const schoolIds = await insertReturning(db,
    `INSERT INTO schools (name) SELECT unnest($1::text[]) RETURNING id`, [SCHOOLS])
  // 森を先に入れ、林はその子として入れる。2段を超えるとトリガが拒否する。
  const forestIdByName = new Map<string, string>()
  const communityIdByName = new Map<string, string>()
  /** 接点を作れる団体（森と林の両方）。年度で外れるものは untilYear を持つ。 */
  const touchTargets: Array<{ id: string; untilYear?: number }> = []
  /** 団体リーチを記録する団体。 */
  const reachTargets: string[] = []

  for (const f of FORESTS) {
    const { id } = await insertOne<{ id: string }>(db,
      `INSERT INTO partners (name, category, first_contact_date)
       VALUES ($1, $2, '2023-04-01'::date) RETURNING id`, [f.name, f.category])
    forestIdByName.set(f.name, id)
    if (!f.noTouch) touchTargets.push({ id, untilYear: f.touchUntilYear })
    if (!f.noReach) reachTargets.push(id)

    for (const c of f.communities) {
      const { id: cid } = await insertOne<{ id: string }>(db,
        `INSERT INTO partners (name, category, parent_partner_id, first_contact_date)
         VALUES ($1, 'community', $2, '2023-06-01'::date) RETURNING id`, [c, id])
      communityIdByName.set(c, cid)
      touchTargets.push({ id: cid })
    }
  }
  // 林にもリーチの記録を1つ置く。森に畳めているかを確かめる経路。
  reachTargets.push(communityIdByName.get('高校生探究部会')!)

  /**
   * 接点を付ける団体を順番に配る。
   *
   * `pick()` の乱数に任せると、シードが同じでも「この森には一度も接点が
   * 付かなかった」が静かに起こりうる。デモが経路を踏んでいないという失敗を
   * 4回繰り返しているので、確率ではなく巡回で配って全員に必ず当てる。
   */
  let touchCursor = 0
  const nextTouchPartner = (year: number) => {
    const pool = touchTargets.filter((t) => t.untilYear === undefined || year <= t.untilYear)
    return pool[touchCursor++ % pool.length]!.id
  }

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
  const seasons: SeededSeason[] = []

  for (const plan of PLANS) {
    const { id } = await insertOne<{ id: string }>(db,
      `INSERT INTO seasons (enrollment_year, outreach_start_date, application_open_date,
                            application_close_date, selection_end_date, capacity,
                            target_application_count, cohort_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [plan.year, plan.outreachStart, plan.applicationOpen, plan.applicationClose,
       plan.selectionEnd, plan.capacity, plan.target, plan.cohort])

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
    for (const pid of reachTargets) {
      for (let k = 0; k < int(1, 3); k++) {
        rows.push([pid, s.id,
          addDays(s.plan.outreachStart, int(0, 55)),
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
    approach_events: 0, score_snapshots: 0,
    appointments: 0, manual_tasks: 0,
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
    newIds.forEach((id, i) => {
      createdAt.set(id, personRows[i]![5])
    })

    // 接点
    const tpRows: Array<[string, string, string | null, string]> = []
    for (const id of newIds) {
      const first = createdAt.get(id)!
      tpRows.push([id, pick(channelIds), null, first])
      for (let k = 0; k < int(0, 3); k++) {
        const ch = pick(channelIds)
        const later = new Date(+new Date(first) + int(1, 70) * 86400000)
        if (+later > horizon) continue
        tpRows.push([id, ch,
          ch === partnerChannelId ? nextTouchPartner(plan.year) : null, iso(later)])
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

  // --- 経路を確実に踏ませる登場人物 ---
  //
  // 乱数に任せると、実データでは必ず起きるのに一度も生成されない形がある。
  // 実際、無効化された応募に評価と遷移がぶら下がる形と、同一年度に集計対象の
  // 応募が2件ある形は、どちらも一度も作られていなかった。
  // 「デモデータが検証したい経路を踏んでいない」を3回繰り返しているので、
  // 確率ではなく明示的に置く。踏んでいることは tests/13 が検査する。
  //
  // 終わった年度（2025）に置く。進行中の年度だと、選考が途中で切れて
  // 経緯が最後まで見えない。
  const finishedSeason = seasons.find((s) => s.plan.year === 2025)
  if (finishedSeason) {
    await seedPersonas(db, {
      season: finishedSeason,
      schoolId: schoolIds[0]!,
      channelIds: new Map(channels.rows.map((c) => [c.name, c.id])),
      staffIds,
      voidMergeErrorId: voidNotCounts.id,
      voidWithdrawnId: voidCounts.id,
      activeSeason: seasons.find((s) => s.plan.year === 2026),
      communityPartnerId: communityIdByName.get('起業サークル連合')!,
      stats,
    })
  }

  // どの年度にも属さない接点を1つ、明示的に置く。
  //
  // 年度の窓の外に落ちる接点は、これまで乱数の裾で偶然できていた。
  // 実行⑨で年度を4つから2つに減らしたら**1件も無くなり**、
  // 「年度未割当」の表示を一度も実行しないデータになった。
  // 偶然に頼っていた経路は、条件が変わると黙って消える。
  // 2025年度の選考終了（2025-02-20）と 2026年度の募集開始（2025-09-01）の
  // 谷に置く。ここはどの年度の窓にも入らない。
  const gapPerson = await db.query<{ id: string }>(
    `SELECT id FROM persons WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`)
  if (gapPerson.rows[0]) {
    await db.query(
      `INSERT INTO touchpoints (person_id, channel_id, occurred_at)
       VALUES ($1, $2, '2025-05-15T14:00:00+09:00')`,
      [gapPerson.rows[0].id, channelIds[0]!])
    stats.touchpoints++
  }

  // 個人情報削除の依頼（資料9-2）。応募していない Person から選ぶ。
  // 削除済みが1件も無いと、集計から外れているかを画面で確かめられない。
  const deleted = await db.query<{ id: string }>(`
    UPDATE persons SET deleted_at = now()
     WHERE id IN (
       SELECT p.id FROM persons p
        WHERE p.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.person_id = p.id)
          AND NOT EXISTS (SELECT 1 FROM staffs st WHERE st.person_id = p.id)
        ORDER BY p.created_at LIMIT 3)
     RETURNING id`)
  stats.deleted_persons = deleted.rows.length

  // --- ヘッドハンティング（アプローチと確度） ---
  //
  // 個人情報削除の**後**に置く。削除された人にもアプローチの記録を残し、
  // v_headhunting_list がそれを外していることを確かめる経路にする。
  // 「デモデータが検証したい経路を踏んでいない」を5回繰り返しているので、
  // 確率ではなく明示的に踏ませる。tests/25 が検査する。
  const activeSeason = seasons.find((s) => s.plan.year === 2026)
  if (activeSeason) {
    await seedHeadhunting(db, {
      season: activeSeason,
      staffIds,
      deletedPersonIds: deleted.rows.map((r) => r.id),
      asOf,
      int,
      pick,
      stats,
    })
  }

  return stats
}

// -------------------------------------------------------------
// ヘッドハンティング（実行⑨）
//
// アプローチの状態と、確度スコアの凍結を2回ぶん置く。
// 2回ぶん要るのは、**順位の変動が1回の算出からは作れない**ため。
// 1回しか無い状態も画面に出るが（has_previous_run = false）、
// それだけだと「変動あり」の見え方が一度も検証されない。
//
// ★ ここに置く規則の点数は**デモ専用の仮の値**である。
//   本番シードには規則を1件も入れていない（db/seeds に無い）。
//   点数と閾値は原典が「運用時に決定」と書いた値で、依頼者から
//   受け取っていない。作り物の数字を本番の初期値にしない。
// -------------------------------------------------------------

interface HeadhuntingContext {
  season: SeededSeason
  staffIds: string[]
  deletedPersonIds: string[]
  asOf: number
  int: (lo: number, hi: number) => number
  pick: <T>(xs: readonly T[]) => T
  stats: DemoStats
}

async function seedHeadhunting(db: Db, ctx: HeadhuntingContext): Promise<void> {
  const { season, staffIds, stats } = ctx
  const day = (offset: number) =>
    new Date(ctx.asOf + offset * 86_400_000).toISOString().slice(0, 10)

  const states = (await db.query<{ id: string; code: string }>(
    `SELECT id, code FROM approach_states`)).rows
  const stateId = (code: string) => states.find((s) => s.code === code)!.id

  // 対象者は「その年度に接点があり、まだ応募していない人」。
  // 応募済みの人はもう選考に乗っているので、声を掛ける相手ではない。
  const candidates = (await db.query<{ person_id: string }>(
    `SELECT DISTINCT ts.person_id
       FROM v_touchpoint_season ts
       JOIN persons p ON p.id = ts.person_id AND p.deleted_at IS NULL
      WHERE ts.season_id = $1
        AND NOT EXISTS (SELECT 1 FROM applications a
                         WHERE a.person_id = ts.person_id AND a.season_id = $1)
      ORDER BY ts.person_id
      LIMIT 60`, [season.id])).rows.map((r) => r.person_id)

  // 4つの非終端状態と、終端の見送りを一巡させる。
  // 状態が1つでも欠けると、その色のバッジが画面で一度も出ない。
  const ladder = ['not_approached', 'considering', 'approaching', 'scheduling']

  const add = async (personId: string, code: string, offset: number) => {
    const { id } = await insertOne<{ id: string }>(db,
      `INSERT INTO approach_events
         (person_id, season_id, approach_state_id, occurred_at, recorded_by_staff_id, note)
       VALUES ($1,$2,$3,$4::date + time '10:00' AT TIME ZONE 'Asia/Tokyo',$5,$6)
       RETURNING id`,
      [personId, season.id, stateId(code), day(offset), ctx.pick(staffIds), null])
    stats.approach_events++
    return id
  }

  for (const [i, personId] of candidates.entries()) {
    // 段を1つずつ上げていく。上げた回数で人ごとに到達点が変わる。
    const reach = i % 5
    if (reach === 4) {
      // 見送り。終端なのでリストから外れる。
      await add(personId, 'not_approached', -30)
      await add(personId, 'declined', -5)
      continue
    }
    for (let k = 0; k <= reach; k++) {
      await add(personId, ladder[k]!, -30 + k * 7)
    }
  }

  // 押し間違いの訂正を1件置く。打ち消し行の追記でしか直せないので、
  // その形が実データに1つも無いと、訂正チェーンの解決が一度も踏まれない。
  if (candidates.length > 0) {
    const target = candidates[0]!
    // 「見送り」を押し間違え、打ち消して「検討中」に直す。
    // 訂正行は打ち消すだけでなく、**本来あるべき状態を自分で名乗る**
    // （status_histories の訂正行が正しい transition_type を持つのと同じ）。
    // 同じ状態を書き写すと、打ち消した結果また同じ状態になり、
    // 訂正が効いているのか元のままなのか区別が付かない。
    const wrong = await add(target, 'declined', -2)
    await db.query(
      `INSERT INTO approach_events
         (person_id, season_id, approach_state_id, occurred_at, recorded_by_staff_id,
          is_correction, corrects_event_id, note)
       SELECT person_id, season_id, $2, occurred_at, recorded_by_staff_id,
              true, id, '「見送り」を押し間違えたため打ち消す'
         FROM approach_events WHERE id = $1`, [wrong, stateId('considering')])
    stats.approach_events++
  }

  // 削除済みの人にもアプローチの記録を残す。リストから外れることを確かめる。
  for (const personId of ctx.deletedPersonIds) {
    await add(personId, 'approaching', -20)
  }

  // --- 確度スコア（デモ専用の規則） ---
  const staff = staffIds[0]!
  const { id: ruleSetId } = await insertOne<{ id: string }>(db,
    `INSERT INTO scoring_rule_sets (version, created_by_staff_id, memo)
     VALUES (1, $1, 'デモ専用の仮の規則。本番の点数は未受領。') RETURNING id`, [staff])

  const rules: Array<[string, string, string | null, number | null, number, number | null]> = [
    // 条件種別, target_key, comparator, threshold, points, 半減期
    ['existence',       'has_referral',      null, null, 20, null],
    ['count_threshold', 'touchpoint_count',  '>=', 3,    25, null],
    ['count_threshold', 'touchpoint_count',  '>=', 6,    15, null],
    ['recency_days',    'last_touchpoint_on', null, 60,  40, 45],
  ]
  for (const [i, r] of rules.entries()) {
    await db.query(
      `INSERT INTO scoring_rules
         (rule_set_id, condition_type, target_key, comparator, threshold, points,
          decay_half_life_days, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [ruleSetId, r[0], r[1], r[2], r[3], r[4], r[5], i + 1])
  }

  // 2回ぶん凍結する。基準日が違えば減衰が効き、順位が動く。
  for (const offset of [-14, 0]) {
    const n = await insertOne<{ compute_score_snapshots: number }>(db,
      `SELECT compute_score_snapshots($1, $2, $3::date, $3::date)`,
      [ruleSetId, season.id, day(offset)])
    stats.score_snapshots = n.compute_score_snapshots
  }

  await seedSchedule(db, ctx, candidates)
}

// -------------------------------------------------------------
// 予定（0019）と、手で作るやること（0020）
//
// ★ 「今日」を含む週に置く。カレンダーは週表示なので、asOf から離れた
//   日付に置くと**開いた瞬間は空**になり、描けているのか壊れているのか
//   区別が付かない。実行⑨で年度を減らしたとき、偶然できていた経路が
//   黙って消えたのと同じ形を、ここでは最初から避ける。
// -------------------------------------------------------------
async function seedSchedule(
  db: Db, ctx: HeadhuntingContext, candidates: string[],
): Promise<void> {
  const { season, staffIds, stats } = ctx
  if (candidates.length === 0) return

  const kinds = (await db.query<{ id: string; code: string }>(
    `SELECT id, code FROM appointment_kinds`)).rows
  const kind = (code: string) => kinds.find((k) => k.code === code)!.id

  // ★ 週の起点は **jst_today() から取る**（asOf ではない。実行⑫で直した）。
  //   カレンダーの既定の週も tests/13 の範囲も `jst_today()` を見るので、
  //   asOf 基準に置くと、asOf と実際の今日が離れるにつれて
  //   今週に入る予定が1件ずつ減っていく ―― 実際 asOf の6日後に走らせたら
  //   5件のはずが4件になって落ちた。**基準日は、それを読む側と揃える。**
  //   すぐ下の「やること」は同じ理由で既に jst_today() を使っている。
  const todayJst = await scalar<string>(db, `SELECT jst_today()::text`)
  const todayUtc = new Date(`${todayJst}T00:00:00Z`)
  const monday = new Date(
    todayUtc.getTime() - ((todayUtc.getUTCDay() + 6) % 7) * 86_400_000)
  const at = (dayOffset: number, hour: number, minutes = 0) =>
    `${new Date(monday.getTime() + dayOffset * 86_400_000)
      .toISOString().slice(0, 10)}T${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00+09:00`

  const plan: Array<[string, number, number, number, string]> = [
    // 種別, 曜日(0=月), 開始時, 所要(時), 表題
    ['first_contact',  0, 9,  1, '初回連絡'],
    ['document_check', 1, 10, 1, '書類確認'],
    ['scheduling',     2, 13, 1, '面談調整'],
    ['casual',         3, 14, 1, 'カジュアル面談'],
    ['interview',      4, 10, 1, '面談'],
    ['internal',       4, 13, 1, '社内MTG'],
  ]

  for (const [i, [code, day, hour, span, title]] of plan.entries()) {
    const needsPerson = code !== 'internal'
    await db.query(`
      INSERT INTO appointments
        (season_id, person_id, kind_id, title, starts_at, ends_at, owner_staff_id, note)
      VALUES ($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,$7,$8)`,
    [season.id, needsPerson ? candidates[i % candidates.length]! : null, kind(code),
      title, at(day, hour), at(day, hour + span), ctx.pick(staffIds), null])
    stats.appointments++
  }

  // 取り消した予定を1件。**消さずに残す形**を実データで踏ませる。
  await db.query(`
    INSERT INTO appointments
      (season_id, person_id, kind_id, title, starts_at, ends_at, owner_staff_id,
       cancelled_at, cancel_reason)
    VALUES ($1,$2,$3,'面談（先方都合で流れた）',$4::timestamptz,$5::timestamptz,$6,
            now(),'先方都合')`,
  [season.id, candidates[0]!, kind('interview'), at(2, 16), at(2, 17), ctx.pick(staffIds)])
  stats.appointments++

  // --- 手で作るやること ---
  // 期限を「過ぎている / 今日 / 先」と、着手済みの4通りそろえる。
  // 1つでも欠けると、その見え方が画面で一度も描かれない。
  //
  // ★ 期限は **jst_today() を基準に置く**（asOf ではない）。
  //   v_manual_tasks の urgency は jst_today() と比べるので、asOf を
  //   基準にすると、asOf と実際の今日がずれた日に4通りが崩れる。
  //   実際 tests/13（asOf を固定して流す）で「要対応」が消えて落ちた。
  //   **基準日は、それを読む側と揃える。**

  const tasks: Array<[string, number, string | null, string | null, boolean]> = [
    // 表題, 期限のずれ, 時刻, 相手, 着手済みか
    ['高確度候補者にアプローチする', 0,  '14:00', candidates[0] ?? null, false],
    ['面談日程を調整する',           0,  '18:00', candidates[1] ?? null, false],
    ['書類を確認する',               1,  '12:00', candidates[2] ?? null, true],
    ['候補者リストを20名追加する',   6,  null,    null,                  false],
    ['先週の連絡漏れを追いかける',  -3,  null,    candidates[3] ?? null, false],
  ]
  for (const [title, offset, time, personId, started] of tasks) {
    await db.query(`
      INSERT INTO manual_tasks
        (season_id, person_id, title, due_on, due_time, owner_staff_id,
         created_by_staff_id, started_at)
      VALUES ($1,$2,$3, jst_today() + $4::int, $5::time,$6,$7,$8)`,
    [season.id, personId, title, offset, time,
      ctx.pick(staffIds), staffIds[0]!, started ? new Date(ctx.asOf).toISOString() : null])
    stats.manual_tasks++
  }

  // 終わったやること。開いている一覧から外れることを確かめる経路。
  await db.query(`
    INSERT INTO manual_tasks
      (season_id, title, due_on, owner_staff_id, created_by_staff_id,
       started_at, completed_at)
    VALUES ($1,'説明会の会場を押さえる', jst_today() - 7,$2,$3,now(),now())`,
  [season.id, ctx.pick(staffIds), staffIds[0]!])
  stats.manual_tasks++
}

// -------------------------------------------------------------
// 経路を確実に踏ませる登場人物
//
// 乱数で作る大勢とは別に、名前と経緯を決め打ちで置く。
// 目的は見栄えではなく、記録層のどの形が画面に出るかを固定すること。
// 何を確かめるために置いたかは persons.note に書いてあり、
// 個人の画面でそのまま読める。実在の人物ではない。
// -------------------------------------------------------------

interface PersonaContext {
  season: SeededSeason
  schoolId: string
  channelIds: Map<string, string>
  staffIds: string[]
  /** counts_as_application = false。代替の応募が生まれるので木に数えない。 */
  voidMergeErrorId: string
  /** counts_as_application = true。代替が生まれないので木に数える。 */
  voidWithdrawnId: string
  /**
   * 進行中の年度。「数えるが、動いていない」応募を置くために要る。
   * 終わった年度では判断待ちがそもそも残らないので、その形が作れない。
   */
  activeSeason?: SeededSeason
  /** 林（Community）の partner_id。森へ畳む経路を確実に踏ませるために要る。 */
  communityPartnerId: string
  stats: DemoStats
}

async function seedPersonas(db: Db, ctx: PersonaContext): Promise<void> {
  const { season, stats } = ctx
  /** JST の指定日 指定時刻。 */
  const ts = (day: string, hour: number) => at(day, 0, hour)
  const staff = (i: number) => ctx.staffIds[i % ctx.staffIds.length]!

  const person = async (spec: {
    familyName: string; givenName: string; kana: [string, string]
    email: string; createdAt: string; note: string
  }) => {
    const { id } = await insertOne<{ id: string }>(db,
      `INSERT INTO persons (family_name, given_name, family_name_kana, given_name_kana,
                            birth_date, school_id, email, created_at, note)
       VALUES ($1,$2,$3,$4,'2008-04-11',$5,$6,$7,$8) RETURNING id`,
      [spec.familyName, spec.givenName, spec.kana[0], spec.kana[1],
       ctx.schoolId, spec.email, spec.createdAt, spec.note])
    stats.persons++
    return id
  }

  const touch = async (personId: string, channel: string, day: string, hour = 15) => {
    await db.query(
      `INSERT INTO touchpoints (person_id, channel_id, occurred_at) VALUES ($1,$2,$3)`,
      [personId, ctx.channelIds.get(channel)!, ts(day, hour)])
    stats.touchpoints++
  }

  const application = async (personId: string, day: string) => {
    const { id } = await insertOne<{ id: string }>(db,
      `INSERT INTO applications (person_id, season_id, submitted_at) VALUES ($1,$2,$3)
       RETURNING id`, [personId, season.id, ts(day, 20)])
    stats.applications++
    return id
  }

  /** ステップの評価を提出済みで作り、軸ごとに点と根拠を残す。 */
  const evaluate = async (
    applicationId: string, stepIndex: number, interviewerIndex: number,
    assignedDay: string, submittedDay: string, scores: number[], rationale: string,
  ) => {
    const { id } = await insertOne<{ id: string }>(db,
      `INSERT INTO evaluations (application_id, selection_step_id, interviewer_staff_id,
                                state, assigned_at, submitted_at)
       VALUES ($1,$2,$3,'submitted',$4,$5) RETURNING id`,
      [applicationId, season.stepIds[stepIndex], staff(interviewerIndex),
       ts(assignedDay, 10), ts(submittedDay, 18)])
    stats.evaluations++

    // 再応募者限定の軸は付けない。ここの登場人物はいずれも再応募ではない。
    const criteria = season.criteriaByStep[stepIndex]!.filter((c) => !c.reapplicantOnly)
    for (const [i, c] of criteria.entries()) {
      await db.query(
        `INSERT INTO evaluation_scores (evaluation_id, criteria_id, score, rationale)
         VALUES ($1,$2,$3,$4)`,
        [id, c.id, scores[i] ?? scores[scores.length - 1] ?? 3, rationale])
      stats.scores++
    }
    return id
  }

  const advance = async (applicationId: string, stepIndex: number, day: string, by: number) => {
    await db.query(
      `INSERT INTO status_histories (application_id, transition_type, selection_step_id,
                                     occurred_at, changed_by_staff_id, note)
       VALUES ($1,'advance',$2,$3,$4,$5)`,
      [applicationId, season.stepIds[stepIndex], ts(day, 19), staff(by),
       `${STEPS[stepIndex]} 通過`])
    stats.histories++
  }

  const reject = async (applicationId: string, day: string, by: number, note: string) => {
    await db.query(
      `INSERT INTO status_histories (application_id, transition_type, occurred_at,
                                     changed_by_staff_id, note)
       VALUES ($1,'reject',$2,$3,$4)`, [applicationId, ts(day, 19), staff(by), note])
    stats.histories++
  }

  // -----------------------------------------------------------
  // 1. 名寄せ誤り。集計から外れた応募に、評価と遷移が残っている
  // -----------------------------------------------------------
  // 同じ人が別のメールアドレスで二重に登録され、後から一方の応募を
  // 名寄せ誤りとして無効化した。無効化理由の counts_as_application は false
  // なので、この応募は木に数えない（A-2）。しかし選考は実際に2ステップ
  // 進んでおり、面接官の評価も根拠も記録層に残っている。
  //
  // 集計に出ないものを個別の画面からも消すと、この記録がどこにも
  // 出なくなる。ドリルダウンが集計と同じ絞り込みをしてはいけない理由。
  const duplicate = await person({
    familyName: '三浦', givenName: '千夏', kana: ['みうら', 'ちなつ'],
    email: 'c.miura.dup@example.test', createdAt: ts('2025-10-02', 11),
    note: 'デモ用の登場人物。二重登録された側。この応募は名寄せ誤りとして'
      + '無効化されており、集計には出ないが評価と遷移は記録層に残っている。',
  })
  await touch(duplicate, 'SNS自然流入', '2025-10-02', 11)
  await touch(duplicate, '単独説明会', '2025-10-26')
  const wrongApp = await application(duplicate, '2025-11-18')
  await evaluate(wrongApp, 0, 1, '2025-11-20', '2025-11-24', [4, 4],
    '応募書類に、地域の子ども食堂で在庫管理の仕組みを作った経緯が具体的に書かれていた')
  await advance(wrongApp, 0, '2025-11-25', 1)
  await evaluate(wrongApp, 1, 2, '2025-11-27', '2025-12-02', [4, 3, 4],
    '「なぜその課題を選んだか」を自分の言葉で言い直せていた')
  await db.query(
    `UPDATE applications SET voided_at = $2, void_reason_id = $3 WHERE id = $1`,
    [wrongApp, ts('2025-12-05', 12), ctx.voidMergeErrorId])
  stats.voided++

  const surviving = await person({
    familyName: '三浦', givenName: '千夏', kana: ['みうら', 'ちなつ'],
    email: 'chinatsu.miura@example.test', createdAt: ts('2025-09-20', 16),
    note: 'デモ用の登場人物。名寄せで残った側。同姓同名・同生年月日・同校の'
      + '行が2つあり、名寄せ候補の提示（実装段階[4]）が要る形。',
  })
  await touch(surviving, '学校訪問', '2025-09-20', 16)
  await touch(surviving, '教員からの紹介', '2025-10-30')
  const rightApp = await application(surviving, '2025-12-06')
  await evaluate(rightApp, 0, 3, '2025-12-08', '2025-12-11', [4, 3],
    '無効化した応募の書類と同一の内容であることを確認したうえで評価した')
  await advance(rightApp, 0, '2025-12-12', 3)
  await evaluate(rightApp, 1, 4, '2025-12-15', '2025-12-19', [3, 3, 2],
    '取り組みの説明は具体的だったが、次に何をするかの見通しが定まっていなかった')
  await reject(rightApp, '2025-12-20', 3, '一次面接の評価により不合格')

  // -----------------------------------------------------------
  // 2. 取り下げて出し直し。同一年度に集計対象の応募が2件
  // -----------------------------------------------------------
  // 無効化理由の counts_as_application が true なので、取り下げた応募も
  // 木に数える（A-2）。同一 Person × Season に集計対象の応募が2件並ぶ。
  // 0007 で v_person_season_state を「応募をまたいだ最高到達点」に
  // 直したのはこの形が理由で、それを個人の画面で確かめられるようにする。
  const restarted = await person({
    familyName: '岩瀬', givenName: '悠', kana: ['いわせ', 'ゆう'],
    email: 'yu.iwase@example.test', createdAt: ts('2025-09-10', 13),
    note: 'デモ用の登場人物。一度取り下げてから出し直した。同一年度に'
      + '集計対象の応募が2件あり、年度の段は2件をまたいだ最高到達点になる。',
  })
  await touch(restarted, '学校訪問', '2025-09-10', 13)
  await touch(restarted, '単独説明会', '2025-10-12')
  await touch(restarted, '友人からの紹介', '2025-11-02')
  const abandoned = await application(restarted, '2025-11-05')
  await db.query(
    `UPDATE applications SET voided_at = $2, void_reason_id = $3 WHERE id = $1`,
    [abandoned, ts('2025-11-12', 10), ctx.voidWithdrawnId])
  stats.voided++

  const retried = await application(restarted, '2025-11-20')
  await evaluate(retried, 0, 5, '2025-11-22', '2025-11-26', [5, 4],
    '一度取り下げた理由と、それでも出し直した経緯が書類に書かれていた')
  await advance(retried, 0, '2025-11-27', 5)
  await evaluate(retried, 1, 6, '2025-11-30', '2025-12-04', [4, 4, 5],
    '文化祭の運営で起きた対立を、当事者双方に話を聞いて収めた経験を語った')
  await advance(retried, 1, '2025-12-05', 5)
  await evaluate(retried, 2, 7, '2025-12-10', '2025-12-16', [4, 5, 4],
    '課題の範囲を自分で絞り直したうえで、協力者を集めるところまで進めていた')
  await advance(retried, 2, '2025-12-17', 6)
  await evaluate(retried, 3, 8, '2026-01-10', '2026-01-16', [5, 4],
    'プログラムで何を得たいかを、いまの活動の続きとして説明できていた')
  await advance(retried, 3, '2026-01-20', 0)

  // どの年度の期間にも入らない接点。合格の連絡のあと、次年度の集客が
  // 始まる前に届いた1件（2026年度の選考終了 2026-02-20 と、
  // 2027年度の集客開始 2026-04-01 のあいだ）。
  //
  // この形は、かつて at() の1日ずれが偶然に作っていた（A-15）。
  // ずれを直したら消えたので、明示的に置き直した。年度の切れ目に届く
  // 連絡は実データでは必ずあり、(4)流入元が「未割当」として数えている。
  await touch(restarted, '友人からの紹介', '2026-03-10')

  // -----------------------------------------------------------
  // 3. 数えるが、動いていない。取り下げたのに判断待ちが残っている
  // -----------------------------------------------------------
  // 選考が始まる前に本人が取り下げた。無効化理由の counts_as_application は
  // true なので、応募が起きた事実として木には数える（A-2）。しかし選考は
  // 止まっており、面接官が判断すべきものは何も無い。
  //
  // ところが評価行はステップ到達時に生成済みで、pending のまま残る。
  // 判断待ち・保留・担当未割当が v_countable_applications を母集団に
  // していたため、この評価が催促され続ける形だった（A-14）。
  // 「数えるか」と「動いているか」を同じ述語で扱った結果である。
  //
  // 進行中の年度に置く。終わった年度では判断待ちがそもそも残らないので、
  // この形が一度も作られない。同じ見落としをこれで4回目にしないため。
  const active = ctx.activeSeason
  if (!active) return

  const cancelled = await person({
    familyName: '堀川', givenName: '奈々', kana: ['ほりかわ', 'なな'],
    email: 'nana.horikawa@example.test', createdAt: ts('2026-05-18', 14),
    note: 'デモ用の登場人物。応募後、選考が始まる前に取り下げた。'
      + '木には数えるが、いま動いてはいない。判断待ちに出てはいけない。',
  })
  await touch(cancelled, '学校訪問', '2026-05-18', 14)
  const { id: cancelledApp } = await insertOne<{ id: string }>(db,
    `INSERT INTO applications (person_id, season_id, submitted_at) VALUES ($1,$2,$3)
     RETURNING id`, [cancelled, active.id, ts('2026-07-10', 20)])
  stats.applications++
  // 担当未割当のまま残す。第1ステップは面接官なしで評価行が生成される。
  await db.query(
    `INSERT INTO evaluations (application_id, selection_step_id, state, assigned_at)
     VALUES ($1,$2,'pending',$3)`,
    [cancelledApp, active.stepIds[0], ts('2026-07-11', 10)])
  stats.evaluations++
  await db.query(
    `UPDATE applications SET voided_at = $2, void_reason_id = $3 WHERE id = $1`,
    [cancelledApp, ts('2026-07-18', 10), ctx.voidWithdrawnId])
  stats.voided++

  // -----------------------------------------------------------
  // 4. 林から来た人が、森の要注意として上がってくる
  // -----------------------------------------------------------
  // 0012 で足した経路を確実に踏ませる。
  //
  //   接点が林（Community）に付いている
  //     → v_partner_forest が親の森へ畳む
  //       → v_forest_season_activity にその人の応募と滞留が乗る
  //         → コックピットの「要注意の森」に出る
  //
  // 乱数に任せると、林に接点が付いた人がその年度に応募し、なおかつ
  // SLA を超えて滞留する、という重なりが起きるとは限らない。
  // デモが経路を踏んでいないという失敗を4回繰り返しているので明示的に置く。
  //
  // SLA 超過を「今日」に依存させない。二次面接の sla_days は 7 日で、
  // 割り当てを応募開始直後に固定しているため、いつ流しても超過している。
  const stalled = await person({
    familyName: '柏木', givenName: '朔', kana: ['かしわぎ', 'さく'],
    email: 'saku.kashiwagi@example.test', createdAt: ts('2026-06-20', 10),
    note: 'デモ用の登場人物。林（起業サークル連合）経由で識別され、'
      + '進行中の年度に応募したが、二次面接の評価が SLA を超えて止まっている。'
      + '森の要注意がどの事実から立ち上がるかを確かめるために置いた。',
  })
  await db.query(
    `INSERT INTO touchpoints (person_id, channel_id, partner_id, occurred_at)
     VALUES ($1,$2,$3,$4)`,
    [stalled, ctx.channelIds.get('提携団体イベント')!, ctx.communityPartnerId,
     ts('2026-06-20', 10)])
  stats.touchpoints++

  const { id: stalledApp } = await insertOne<{ id: string }>(db,
    `INSERT INTO applications (person_id, season_id, submitted_at) VALUES ($1,$2,$3)
     RETURNING id`, [stalled, active.id, ts('2026-07-03', 21)])
  stats.applications++

  // 書類選考は通した。評価と根拠を残す（rationale は必須）。
  const { id: screening } = await insertOne<{ id: string }>(db,
    `INSERT INTO evaluations (application_id, selection_step_id, interviewer_staff_id,
                              state, assigned_at, submitted_at)
     VALUES ($1,$2,$3,'submitted',$4,$5) RETURNING id`,
    [stalledApp, active.stepIds[0], staff(2), ts('2026-07-04', 10), ts('2026-07-06', 18)])
  stats.evaluations++
  for (const c of active.criteriaByStep[0]!.filter((c) => !c.reapplicantOnly)) {
    await db.query(
      `INSERT INTO evaluation_scores (evaluation_id, criteria_id, score, rationale)
       VALUES ($1,$2,4,$3)`,
      [screening, c.id, '所属していた学生団体で、後輩向けの勉強会を自分で立ち上げていた'])
    stats.scores++
  }
  await db.query(
    `INSERT INTO status_histories (application_id, transition_type, selection_step_id,
                                   occurred_at, changed_by_staff_id, note)
     VALUES ($1,'advance',$2,$3,$4,'書類選考 通過')`,
    [stalledApp, active.stepIds[0], ts('2026-07-07', 19), staff(2)])
  stats.histories++

  // 一次面接も通した。
  const { id: first } = await insertOne<{ id: string }>(db,
    `INSERT INTO evaluations (application_id, selection_step_id, interviewer_staff_id,
                              state, assigned_at, submitted_at)
     VALUES ($1,$2,$3,'submitted',$4,$5) RETURNING id`,
    [stalledApp, active.stepIds[1], staff(3), ts('2026-07-09', 10), ts('2026-07-12', 18)])
  stats.evaluations++
  for (const c of active.criteriaByStep[1]!.filter((c) => !c.reapplicantOnly)) {
    await db.query(
      `INSERT INTO evaluation_scores (evaluation_id, criteria_id, score, rationale)
       VALUES ($1,$2,4,$3)`,
      [first, c.id, '勉強会が続かなかった理由を、自分の準備不足として説明していた'])
    stats.scores++
  }
  await db.query(
    `INSERT INTO status_histories (application_id, transition_type, selection_step_id,
                                   occurred_at, changed_by_staff_id, note)
     VALUES ($1,'advance',$2,$3,$4,'一次面接 通過')`,
    [stalledApp, active.stepIds[1], ts('2026-07-13', 19), staff(3)])
  stats.histories++

  // 二次面接で止まっている。担当は決まっているのに判断が下りていない。
  //
  // 面接官を2人置く。`evaluations_assignment_key` は
  // (application_id, selection_step_id, interviewer_staff_id, attempt) なので、
  // 1つのステップを複数の面接官が評価する形は記録層が最初から許している。
  //
  // これを置く理由は、**やることの「件」と待っている人の「人」が
  // 一致しない形をデモに作ること**である。乱数で作る大勢は、選考が
  // 順番に進むため1人につき開いている評価が1件しかなく、件と人が常に
  // 一致していた。常に一致するデータでは、画面が2つを混同していても
  // 気づけない。tests/13 がこの形の存在を検査する。
  // ★ 片方は**今日から数えて**割り当てる（C-206）。
  //   固定日だけで作ると、日が進むにつれ全件が期限切れへ倒れ、
  //   「期限内のやること」が1件も無いデータになる（実際そうなって落ちた）。
  //   期限内と期限切れが**同時に在る**形を、日付が進んでも保つ。
  for (const [i, interviewer] of [staff(4), staff(5)].entries()) {
    await db.query(
      i === 0
        ? `INSERT INTO evaluations (application_id, selection_step_id, interviewer_staff_id,
                                    state, assigned_at)
           VALUES ($1,$2,$3,'pending',$4)`
        : `INSERT INTO evaluations (application_id, selection_step_id, interviewer_staff_id,
                                    state, assigned_at)
           VALUES ($1,$2,$3,'pending', now() - interval '1 day')`,
      i === 0
        ? [stalledApp, active.stepIds[2], interviewer, ts('2026-07-15', 10)]
        : [stalledApp, active.stepIds[2], interviewer])
    stats.evaluations++
  }

  // -----------------------------------------------------------
  // 5. 紹介者が面接官のまま、判断待ちで止まっている
  // -----------------------------------------------------------
  // v_open_tasks の 'reassign'（担当を替える）は、判断がまだ下りていない
  // 利益相反だけを出す。替えても戻らない submitted は出さない。
  //
  // 実測すると、乱数で生まれる利益相反は3件すべて submitted だった。
  // つまりこの分岐は一度も踏まれていなかった。判断待ちの評価から
  // 利益相反を除いている側（'evaluate' の NOT EXISTS）も、
  // 同時に一度も効いていなかったことになる。
  // 「デモデータが検証したい経路を踏んでいない」を5回目にしないため、
  // 紹介者がそのまま面接官になっている形を明示的に置く。
  const mentor = await person({
    familyName: '長瀬', givenName: '巧', kana: ['ながせ', 'たくみ'],
    email: 'takumi.nagase@example.test', createdAt: ts('2025-09-05', 10),
    note: 'デモ用の登場人物。卒業生で、いまは運営として面接も担当する。'
      + '自分が紹介した応募者の面接官に割り当たっており、利益相反が出ている。',
  })
  const { id: mentorStaff } = await insertOne<{ id: string }>(db,
    `INSERT INTO staffs (person_id, display_name, email)
     VALUES ($1, '長瀬 巧', 'takumi.nagase.staff@example.test') RETURNING id`, [mentor])

  const { id: referred } = await insertOne<{ id: string }>(db,
    `INSERT INTO persons (family_name, given_name, family_name_kana, given_name_kana,
                          birth_date, school_id, email, created_at, referrer_person_id, note)
     VALUES ('都築','ひかり','つづき','ひかり','2008-04-11',$1,$2,$3,$4,$5) RETURNING id`,
    [ctx.schoolId, 'hikari.tsuzuki@example.test', ts('2026-06-25', 16), mentor,
     'デモ用の登場人物。紹介者がそのまま面接官に割り当たっている。'
     + 'コックピットには「評価する」ではなく「担当を替える」として出る。'])
  stats.persons++
  await db.query(
    `INSERT INTO touchpoints (person_id, channel_id, occurred_at) VALUES ($1,$2,$3)`,
    [referred, ctx.channelIds.get('卒業生からの紹介')!, ts('2026-06-25', 16)])
  stats.touchpoints++

  const { id: referredApp } = await insertOne<{ id: string }>(db,
    `INSERT INTO applications (person_id, season_id, submitted_at) VALUES ($1,$2,$3)
     RETURNING id`, [referred, active.id, ts('2026-07-08', 20)])
  stats.applications++
  await db.query(
    `INSERT INTO evaluations (application_id, selection_step_id, interviewer_staff_id,
                              state, assigned_at)
     VALUES ($1,$2,$3,'pending',$4)`,
    [referredApp, active.stepIds[0], mentorStaff, ts('2026-07-09', 10)])
  stats.evaluations++

  // -----------------------------------------------------------
  // 7. 1期で不合格 → 2期に再応募して合格
  // -----------------------------------------------------------
  // **再応募者限定の評価軸に点が付く唯一の経路。**
  //
  // これは元々、乱数で「たまたま」できていた。実行⑨で3期を足したら
  // 乱数の並びがずれ、**1件も無くなってテストが落ちた。**
  // 「偶然に頼っていた経路は、条件が変わると黙って消える」を、
  // 予定と接点に続いてここでも踏んだ。だから明示的に置く。
  const returner = await person({
    familyName: '早坂', givenName: '結', kana: ['はやさか', 'ゆい'],
    email: 'yui.hayasaka@example.test', createdAt: ts('2024-10-05', 11),
    note: 'デモ用の登場人物。1期で最終面接まで進んで不合格になり、'
      + '2期に再応募して合格した。再応募者限定の評価軸に点が付く唯一の経路。',
  })
  await touch(returner, '単独説明会', '2024-10-05', 11)

  // 1期（終わった期）。最終面接まで進んで不合格。
  const firstTry = await application(returner, '2024-11-20')
  for (const [i, day] of ['2024-11-27', '2024-12-06', '2024-12-18'].entries()) {
    await evaluate(firstTry, i, i, day, day, [4, 4, 3], '1期の評価。あと一歩だった。')
    await advance(firstTry, i, day, i)
  }
  await evaluate(firstTry, 3, 3, '2025-01-10', '2025-01-10', [3, 3, 3],
    '1期の最終面接。方向性が定まっていなかった。')
  await reject(firstTry, '2025-01-15', 3, '1期は最終面接で不合格。')

  // 2期（進行中の期）へ再応募。**is_reapplication = true** にしないと、
  // 再応募者限定の軸をトリガが弾く。
  const { id: secondTry } = await insertOne<{ id: string }>(db,
    `INSERT INTO applications (person_id, season_id, submitted_at, is_reapplication)
     VALUES ($1,$2,$3,true) RETURNING id`,
    [returner, active.id, ts('2025-11-20', 20)])
  stats.applications++

  const reappraise = async (stepIndex: number, day: string, note: string) => {
    const { id } = await insertOne<{ id: string }>(db,
      `INSERT INTO evaluations (application_id, selection_step_id, interviewer_staff_id,
                                state, assigned_at, submitted_at)
       VALUES ($1,$2,$3,'submitted',$4,$5) RETURNING id`,
      [secondTry, active.stepIds[stepIndex], staff(stepIndex),
        ts(day, 10), ts(day, 18)])
    stats.evaluations++
    // ここでは再応募者限定の軸も**外さない**（この応募は再応募だから付く）。
    for (const c of active.criteriaByStep[stepIndex]!) {
      await db.query(
        `INSERT INTO evaluation_scores (evaluation_id, criteria_id, score, rationale)
         VALUES ($1,$2,$3,$4)`, [id, c.id, 4, note])
      stats.scores++
    }
    await db.query(
      `INSERT INTO status_histories (application_id, transition_type, selection_step_id,
                                     occurred_at, changed_by_staff_id, note)
       VALUES ($1,'advance',$2,$3,$4,$5)`,
      [secondTry, active.stepIds[stepIndex], ts(day, 19), staff(stepIndex),
        `${STEPS[stepIndex]} 通過（再応募）`])
    stats.histories++
  }

  for (const [i, day] of ['2025-11-27', '2025-12-08', '2025-12-19', '2026-01-14'].entries()) {
    await reappraise(i, day, '2期の評価。1期からの変化がはっきり出ている。')
  }
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

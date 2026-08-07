/**
 * 採点官のペルソナが討論する、募集〜選考のシミュレーション。
 *
 * **これは Pilot の観測ではない。** 誰も運営として使っていない
 * （Validated Operator Problem は0件のまま）。ここで出す数字は
 * 「作り物のデータから出た数字をドキュメントに残さない」（`CLAUDE.md` 9節）
 * に従い、レポートには**シミュレーションの結果として明記**する。
 *
 * 何を「実データの軸」にしているか。
 *   - 年度・4ステップ・評価6軸（各4点満点）・書類16点満点は
 *     `db/seeds/0002_season_2026.production.sql` の**実在する値**をそのまま使う
 *   - 氏名・学校・応募日・点数・討論の内容は**全部架空**（同じ単位、違う数値）
 *
 * `channels` は本番シードで0件（D-14）。接点を記録するには channel_id が
 * NOT NULL なので、**このスクリプトのその場限りの DB にだけ**仮のチャネルを
 * 作る。db/seeds/ には書かない ―― 入れたら消せないマスタを、
 * シミュレーションのために本番へ持ち込まない。
 *
 * 使い方:
 *   node scripts/simulate-selection.ts small   # 4採点官 x 30応募者
 *   node scripts/simulate-selection.ts large   # 10採点官 x 40応募者
 *   node scripts/simulate-selection.ts both    # 両方（既定）
 */
import { writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { freshDb } from '../src/db/testing.ts'
import { all, one, maybeOne, scalar, type Db } from '../src/db/client.ts'
import { assignInterviewer, reassignInterviewer } from '../src/commands/assign.ts'
import { saveScore } from '../src/commands/score.ts'
import { submitEvaluation, decideStep } from '../src/commands/decide.ts'
import { holdEvaluation } from '../src/commands/hold.ts'
import { unholdEvaluation } from '../src/commands/unhold.ts'

// -------------------------------------------------------------
// 固定シードの疑似乱数。同じ回はいつでも再現できる。
// -------------------------------------------------------------
function makeRng(seed: number) {
  let s = seed
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
}
const pick = <T,>(rand: () => number, xs: T[]) => xs[Math.floor(rand() * xs.length)]!
const shuffled = <T,>(rand: () => number, xs: T[]) =>
  xs.map((x) => [rand(), x] as const).sort((a, b) => a[0] - b[0]).map((p) => p[1])

// -------------------------------------------------------------
// 架空の候補者名・学校。実データの氏名とは無関係。
// -------------------------------------------------------------
const FAMILY = ['桜庭', '早乙女', '天音', '風間', '海野', '月島', '星野', '雨宮', '朝霧', '夕凪',
  '橘', '藤堂', '氷室', '雪村', '緑川', '青柳', '紅林', '紫藤', '金城', '黒瀬']
const GIVEN = ['碧', '澄', '悠', '奏', '陽', '凛', '結', '翔', '葵', '楓',
  '蒼', '光', '桔梗', '朔', '瑛', '透', '遥', '晴', '真央', '直']
const SCHOOLS = ['臨海大学', '緑丘学院大学', '北稜工業大学', '中央芸術大学', '南部商科大学']

interface Persona {
  name: string
  voice: string
  /** 各軸の点に加える傾向。-1〜+1 程度。 */
  bias: Record<string, number>
  /** その軸の点について、このペルソナらしい一言を作る。 */
  comment: (axis: string, score: number, max: number) => string
}

/** 採点官のペルソナ。4人の基本形＋量を増やすときの追加形。 */
const BASE_PERSONAS: Persona[] = [
  {
    name: '面接官・長谷', voice: '地頭力を重視する。減点方式で厳しめ',
    bias: { 地頭力: 0.6, 素直さ: -0.3, 熱量: -0.2 },
    comment: (axis, score, max) => score >= max - 1
      ? `${axis}は筋が通っていた。質問への返しが速い。`
      : `${axis}はまだ浅い。深掘りへの反応が弱かった。`,
  },
  {
    name: '面接官・宮下', voice: '熱量と人柄を重視する。加点方式で温かい',
    bias: { 熱量: 0.7, 笑顔: 0.4, 前提超越: -0.2 },
    comment: (axis, score, max) => score >= max - 1
      ? `${axis}に本気度を感じた。伸びる余地がある。`
      : `${axis}はもう少し見たい。緊張していたのかもしれない。`,
  },
  {
    name: '面接官・道明寺', voice: '前提を疑う質問を好む。中立寄りでブレが少ない',
    bias: { 前提超越: 0.5 },
    comment: (axis, score, max) => score >= max - 1
      ? `${axis}、前提を自分で崩しにいく発言があった。`
      : `${axis}は模範解答の範囲に留まった。`,
  },
  {
    name: '面接官・国見', voice: 'リスペクトと素直さの一貫性を見る。記録係も兼ねる',
    bias: { リスペクト: 0.5, 素直さ: 0.4 },
    comment: (axis, score, max) => score >= max - 1
      ? `${axis}、指摘への受け止め方が誠実だった。`
      : `${axis}、防御的な反応が先に出ていた。`,
  },
]

/** 採点官を増やすときに使う、控えめな追加ペルソナ。 */
const EXTRA_VOICES = ['冷静で票が割れたときの決め役', '若手で基準がまだ揺れる',
  '外部パートナー枠。学生団体の視点を持つ', '事務局兼任。時間に厳しい',
  '創業メンバー。熱量にだけ極端に反応する', '新任。前の面接官の点に引かれやすい']

function makeJudgePool(count: number, rand: () => number): Persona[] {
  const pool = [...BASE_PERSONAS]
  let i = 0
  while (pool.length < count) {
    const v = EXTRA_VOICES[i % EXTRA_VOICES.length]
    pool.push({
      name: `面接官・臨時${i + 1}`, voice: v!,
      bias: pick(rand, BASE_PERSONAS).bias,
      comment: (axis, score, max) => score >= max - 1 ? `${axis}は良い印象。` : `${axis}は平均的。`,
    })
    i++
  }
  return pool.slice(0, count)
}

// -------------------------------------------------------------
// 記録は2種類に分ける。「討論で割れた」は想定内の出来事で、
// 「気づき」はコマンドが期待どおり ok を返さなかった実際の異常だけを入れる。
// 混ぜると、正常な討論の件数がバグの件数のように見える。
// -------------------------------------------------------------
interface Friction { where: string; what: string }
const friction: Friction[] = []
const debates: Friction[] = []
const note = (where: string, what: string) => { friction.push({ where, what }) }
const debateLog = (where: string, what: string) => { debates.push({ where, what }) }

// -------------------------------------------------------------
// 世界の下ごしらえ。
// -------------------------------------------------------------
interface World {
  db: Db
  seasonId: string
  steps: Array<{ id: string; name: string; sort_order: number }>
  finalCriteria: Array<{ id: string; name: string; scale_max: number; sort_order: number }>
  judges: Array<{ id: string; persona: Persona }>
  schoolIds: string[]
  channelId: string
}

async function setupWorld(judgeCount: number, rand: () => number): Promise<World> {
  const db = await freshDb({ seeds: 'production' })
  const season = await one<{ id: string }>(db, `SELECT id FROM seasons`)
  const steps = await all<{ id: string; name: string; sort_order: number }>(
    db, `SELECT id, name, sort_order FROM selection_steps ORDER BY sort_order`)
  const finalStep = steps.find((s) => s.name === '最終面接')!
  const finalCriteria = await all<{ id: string; name: string; scale_max: number; sort_order: number }>(
    db, `SELECT id, name, scale_max, sort_order FROM evaluation_criteria
          WHERE selection_step_id = $1 ORDER BY sort_order`, [finalStep.id])

  const schoolIds: string[] = []
  for (const name of SCHOOLS) {
    schoolIds.push(await scalar<string>(
      db, `INSERT INTO schools (name) VALUES ($1) RETURNING id`, [`${name}（シミュレーション）`]))
  }

  const personas = makeJudgePool(judgeCount, rand)
  const judges: World['judges'] = []
  let judgeIndex = 0
  for (const persona of personas) {
    // persona.name は日本語なので \W ではなく連番で email の一意性を保つ。
    const id = await scalar<string>(db, `
      INSERT INTO staffs (display_name, email) VALUES ($1, $2) RETURNING id`,
      [persona.name, `judge${judgeIndex++}@sim.example.test`])
    judges.push({ id, persona })
  }

  // **実データの受け入れ口 db/seeds/ には書かない。** ここは使い捨ての
  // シミュレーション用 DB（freshDb）にだけ、その場で作って捨てる。
  // channels が本番0件のままだと接点を記録できない（C-31）ことは変わらない。
  const channelId = await scalar<string>(db, `
    INSERT INTO channels (name, category) VALUES ('シミュレーション用チャネル', 'event')
    RETURNING id`)

  return { db, seasonId: season.id, steps, finalCriteria, judges, schoolIds, channelId }
}

// -------------------------------------------------------------
// 応募者を1人つくる。説明会・問い合わせの接点を先に付ける。
// -------------------------------------------------------------
async function makeApplicant(w: World, rand: () => number, index: number) {
  const family = pick(rand, FAMILY)
  const given = pick(rand, GIVEN)
  const tag = `${family}${given}${index}`
  const birthDate = new Date(2004 + Math.floor(rand() * 4), 3, 1 + Math.floor(rand() * 300))
  const person = await scalar<string>(w.db, `
    INSERT INTO persons (family_name, given_name, birth_date, school_id, email)
    VALUES ($1, $2, $3::date, $4, $5)
    RETURNING id`,
    [family, given, birthDate.toISOString().slice(0, 10), pick(rand, w.schoolIds), `${tag}@sim.example.test`])

  // 応募前の接点（説明会参加）。3/3〜3/9 のあいだ（応募開始 3/10 の前、実在の日程）。
  const day = String(3 + Math.floor(rand() * 6)).padStart(2, '0')
  await w.db.query(`
    INSERT INTO touchpoints (person_id, channel_id, occurred_at, attended_at, is_self_reported)
    VALUES ($1, $2, $3::timestamptz, $3::timestamptz, true)`,
    [person, w.channelId, `2026-03-${day} 19:00+09`])

  const submitDay = String(10 + Math.floor(rand() * 13)).padStart(2, '0') // 応募実績 3/10〜3/22（実在）
  const appId = await scalar<string>(w.db, `
    INSERT INTO applications (person_id, season_id, submitted_at)
    VALUES ($1, $2, $3::timestamptz)
    RETURNING id`, [person, w.seasonId, `2026-03-${submitDay} 12:00+09`])

  return { personId: person, appId, name: `${family} ${given}` }
}

// -------------------------------------------------------------
// 段ごとの通過。
// -------------------------------------------------------------
async function ensureEvaluation(w: World, appId: string, stepId: string) {
  const found = await maybeOne<{ id: string }>(w.db, `
    SELECT id FROM evaluations WHERE application_id = $1 AND selection_step_id = $2`,
    [appId, stepId])
  if (found) return found.id
  return scalar<string>(w.db, `
    INSERT INTO evaluations (application_id, selection_step_id, assigned_at)
    VALUES ($1, $2, now()) RETURNING id`, [appId, stepId])
}

/** 軸の無い段（応募受付・書類選考・グループ面接）を、委員会の一言つきで通す。 */
async function passWithoutCriteria(
  w: World, appId: string, step: { id: string; name: string }, rand: () => number,
  passRate: number, panel: World['judges'],
): Promise<{ advanced: boolean; noteText: string }> {
  const evalId = await ensureEvaluation(w, appId, step.id)
  const cur = await one<{ interviewer_staff_id: string | null }>(
    w.db, `SELECT interviewer_staff_id FROM evaluations WHERE id = $1`, [evalId])
  const lead = pick(rand, panel)
  if (!cur.interviewer_staff_id) {
    const a = await assignInterviewer(w.db, { evaluationId: evalId, staffId: lead.id })
    if (!a.ok) note(step.name, `assign が ${a.reason}`)
  }

  // 軸が無いので、点は付けずに確定できる（C-33）。委員会の所感だけを
  // status_histories.note に残す ―― 実務ではここが唯一の記録になる。
  const s = await submitEvaluation(w.db, { evaluationId: evalId })
  if (!s.ok) note(step.name, `submit が ${s.reason}`)

  const votes = shuffled(rand, panel).slice(0, Math.min(3, panel.length))
  const advance = rand() < passRate
  const remarks = votes.map((j) => `${j.persona.name}: ${
    advance ? '通過でよい' : '見送りが妥当'
  }（${j.persona.voice}）`).join(' / ')
  const noteText = `${step.name}の合議: ${remarks}`

  const d = await decideStep(w.db, {
    applicationId: appId, decision: advance ? 'advance' : 'reject',
    staffId: lead.id, note: noteText,
  })
  if (!d.ok) note(step.name, `decide が ${d.reason}`)
  return { advanced: advance, noteText }
}

/** 最終面接。全採点官が独立に採点し、合議して1本のスコアへ収束させる。 */
async function finalInterview(
  w: World, appId: string, step: { id: string; name: string }, rand: () => number,
  panel: World['judges'], round: RoundReport,
) {
  const evalId = await ensureEvaluation(w, appId, step.id)
  const lead = pick(rand, panel)
  const cur = await one<{ interviewer_staff_id: string | null }>(
    w.db, `SELECT interviewer_staff_id FROM evaluations WHERE id = $1`, [evalId])
  if (!cur.interviewer_staff_id) {
    const a = await assignInterviewer(w.db, { evaluationId: evalId, staffId: lead.id })
    if (!a.ok) note(step.name, `assign が ${a.reason}`)
  }

  // ときどき保留を挟む（追加提出待ち）。C-35 で足した経路を実際に使う。
  if (rand() < 0.08) {
    const h = await holdEvaluation(w.db, { evaluationId: evalId, reason: '面接メモの追記待ち' })
    if (!h.ok) note(step.name, `hold が ${h.reason}`)
    const u = await unholdEvaluation(w.db, { evaluationId: evalId })
    if (!u.ok) note(step.name, `unhold が ${u.reason}`)
  }
  // ときどき担当を替える（急な予定変更を想定）。
  if (rand() < 0.06 && panel.length > 1) {
    const other = pick(rand, panel.filter((j) => j.id !== lead.id))
    const r = await reassignInterviewer(w.db, { evaluationId: evalId, staffId: other.id })
    if (!r.ok) note(step.name, `reassign が ${r.reason}`)
  }

  let total = 0
  const axisSummaries: string[] = []
  for (const criteria of w.finalCriteria) {
    const raters = shuffled(rand, panel).slice(0, Math.min(4, panel.length))
    const votes = raters.map((j) => {
      const raw = 2.2 + (j.persona.bias[criteria.name] ?? 0) * 1.5 + (rand() - 0.5) * 2.2
      const score = Math.min(criteria.scale_max, Math.max(1, Math.round(raw)))
      return { judge: j, score }
    })
    const scores = votes.map((v) => v.score).sort((a, b) => a - b)
    const mid = scores[Math.floor(scores.length / 2)]!
    const spread = scores.at(-1)! - scores[0]!

    round.axisSpread.push({ axis: criteria.name, spread })
    if (spread >= 2) {
      debateLog('最終面接・討論', `「${criteria.name}」で ${scores[0]} 〜 ${scores.at(-1)} まで割れた（合議で ${mid} に収束）`)
    }

    const commentary = votes.map((v) => `${v.judge.persona.name}(${v.score}): ${v.judge.persona.comment(criteria.name, v.score, criteria.scale_max)}`).join(' ')
    const rationale = spread >= 2
      ? `${commentary} → 割れたため合議。最終 ${mid}/${criteria.scale_max}。`
      : `${commentary} → 合議は一致。最終 ${mid}/${criteria.scale_max}。`

    const r = await saveScore(w.db, {
      evaluationId: evalId, criteriaId: criteria.id, score: mid, rationale,
    })
    if (!r.ok) note(step.name, `採点(${criteria.name}) が ${r.reason}`)
    total += mid
    axisSummaries.push(`${criteria.name}:${mid}`)
  }

  const s = await submitEvaluation(w.db, { evaluationId: evalId })
  if (!s.ok) note(step.name, `submit が ${s.reason}`)

  const maxTotal = w.finalCriteria.reduce((sum, c) => sum + c.scale_max, 0)
  const ratio = total / maxTotal
  const advance = ratio >= 0.62
  const closing = `最終面接の合議（${axisSummaries.join(' / ')}、合計 ${total}/${maxTotal}）: `
    + (advance ? '合格相当として次へ進める。' : '今回は見送り。')
  const d = await decideStep(w.db, {
    applicationId: appId, decision: advance ? 'advance' : 'reject',
    staffId: lead.id, note: closing,
  })
  if (!d.ok) note(step.name, `decide が ${d.reason}`)
  return { total, maxTotal, advance }
}

// -------------------------------------------------------------
// 1周分のレポート。
// -------------------------------------------------------------
interface RoundReport {
  label: string
  applicants: number
  judges: number
  funnel: Record<string, number>
  accepted: number
  withdrawn: number
  axisSpread: Array<{ axis: string; spread: number }>
  friction: Friction[]
  debates: Friction[]
  invariantFailures: string[]
}

async function runRound(label: string, applicants: number, judgeCount: number, seed: number): Promise<RoundReport> {
  const rand = makeRng(seed)
  const w = await setupWorld(judgeCount, rand)
  const funnel: Record<string, number> = {}
  let accepted = 0
  let withdrawn = 0
  const roundFriction: Friction[] = []
  const roundDebates: Friction[] = []
  friction.length = 0
  debates.length = 0

  const report: RoundReport = {
    label, applicants, judges: judgeCount, funnel, accepted: 0, withdrawn: 0,
    axisSpread: [], friction: roundFriction, debates: roundDebates, invariantFailures: [],
  }

  const panel = w.judges
  for (let i = 0; i < applicants; i++) {
    const { appId } = await makeApplicant(w, rand, i)

    // 段1: 応募受付。ごく一部が早期に辞退する（連絡不通など）。
    funnel['応募受付'] = (funnel['応募受付'] ?? 0) + 1
    if (rand() < 0.05) {
      await w.db.query(`
        INSERT INTO status_histories (application_id, transition_type, withdraw_reason_id,
                                      occurred_at, changed_by_staff_id, note)
        SELECT $1, 'withdraw', wr.id, now(), $2, '応募後に連絡が取れなくなった（シミュレーション）'
          FROM withdraw_reasons wr WHERE wr.code = 'unconfirmed'`,
        [appId, pick(rand, panel).id])
      withdrawn++
      continue
    }
    await passWithoutCriteria(w, appId, w.steps[0]!, rand, 1, panel) // 応募受付は原則通す

    // 段2: 書類選考。
    funnel['書類選考'] = (funnel['書類選考'] ?? 0) + 1
    const r2 = await passWithoutCriteria(w, appId, w.steps[1]!, rand, 0.7, panel)
    if (!r2.advanced) continue

    // 段3: グループ面接。
    funnel['グループ面接'] = (funnel['グループ面接'] ?? 0) + 1
    const r3 = await passWithoutCriteria(w, appId, w.steps[2]!, rand, 0.72, panel)
    if (!r3.advanced) continue

    // 段4: 最終面接。討論して収束させる。
    funnel['最終面接'] = (funnel['最終面接'] ?? 0) + 1
    const r4 = await finalInterview(w, appId, w.steps[3]!, rand, panel, report)
    if (r4.advance) accepted++
  }

  // 20周テスト（tests/23）と同じ不変条件を、シミュレーションの結果にもかける。
  const dup = await scalar<number>(w.db, `
    SELECT count(*)::int FROM (
      SELECT source_id FROM v_open_tasks GROUP BY source_id HAVING count(*) > 1) x`)
  if (dup > 0) report.invariantFailures.push(`やることの二重計上 ${dup} 件`)

  const blank = await scalar<number>(w.db, `
    SELECT count(*)::int FROM evaluation_scores WHERE rationale IS NULL OR btrim(rationale) = ''`)
  if (blank > 0) report.invariantFailures.push(`根拠が空の点 ${blank} 件`)

  const acceptedFlag = await scalar<number>(
    w.db, `SELECT count(*)::int FROM v_application_state WHERE is_accepted`)
  if (acceptedFlag !== accepted) {
    report.invariantFailures.push(`合格の数が合わない（記録 ${acceptedFlag} / 集計 ${accepted}）`)
  }

  report.accepted = acceptedFlag
  report.withdrawn = withdrawn
  report.friction.push(...friction)
  report.debates.push(...debates)
  await w.db.close()
  return report
}

// -------------------------------------------------------------
// 実行
// -------------------------------------------------------------
async function main() {
  const arg = process.argv[2] ?? 'both'
  // 週を分けて再実行するときに、同じ2つの乱数だけをなぞらないための起点。
  // 既定は週1。週2は `WEEK=2 node scripts/simulate-selection.ts both` で回す。
  const week = Number(process.env.WEEK ?? '1')
  const outDir = fileURLToPath(new URL('./sim-out/', import.meta.url))
  await mkdir(outDir, { recursive: true })

  const rounds: RoundReport[] = []
  if (arg === 'small' || arg === 'both') {
    console.log(`=== 小規模（週${week}）: 採点官4人 x 応募者30人 ===`)
    rounds.push(await runRound(`小規模・週${week}（4人 x 30人）`, 30, 4, 20260807 + week * 1000))
  }
  if (arg === 'large' || arg === 'both') {
    console.log(`=== 大規模（週${week}）: 採点官10人 x 応募者40人 ===`)
    rounds.push(await runRound(`大規模・週${week}（10人 x 40人）`, 40, 10, 20260808 + week * 1000))
  }

  for (const r of rounds) {
    console.log(`\n--- ${r.label} ---`)
    console.log('  ファネル:', r.funnel)
    console.log(`  合格 ${r.accepted} / 辞退 ${r.withdrawn}`)
    console.log(`  不変条件: ${r.invariantFailures.length === 0 ? 'すべて成立' : r.invariantFailures.join(' / ')}`)
    console.log(`  討論で割れた回数: ${r.debates.length} / ${r.axisSpread.length}`)
    console.log(`  気づき（想定外の異常）: ${r.friction.length} 件`)
  }

  await writeFile(`${outDir}${arg}-week${week}.json`, JSON.stringify(rounds, null, 2))
  console.log(`\n詳細: ${outDir}${arg}-week${week}.json`)
}

await main()

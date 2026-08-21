/**
 * 平社員ペルソナ5人が**同時に**模擬選考を回す1周（C-216）。
 *
 * ★★ **本番へは触らない。** `DATABASE_URL` があれば実行しない。
 *   書く先は `YOUTHDB_PGDATA`（既定 `.pgdata-pilot`）だけである。
 *
 * ★ 画面を置き換える道具ではない。**画面が呼ぶのと同じコマンド**を、
 *   5人分**並行に**走らせて、同時に触ったときに何が起きるかを見る
 *   ―― 画面をひとつずつ押す限りでは、この衝突は起きない。
 *   画面の側は、この周のあとにブラウザで実際に見て確かめる。
 *
 * ペルソナ（記録者の名前は `pilot-db.ts` が作る）
 *   P1 新人・青木     ―― 選考を始め、応募受付を通す
 *   P2 兼任・井川     ―― イベントの参加者を記録する
 *   P3 数字担当・上原 ―― 書類選考に点を付けて確定する
 *   P4 現場・江口     ―― 保留と解除
 *   P5 交代要員・大野 ―― 判定の訂正
 *
 * 使い方:
 *   node scripts/pilot-round.ts        # 1周まわす
 */
import { join } from 'node:path'
import { openPglite } from '../src/db/pglite.ts'
import { all, maybeOne, scalar, type Db } from '../src/db/client.ts'
import { assignInterviewer } from '../src/commands/assign.ts'
import { saveScore } from '../src/commands/score.ts'
import {
  submitEvaluation, decideStep, startSelection, correctDecision, getCorrectableDecision,
} from '../src/commands/decide.ts'
import { holdEvaluation } from '../src/commands/hold.ts'
import { unholdEvaluation } from '../src/commands/unhold.ts'
import { setEventAttendance } from '../src/commands/attend.ts'
import { gateOfScores } from '../src/queries/document_screening.ts'

if (process.env.DATABASE_URL) {
  console.error('pilot-round は捨てるDB専用。DATABASE_URL が設定されているため実行しない。')
  process.exit(1)
}

const db: Db = await openPglite(join(process.cwd(), process.env.YOUTHDB_PGDATA ?? '.pgdata-pilot'))
const log: string[] = []
const say = (s: string) => { log.push(s); console.log(s) }

const seasonId = await scalar<string>(db,
  `SELECT id FROM seasons WHERE cohort_number = 2 AND NOT is_demo`)
const staffOf = async (name: string) => scalar<string>(db,
  `SELECT id FROM staffs WHERE display_name = $1`, [name])
const P1 = await staffOf('新人・青木')
const P2 = await staffOf('兼任・井川')
const P3 = await staffOf('数字担当・上原')
const P4 = await staffOf('現場・江口')
const P5 = await staffOf('交代要員・大野')

const stepId = async (name: string) => scalar<string>(db,
  `SELECT id FROM selection_steps WHERE season_id = $1 AND name = $2`, [seasonId, name])
const DOC = await stepId('書類選考')
const INTAKE = await stepId('応募受付')

const evaluationOf = (applicationId: string, step: string) =>
  maybeOne<{ id: string; state: string }>(db, `
    SELECT id, state FROM evaluations
     WHERE application_id = $1 AND selection_step_id = $2
     ORDER BY attempt DESC LIMIT 1`, [applicationId, step])

const apps = await all<{ id: string; person_id: string }>(db, `
  SELECT a.id, a.person_id FROM applications a
   WHERE a.season_id = $1 ORDER BY a.submitted_at LIMIT 8`, [seasonId])

// -------------------------------------------------------------
// P1 選考を始め、応募受付を通す（8件）
// -------------------------------------------------------------
async function p1(from: number, to: number) {
  let started = 0
  for (const a of apps.slice(from, to)) {
    const r = await startSelection(db, a.id)
    if (r.ok) started++
    const ev = await evaluationOf(a.id, INTAKE)
    if (!ev) { say(`P1 ✗ ${a.id.slice(0, 8)} 応募受付の評価行が無い`); continue }
    if (ev.state === 'pending') await assignInterviewer(db, { evaluationId: ev.id, staffId: P1 })
    const s = await submitEvaluation(db, { evaluationId: ev.id })
    if (!s.ok) { say(`P1 ✗ 応募受付を確定できない: ${s.reason}`); continue }
    const d = await decideStep(db, { applicationId: a.id, decision: 'advance', staffId: P1 })
    if (!d.ok) say(`P1 ✗ 応募受付の判定ができない: ${d.reason}`)
  }
  say(`P1 選考を始めた ${started} 件（${from + 1}〜${to} 番目）/ 応募受付を通した`)
}

// -------------------------------------------------------------
// P3 書類選考に点を付けて確定する
// -------------------------------------------------------------
async function p3() {
  const criteria = await all<{ id: string; name: string; scale_max: number }>(db, `
    SELECT id, name, scale_max FROM evaluation_criteria
     WHERE selection_step_id = $1 ORDER BY sort_order`, [DOC])
  let scored = 0
  let pass = 0
  let watch = 0
  for (const [i, a] of apps.entries()) {
    const ev = await evaluationOf(a.id, DOC)
    if (!ev) continue                        // まだ応募受付を通っていない（同時なので起こる）
    if (ev.state === 'pending') await assignInterviewer(db, { evaluationId: ev.id, staffId: P3 })
    // 通る人と要注意の人を混ぜる。**架空の点である。**
    const plan = i % 3 === 0 ? [4, 2, 2, 2] : i % 3 === 1 ? [3, 2, 1, 2] : [2, 1, 1, 1]
    const filled: { score: number | null; scale_max: number }[] = []
    // ★ 最後の1人は**途中で手が止まった**ことにする（実際の運用で起きる）。
    //   確定していない採点が画面に残り、門のラベルが「採点中」になる。
    const leaveOpen = i === apps.length - 1
    for (const [j, c] of criteria.entries()) {
      if (leaveOpen && j === criteria.length - 1) { filled.push({ score: null, scale_max: Number(c.scale_max) }); continue }
      const point = Math.min(plan[j] ?? 1, Number(c.scale_max))
      const r = await saveScore(db, {
        evaluationId: ev.id, criteriaId: c.id, score: point,
        rationale: `模擬：${c.name} を ${point} 点と見た`,
      })
      if (!r.ok) { say(`P3 ✗ 点を付けられない（${c.name}）: ${r.reason}`); continue }
      filled.push({ score: point, scale_max: Number(c.scale_max) })
    }
    const gate = gateOfScores(filled)
    if (gate.verdict === 'pass') pass++
    if (gate.verdict === 'watch') watch++
    if (leaveOpen) {
      say(`P3 － 最後の1人は途中で止めた（門は「${gate.verdict === 'incomplete' ? '採点中' : gate.verdict}」）`)
      continue
    }
    const s = await submitEvaluation(db, { evaluationId: ev.id })
    if (!s.ok) say(`P3 ✗ 書類選考を確定できない: ${s.reason}`)
    else scored++
  }
  say(`P3 書類選考を採点・確定 ${scored} 件（門の内訳 通過 ${pass} / 要注意 ${watch}）`)
}

// -------------------------------------------------------------
// P4 保留して解く（同じ評価を P3 が触っている最中に起こる）
// -------------------------------------------------------------
async function p4() {
  const target = apps[3]
  if (!target) return
  const ev = await evaluationOf(target.id, DOC) ?? await evaluationOf(target.id, INTAKE)
  if (!ev) { say('P4 － 保留する評価がまだ無い'); return }
  const noReason = await holdEvaluation(db, { evaluationId: ev.id, reason: '  ' })
  say(`P4 理由なしの保留は ${noReason.ok ? '★通ってしまった（穴）' : `弾かれた（${noReason.reason}）`}`)
  const held = await holdEvaluation(db, {
    evaluationId: ev.id, reason: '模擬：提出書類の一部が届いていない',
  })
  if (!held.ok) { say(`P4 ✗ 保留できない: ${held.reason}`); return }
  const scoreWhileHeld = await saveScore(db, {
    evaluationId: ev.id,
    criteriaId: await scalar<string>(db,
      `SELECT id FROM evaluation_criteria WHERE selection_step_id = $1 ORDER BY sort_order LIMIT 1`,
      [DOC]),
    score: 1, rationale: '模擬：保留中に点を入れようとした',
  })
  say(`P4 保留中の採点は ${scoreWhileHeld.ok ? '★通ってしまった（穴）' : `弾かれた（${scoreWhileHeld.reason}）`}`)
  const un = await unholdEvaluation(db, { evaluationId: ev.id })
  say(`P4 保留を解いた: ${un.ok ? 'できた' : `できない（${un.reason}）`}`)
}

// -------------------------------------------------------------
// P5 判定を訂正する（前任の判断をやり直す）
// -------------------------------------------------------------
async function p5() {
  const target = apps[1]
  if (!target) return
  const current = await getCorrectableDecision(db, target.id)
  if (!current) { say('P5 － 訂正できる判定がまだ無い'); return }
  const stale = await correctDecision(db, {
    applicationId: target.id, historyId: current.history_id, staffId: P5,
    note: '模擬：前任の判断を見直した',
  })
  say(`P5 判定の訂正: ${stale.ok ? 'できた' : `できない（${stale.reason}）`}`)
  // ★ 同じ行をもう一度訂正できてはいけない（見ていた行が既に打ち消されている）。
  const twice = await correctDecision(db, {
    applicationId: target.id, historyId: current.history_id, staffId: P5,
  })
  say(`P5 同じ行の二重訂正は ${twice.ok ? '★通ってしまった（穴）' : `弾かれた（${twice.reason}）`}`)
}

// -------------------------------------------------------------
// P2 イベントの参加者を記録する
// -------------------------------------------------------------
async function p2() {
  const appt = await maybeOne<{ id: string }>(db, `
    SELECT a.id FROM appointments a
      JOIN appointment_kinds k ON k.id = a.kind_id AND k.code = 'event'
     WHERE a.season_id = $1 ORDER BY a.starts_at LIMIT 1`, [seasonId])
  if (!appt) { say('P2 ✗ イベントが無い'); return }
  const r = await setEventAttendance(db, {
    appointmentId: appt.id, seasonId,
    personIds: apps.slice(0, 4).map((a) => a.person_id),
  })
  say(`P2 イベントの参加記録: ${r.ok ? '4人を記録した' : `できない（${r.reason}）`}`)
  // 記録した人を含めて数え直す（画面が出す値と同じ経路）。
  const n = await scalar<number>(db,
    `SELECT count(*)::int FROM event_attendances WHERE appointment_id = $1`, [appt.id])
  say(`P2 参加者の数（記録から）: ${n}`)
  void P2
}

/**
 * 通し（`--through`）。1人を最終面接まで運ぶ。
 *
 * ★ 一覧のタブ（2次選考＝グループ面接 / 最終選考＝最終面接）が、
 *   最後の段まで正しく人を出すかを確かめるために要る ――
 *   段の取り違えは、最後の段で初めて分かることがある。
 */
async function through() {
  const GROUP = await stepId('グループ面接')
  const FINAL = await stepId('最終面接')
  const target = apps[0]
  if (!target) return
  for (const [step, name] of [[GROUP, 'グループ面接'], [FINAL, '最終面接']] as const) {
    const ev = await evaluationOf(target.id, step)
    if (!ev) { say(`通し ✗ ${name} の評価行が無い（道が切れている）`); return }
    if (ev.state === 'pending') await assignInterviewer(db, { evaluationId: ev.id, staffId: P4 })
    const criteria = await all<{ id: string; name: string; scale_max: number }>(db, `
      SELECT id, name, scale_max FROM evaluation_criteria
       WHERE selection_step_id = $1 AND applies_to <> 'reapplicant_only'
       ORDER BY sort_order`, [step])
    for (const c of criteria) {
      await saveScore(db, {
        evaluationId: ev.id, criteriaId: c.id, score: Number(c.scale_max),
        rationale: `模擬：${c.name} は満点と見た`,
      })
    }
    const s = await submitEvaluation(db, { evaluationId: ev.id })
    if (!s.ok) { say(`通し ✗ ${name} を確定できない: ${s.reason}`); return }
    const d = await decideStep(db, { applicationId: target.id, decision: 'advance', staffId: P4 })
    if (!d.ok) { say(`通し ✗ ${name} の判定ができない: ${d.reason}`); return }
    say(`通し ${name} を通過（軸 ${criteria.length} 本）`)
  }
  const outcome = await scalar<string>(db,
    `SELECT outcome FROM v_application_outcome WHERE application_id = $1`, [target.id])
  say(`通し 最後の結末: ${outcome}`)
}

// ★ 実際の職場と同じ**時間差**を作る ――
//   誰か1人が先行して段を作り、**その途中に**残りが入ってくる。
//   最初から全員を同時に放つと、他の4人は「まだ何も無い」で終わり、
//   衝突が1件も起きない（第2周の1回目で実際にそうなった）。
await Promise.all([p1(0, 4), p2()])
await Promise.all([p1(4, 8), p3(), p4(), p5()])

// 書類選考を通過させてから通す（`--through` のときだけ）。
if (process.argv.includes('--through')) {
  const first = apps[0]
  if (first) {
    const d = await decideStep(db, {
      applicationId: first.id, decision: 'advance', staffId: P3,
    })
    say(`通し 書類選考の判定: ${d.ok ? '通過' : `できない（${d.reason}）`}`)
  }
  await through()
}

// 残り具合
const counts = await all<{ label: string; n: number }>(db, `
      SELECT '評価行'      AS label, count(*) AS n FROM evaluations
UNION ALL SELECT '点',         count(*) FROM evaluation_scores
UNION ALL SELECT '状態の履歴', count(*) FROM status_histories
UNION ALL SELECT '参加記録',   count(*) FROM event_attendances`)
say(`この周で積んだ記録: ${counts.map((c) => `${c.label} ${Number(c.n)}`).join(' / ')}`)

await db.close()

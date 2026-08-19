import { intakePath } from './intake-dir.ts'
import { join } from 'node:path'
import { openPostgres } from '../src/db/postgres.ts'
import { Workbook } from '../src/import/xlsx.ts'
import {
  planCommonRequirements, planTrackRequirements, planSelectionRequirements,
  planPersonas, planCourseTargets,
} from '../src/import/recruitment_plan_2026.ts'
import type { Db } from '../src/db/client.ts'

/**
 * 募集要項・ペルソナ・KPI目標を本番へ入れる（依頼者の指示。実行⑯。C-162）。
 *
 *   pnpm import:recruitment-plan            突き合わせだけ（既定。書かない）
 *   pnpm import:recruitment-plan --apply    実際に入れる
 *
 * ★ どちらの期へ入れるかは、**表の中の日付から判断した**（依頼者に指示は
 *   受けていない）。この判断は誤り得るので、報告に理由を明示する。
 *
 *   KPI（006）とペルソナ（015）    ―― 表の日付（2/21・3/11・3/12・3/17…）が
 *     すべて**2期の集客期間（2026-01-31〜03-21）に収まる**。2期の実績・計画。
 *   トラック比較・選考基準（募集要項の新設部分） ―― 「アクセラコースへの
 *     編入」「PJT共創コース」など**まだ動いていない制度**の設計で、末尾に
 *     「どこまで仕上げますか？」と作成中の注記がある。3期の計画として入れる。
 *
 * ★ 個人情報は扱わない。3表とも氏名・連絡先を含まない。
 */

const XLSX = intakePath('2期応募管理2.xlsx')
const apply = process.argv.includes('--apply')

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL が無い。`.env.local` を読める形で実行する。')
  process.exit(1)
}
console.log(`書き込み先: ${/@([^/:]+)/.exec(url)?.[1] ?? '(不明)'}`
  + `${apply ? '  ★ --apply（実際に書く）' : '  （既定：書かない）'}\n`)

const book = new Workbook(XLSX)
const db: Db = await openPostgres(url)
const one = async <T>(sql: string, p?: unknown[]) => ((await db.query<T>(sql, p)).rows[0] ?? null)
const all = async <T>(sql: string, p?: unknown[]) => (await db.query<T>(sql, p)).rows

const season2 = await one<{ id: string }>(`SELECT id FROM seasons WHERE cohort_number = 2`)
const season3 = await one<{ id: string }>(`SELECT id FROM seasons WHERE cohort_number = 3`)
if (!season2 || !season3) throw new Error('2期か3期が無い')

// -------------------------------------------------------------
// 突き合わせ
// -------------------------------------------------------------
const commonReq = planCommonRequirements(book)
const trackReq = planTrackRequirements(book)
const selectionReq = planSelectionRequirements(book)
const personas = planPersonas(book)
const courses = planCourseTargets(book)
const tacticsTotal = courses.reduce((n, c) => n + c.tactics.length, 0)

console.log('募集要項（3期へ入れる）')
console.log(`  共通軸        ${commonReq.length} 条`)
console.log(`  トラック比較   ${trackReq.length} 条`
  + `（${[...new Set(trackReq.map((r) => r.category))].join('／')}）`)
console.log(`  選考基準       ${selectionReq.length} 条`)
console.log(`\nペルソナ（2期へ入れる）        ${personas.length} 件`)
console.log(`\nKPI目標（2期へ入れる）         ${courses.length} 束・施策 ${tacticsTotal} 件`)

const existingReq = await all<{ season_id: string; n: number }>(
  `SELECT season_id, count(*)::int AS n FROM season_requirements GROUP BY season_id`)
const existingPersonas = await one<{ n: number }>(
  `SELECT count(*)::int AS n FROM recruitment_personas WHERE season_id = $1`, [season2.id])
const existingCourses = await one<{ n: number }>(
  `SELECT count(*)::int AS n FROM recruitment_course_targets WHERE season_id = $1`, [season2.id])

console.log(`\n本番に既にある要項      ${existingReq.reduce((n, r) => n + r.n, 0)} 条`)
console.log(`本番に既にあるペルソナ   ${existingPersonas?.n ?? 0} 件`)
console.log(`本番に既にあるKPI束     ${existingCourses?.n ?? 0} 件`)

if (!apply) {
  console.log('\n書いていない。入れるなら --apply を付ける。')
  await db.close()
  process.exit(0)
}

// -------------------------------------------------------------
// 書く。1つの取引にする。
// -------------------------------------------------------------
await db.exec('BEGIN')
let reqAdded = 0
for (const r of [...commonReq, ...trackReq, ...selectionReq]) {
  const done = await db.query(`
    INSERT INTO season_requirements (season_id, category, body, sort_order)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (season_id, category, body) DO NOTHING
    RETURNING id`, [season3.id, r.category, r.body, r.sortOrder])
  reqAdded += done.rows.length
}

let personasAdded = 0
if ((existingPersonas?.n ?? 0) === 0) {
  for (const [i, p] of personas.entries()) {
    await db.query(`
      INSERT INTO recruitment_personas
        (season_id, segment, name, headcount, tagline, problem, value_proposition,
         features, target, target_needs, desired_feeling, guest_candidates, exit_image,
         sort_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [season2.id, p.segment, p.name, p.headcount, p.tagline, p.problem, p.valueProposition,
      p.features, p.target, p.targetNeeds, p.desiredFeeling, p.guestCandidates, p.exitImage,
      i + 1])
    personasAdded++
  }
} else {
  console.log('\nペルソナは既に入っている。二重に作らない（表を丸ごと差し替えたいときは先に消す）。')
}

let coursesAdded = 0
let tacticsAdded = 0
if ((existingCourses?.n ?? 0) === 0) {
  for (const [i, c] of courses.entries()) {
    const row = await one<{ id: string }>(`
      INSERT INTO recruitment_course_targets
        (season_id, category, course_label, segment_label, target_accepted,
         target_applicants, target_briefing, target_reach, sort_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [season2.id, c.category, c.courseLabel, c.segmentLabel, c.targetAccepted,
      c.targetApplicants, c.targetBriefing, c.targetReach, i + 1])
    coursesAdded++
    for (const [j, t] of c.tactics.entries()) {
      await db.query(`
        INSERT INTO recruitment_tactics
          (course_target_id, label, briefing_actual, reach_actual, progress_ratio,
           priority, detail, starts_on, ends_on, owner, remark, sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [row!.id, t.label, t.briefingActual, t.reachActual, t.progressRatio,
        t.priority, t.detail, t.startsOn, t.endsOn, t.owner, t.remark, j + 1])
      tacticsAdded++
    }
  }
} else {
  console.log('KPI束は既に入っている。二重に作らない。')
}

await db.exec('COMMIT')

console.log('\n入れた ――')
console.log(`  募集要項   ${reqAdded} 条（3期）`)
console.log(`  ペルソナ   ${personasAdded} 件（2期）`)
console.log(`  KPI束      ${coursesAdded} 件・施策 ${tacticsAdded} 件（2期）`)

await db.close()

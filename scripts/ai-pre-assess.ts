import { openPostgres } from '../src/db/postgres.ts'
import { all, maybeOne } from '../src/db/client.ts'
import { assessApplication } from '../src/ai/pre_assessment.ts'
import { recordAiPreAssessment, listAiPreLabels } from '../src/commands/ai_pre_assessment.ts'

/**
 * 応募回答をAIで下読みし、**事前ステータス**を付ける（依頼者の指示。実行⑯。C-164）。
 *
 *   pnpm ai:pre-assess --season 2027            件数を数えるだけ（既定。**書かない**）
 *   pnpm ai:pre-assess --season 2027 --apply    実際に付ける
 *   pnpm ai:pre-assess --season 2027 --limit 5  ためしに5件だけ
 *
 * ★★ **点は付けない。** 書き先は `ai_pre_assessments`（0044）だけ。
 *   `evaluation_scores` へは触らない ―― 依頼者の指示：
 *   「通常の成績としては扱わない」。
 *
 * ★ 既定は書かない（C-61）。
 * ★ **氏名・メール・電話はAPIへ送らない**（`pre_assessment.ts` の頭注）。
 *   出力にも出さない。件数だけを出す。
 * ★ 既に事前ステータスがある人は飛ばす。`--again` で付け直す
 *   （付け直しても前の分析は消えない。打ち消し行で積まれる）。
 */

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const again = args.includes('--again')
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const year = Number(opt('season'))
const limit = Number(opt('limit') ?? '0')
if (!Number.isInteger(year)) { console.error('--season <年> が要る'); process.exit(1) }

const url = process.env.DATABASE_URL
if (!url) { console.error('DATABASE_URL が無い。`.env.local` を読める形で実行する。'); process.exit(1) }
const host = /@([^/:]+)/.exec(url)?.[1] ?? '(不明)'
console.log(`書き込み先: ${host}${apply ? '  ★ --apply（実際に書く）' : '  （既定：書かない）'}\n`)

const db = await openPostgres(url)

const season = await maybeOne<{ id: string }>(db,
  `SELECT id FROM seasons WHERE enrollment_year = $1 AND NOT is_demo`, [year])
if (!season) { console.error(`${year}年度の期が無い`); process.exit(1) }

// 書類選考の段。AI分析はここの前さばきである。
const step = await maybeOne<{ id: string }>(db,
  `SELECT id FROM selection_steps WHERE season_id = $1 AND name = '書類選考'`, [season.id])
if (!step) { console.error('書類選考の段が無い'); process.exit(1) }

const labels = await listAiPreLabels(db)
if (labels.length === 0) { console.error('札が無い（seed 0009 未適用）'); process.exit(1) }

// 回答が結び付いていて、まだ分析していない人。
const targets = await all<{ person_id: string; raw: Record<string, unknown> }>(db, `
  SELECT f.person_id, f.raw
    FROM form_responses f
    JOIN persons p ON p.id = f.person_id AND p.deleted_at IS NULL
   WHERE f.person_id IS NOT NULL
     ${again ? '' : `AND NOT EXISTS (
           SELECT 1 FROM v_ai_pre_assessment a
            WHERE a.person_id = f.person_id AND a.season_id = $1
              AND a.selection_step_id = $2)`}
   ORDER BY f.submitted_at`, [season.id, step.id])

const queue = limit > 0 ? targets.slice(0, limit) : targets
console.log(`対象: ${queue.length}件${limit > 0 ? `（全${targets.length}件のうち）` : ''}`)

if (!apply) {
  console.log('（既定：書いていない。--apply を付けると分析して記録する）')
  await db.close()
  process.exit(0)
}

/** 氏名・連絡先にあたる設問はAPIへ送らない。 */
const IDENTITY = /氏名|名前|ふりがな|フリガナ|メール|mail|電話|tel|line|住所/i

let done = 0
const counts = new Map<string, number>()
const failed: string[] = []
for (const t of queue) {
  const answers = Object.entries(t.raw ?? {})
    .filter(([q]) => !IDENTITY.test(q))
    .map(([q, a]) => ({ question: q, answer: String(a ?? '') }))
    .filter((a) => a.answer.trim() !== '')
  if (answers.length === 0) continue

  try {
    const got = await assessApplication({ labels, answers })
    const r = await recordAiPreAssessment(db, {
      personId: t.person_id, seasonId: season.id, selectionStepId: step.id,
      labelCode: got.label, rationale: got.rationale, model: got.model,
      source: 'form_responses.raw',
    })
    if (r.ok) {
      done += 1
      counts.set(got.label, (counts.get(got.label) ?? 0) + 1)
    } else failed.push(r.reason)
  } catch (e) {
    failed.push(e instanceof Error ? e.name : 'unknown')
  }
}

console.log(`\n付けた: ${done}件`)
for (const [label, n] of counts) console.log(`  ${label}: ${n}件`)
if (failed.length > 0) {
  const by = new Map<string, number>()
  for (const f of failed) by.set(f, (by.get(f) ?? 0) + 1)
  console.log(`付かなかった: ${failed.length}件`)
  for (const [why, n] of by) console.log(`  ${why}: ${n}件`)
}
await db.close()

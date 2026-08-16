import { openPostgres } from '../src/db/postgres.ts'
import { maybeOne } from '../src/db/client.ts'
import { assessApplication, SCALE_MAX } from '../src/ai/pre_assessment.ts'
import { recordAiPreAssessment, listAiPreLabels } from '../src/commands/ai_pre_assessment.ts'
import { listAiPreAssessmentTargets } from '../src/queries/ai_pre_assessment.ts'

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

const labels = await listAiPreLabels(db)
if (labels.length === 0) { console.error('札が無い（seed 0009 未適用）'); process.exit(1) }

/**
 * ★ 回答の置き場所は `form_responses` **ではない**（本番の帳簿で確かめた）。
 *   2期の応募フォームは `person_notes` に入っている ――
 *   `involvement` が「2期の応募フォーム（1/2）」のような語で、
 *   長い回答は分割されて複数行になっている（`import-application-forms.ts`）。
 *   だから**その人の分をまとめてから**渡す。
 *
 * ★ その期に応募がある人だけを対象にする。応募していない人の回答を
 *   その期の書類選考の下読みに使うと、母集団が画面と食い違う。
 */
const targets = await listAiPreAssessmentTargets(db, season.id, again)

const queue = limit > 0 ? targets.slice(0, limit) : targets
console.log(`対象: ${queue.length}件${limit > 0 ? `（全${targets.length}件のうち）` : ''}`)

if (!apply) {
  console.log('（既定：書いていない。--apply を付けると分析して記録する）')
  await db.close()
  process.exit(0)
}

let done = 0
let total = 0
const counts = new Map<string, number>()
const failed: string[] = []
for (const t of queue) {
  // ★ 設問と回答が1本の文章に混ざっている。**こちらで切り分けない** ――
  //   区切り方を推測すると、推測が外れた分だけ回答が欠ける。丸ごと渡す。
  const answers = [{ question: '応募フォームの回答', answer: t.body ?? '' }]
  if (answers[0]!.answer.trim() === '') continue

  try {
    const got = await assessApplication({ labels, answers })
    const r = await recordAiPreAssessment(db, {
      personId: t.person_id, seasonId: season.id, selectionStepId: t.selection_step_id,
      labelCode: got.label, rationale: got.rationale, model: got.model,
      source: 'person_notes（応募フォーム）',
      viewpoints: got.viewpoints.map((v) => ({ ...v, scaleMax: SCALE_MAX })),
    })
    if (r.ok) {
      done += 1
      counts.set(got.label, (counts.get(got.label) ?? 0) + 1)
      total += got.viewpoints.reduce((s, v) => s + v.score, 0)
    } else failed.push(r.reason)
  } catch (e) {
    failed.push(e instanceof Error ? `${e.name}: ${e.message}` : 'unknown')
  }
}

console.log(`\n付けた: ${done}件`)
if (done > 0) {
  console.log(`  論理性の平均: ${(total / done).toFixed(1)} / ${SCALE_MAX}点`)
}
for (const [label, n] of counts) console.log(`  ${label}: ${n}件`)
if (failed.length > 0) {
  const by = new Map<string, number>()
  for (const f of failed) by.set(f, (by.get(f) ?? 0) + 1)
  console.log(`付かなかった: ${failed.length}件`)
  for (const [why, n] of by) console.log(`  ${why}: ${n}件`)
}
await db.close()

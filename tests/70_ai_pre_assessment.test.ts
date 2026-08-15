import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { scalar, all, maybeOne, type Db } from '../src/db/client.ts'
import { baseFixture, makeSeason, makePerson } from './support/fixtures.ts'
import {
  recordAiPreAssessment, listAiPreLabels,
} from '../src/commands/ai_pre_assessment.ts'
import { parseCsv } from '../src/import/csv.ts'
import { TARGETS } from '../src/ai/ingest_plan.ts'

/**
 * AI分析は事前ステータスであって、成績ではない（0044。C-164。依頼者の指示）。
 *
 * 依頼者の言葉（実行⑯）――「ClaudAPIで叩くのは、エクセル、CSVを入れたら
 * 勝手にDBに反映してくれるシステムと、AI分析と称した事前ステータスだけで良い。
 * 通常の成績としては扱わない」。
 *
 * 固定したいのは4つ ――
 *   ① ★ AI分析は `evaluation_scores` に**一切入らない**
 *   ② 記録できる。再分析すると現在値が入れ替わる
 *   ③ ★ 入れ替えても**前の分析は消えない**（打ち消し行が積まれる）
 *   ④ 段は**その期のもの**でなければ受け付けない
 *
 * ★ APIは呼ばない。**外部サービスに依存するテストは書かない** ――
 *   落ちた理由が自分の欠陥か外の不調か分からなくなる。
 *   ここで確かめるのは、AIが出した結果の**置き場所と作法**である。
 */

describe('AI分析の事前ステータス（C-164）', () => {
  let db: Db
  let personId: string
  let seasonId: string
  let stepId: string
  let otherStepId: string

  before(async () => {
    db = await freshDb()
    const base = await baseFixture(db)
    const season = await makeSeason(db, { year: 2026 })
    seasonId = season.id
    stepId = season.stepIds[0]!
    otherStepId = (await makeSeason(db, { year: 2027 })).stepIds[0]!
    personId = await makePerson(db, base.schoolId, { familyName: '架空', givenName: '分析' })
  })

  test('札は3つ。成績の段階ではないので点を持たない', async () => {
    const labels = await listAiPreLabels(db)
    assert.deepEqual(labels.map((l) => l.code), ['注目', '標準', '要確認'])
  })

  test('記録すると、いまの事前ステータスになる', async () => {
    const r = await recordAiPreAssessment(db, {
      personId, seasonId, selectionStepId: stepId, labelCode: '標準',
      rationale: '4観点いずれも記述はあるが、際立った点は無い。',
      model: 'claude-opus-5', source: 'application_answers',
    })
    assert.equal(r.ok, true)
    const now = await maybeOne<{ label: string; model: string }>(db, `
      SELECT label, model FROM v_ai_pre_assessment
       WHERE person_id = $1 AND season_id = $2 AND selection_step_id = $3`,
    [personId, seasonId, stepId])
    assert.equal(now?.label, '標準')
    assert.equal(now?.model, 'claude-opus-5')
  })

  test('★ 再分析すると入れ替わるが、前の分析は消えない', async () => {
    const r = await recordAiPreAssessment(db, {
      personId, seasonId, selectionStepId: stepId, labelCode: '注目',
      rationale: 'やり遂げた実績の記述が具体的である。',
      model: 'claude-opus-5', source: 'application_answers',
    })
    assert.equal(r.ok, true)
    assert.notEqual(r.ok && r.previousId, null, '打ち消し先が記録されていない')

    const now = await scalar<string>(db, `
      SELECT label FROM v_ai_pre_assessment
       WHERE person_id = $1 AND season_id = $2 AND selection_step_id = $3`,
    [personId, seasonId, stepId])
    assert.equal(now, '注目')

    // 有効な行は1つだが、台帳には2行残っている。
    const kept = Number(await scalar(db, `
      SELECT count(*) FROM ai_pre_assessments WHERE person_id = $1`, [personId]))
    assert.equal(kept, 2, '前の分析が消えている（追記専用が効いていない）')
    const effective = await all(db, `
      SELECT id FROM v_effective_ai_pre_assessments WHERE person_id = $1`, [personId])
    assert.equal(effective.length, 1)
  })

  test('★★ AI分析は成績（evaluation_scores）へ入っていない', async () => {
    const scores = Number(await scalar(db, `SELECT count(*) FROM evaluation_scores`))
    assert.equal(scores, 0, 'AI分析が点として混ざっている')
    // 記録層にも軸への道が無い。
    const fk = Number(await scalar(db, `
      SELECT count(*) FROM information_schema.columns
       WHERE table_name = 'ai_pre_assessments'
         AND column_name IN ('criterion_id', 'score', 'points')`))
    assert.equal(fk, 0, 'AI分析の表が点や軸を持ってしまっている')
  })

  test('別の期の段には付けられない', async () => {
    const r = await recordAiPreAssessment(db, {
      personId, seasonId, selectionStepId: otherStepId, labelCode: '標準',
      rationale: 'x', model: 'claude-opus-5', source: 'application_answers',
    })
    assert.equal(r.ok, false)
    assert.equal(!r.ok && r.reason, 'step_not_found')
  })

  test('理由・モデル・出どころは必須（後から再現できるように）', async () => {
    for (const [patch, reason] of [
      [{ rationale: '  ' }, 'rationale_required'],
      [{ model: '' }, 'model_required'],
      [{ source: '' }, 'source_required'],
    ] as const) {
      const r = await recordAiPreAssessment(db, {
        personId, seasonId, selectionStepId: stepId, labelCode: '標準',
        rationale: 'x', model: 'claude-opus-5', source: 'application_answers',
        ...patch,
      })
      assert.equal(!r.ok && r.reason, reason)
    }
  })
})

describe('CSV の読み取り（C-164）', () => {
  test('★ 引用符の中の改行とカンマは値の一部', () => {
    const rows = parseCsv('氏名,備考\r\n架空 太郎,"東京都,港区\n1-2-3"\r\n')
    assert.deepEqual(rows[0], ['氏名', '備考'])
    assert.deepEqual(rows[1], ['架空 太郎', '東京都,港区\n1-2-3'])
    assert.equal(rows.length, 2, '引用符内の改行で行が割れている')
  })

  test('二重の引用符は1つの引用符', () => {
    assert.deepEqual(parseCsv('a,"b""c"')[0], ['a', 'b"c'])
  })

  test('BOM を落とす（1列目の見出しが化けない）', () => {
    assert.equal(parseCsv('﻿氏名,年齢')[0]![0], '氏名')
  })

  test('空欄は空文字として残る（列がずれない）', () => {
    assert.deepEqual(parseCsv('a,,c')[0], ['a', '', 'c'])
  })
})

describe('取り込みの入れ先（C-164）', () => {
  test('★ AIが選べる入れ先は固定されている（SQLを書かせない）', () => {
    // 増減は構わないが、**氏名と連絡先という骨は必ずある。**
    for (const k of ['familyName', 'givenName', 'email']) {
      assert.ok(k in TARGETS, `${k} が入れ先に無い`)
    }
    // 期・学校・担当など、**取り違えると記録が壊れる欄は含めない。**
    for (const k of ['seasonId', 'schoolId', 'staffId', 'channelId']) {
      assert.ok(!(k in TARGETS), `${k} をAIに選ばせてはいけない`)
    }
  })
})

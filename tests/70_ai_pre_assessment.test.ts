import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { scalar, all, maybeOne, type Db } from '../src/db/client.ts'
import { baseFixture, makeSeason, makePerson, makeApplication } from './support/fixtures.ts'
import {
  recordAiPreAssessment, listAiPreLabels,
} from '../src/commands/ai_pre_assessment.ts'
import { parseCsv } from '../src/import/csv.ts'
import { TARGETS } from '../src/ai/ingest_plan.ts'
import { REQUIRED_VIEWPOINT } from '../src/ai/pre_assessment.ts'
import { listAiPreAssessmentTargets } from '../src/queries/ai_pre_assessment.ts'
import { readFile } from 'node:fs/promises'
import {
  hasAnthropicApiKey, loadAnthropicApiKey, saveAnthropicApiKey,
} from '../src/secrets/anthropic.ts'

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
      viewpoints: [{ viewpoint: REQUIRED_VIEWPOINT, score: 3, finding: '根拠が主張につながっている。' }],
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
      viewpoints: [{ viewpoint: REQUIRED_VIEWPOINT, score: 3, finding: '根拠が主張につながっている。' }],
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
    // ★ AIは点を出す（0045）。**が、成績の層には1件も入らない。**
    const scores = Number(await scalar(db, `SELECT count(*) FROM evaluation_scores`))
    assert.equal(scores, 0, 'AI分析が成績として混ざっている')
    // 評価軸への道も無い。あれば集計に混ざる。
    const fk = Number(await scalar(db, `
      SELECT count(*) FROM information_schema.columns
       WHERE table_name IN ('ai_pre_assessments', 'ai_pre_viewpoints')
         AND column_name IN ('criterion_id', 'evaluation_id', 'evaluation_criteria_id')`))
    assert.equal(fk, 0, 'AI分析の表が評価軸に紐づいてしまっている')
    // 観点の呼び名も軸マスタには入っていない（依頼者が退けた点）。
    const asCriteria = Number(await scalar(db, `
      SELECT count(*) FROM evaluation_criteria
       WHERE name IN (SELECT viewpoint FROM ai_pre_viewpoints)`))
    assert.equal(asCriteria, 0, 'AIの観点が評価軸として登録されている')
  })

  test('★ 点は観点ごとに残り、合計はビューが足す（別に持たない）', async () => {
    const vp = await all<{ viewpoint: string; score: number }>(db, `
      SELECT viewpoint, score FROM v_ai_pre_viewpoints
       WHERE person_id = $1 AND season_id = $2 AND selection_step_id = $3
       ORDER BY sort_order`, [personId, seasonId, stepId])
    assert.equal(vp.length, 1, '観点は論理性の1つだけ')
    assert.equal(vp[0]!.viewpoint, REQUIRED_VIEWPOINT)
    assert.equal(Number(vp[0]!.score), 3)

    const t = await maybeOne<{ score: number; scale_max: number }>(db, `
      SELECT score, scale_max FROM v_ai_pre_total
       WHERE person_id = $1 AND season_id = $2 AND selection_step_id = $3`,
    [personId, seasonId, stepId])
    assert.equal(Number(t?.score), 3, '合計が内訳と合っていない')
    assert.equal(Number(t?.scale_max), 4, '満点が1軸あたりの4点になっていない')
  })

  test('満点を超える点・負の点は入らない', async () => {
    for (const score of [5, -1, 1.5]) {
      const r = await recordAiPreAssessment(db, {
        personId, seasonId, selectionStepId: stepId, labelCode: '標準',
        rationale: 'x', model: 'claude-opus-5', source: 'application_answers',
        viewpoints: [{ viewpoint: '論理性', score, finding: 'a' }],
      })
      assert.equal(!r.ok && r.reason, 'score_out_of_range', `${score} が通った`)
    }
  })

  test('★ 観点が空の分析は受け付けない（点の無い採点を残さない）', async () => {
    const r = await recordAiPreAssessment(db, {
      personId, seasonId, selectionStepId: stepId, labelCode: '標準',
      rationale: 'x', model: 'claude-opus-5', source: 'application_answers',
      viewpoints: [],
    })
    assert.equal(!r.ok && r.reason, 'viewpoints_required')
  })

  test('★ 論理性の観点が無い分析は受け付けない（依頼者の指示）', async () => {
    const r = await recordAiPreAssessment(db, {
      personId, seasonId, selectionStepId: stepId, labelCode: '標準',
      rationale: 'x', model: 'claude-opus-5', source: 'application_answers',
      viewpoints: [
        { viewpoint: 'NEOとの相性', score: 2, finding: 'a' },
        { viewpoint: '実績', score: 3, finding: 'b' },
      ],
    })
    assert.equal(!r.ok && r.reason, 'logic_viewpoint_required')
  })

  test('同じ観点は2度出せない', async () => {
    const r = await recordAiPreAssessment(db, {
      personId, seasonId, selectionStepId: stepId, labelCode: '標準',
      rationale: 'x', model: 'claude-opus-5', source: 'application_answers',
      viewpoints: [
        { viewpoint: REQUIRED_VIEWPOINT, score: 2, finding: 'a' },
        { viewpoint: REQUIRED_VIEWPOINT, score: 3, finding: 'b' },
      ],
    })
    assert.equal(!r.ok && r.reason, 'bad_viewpoint')
  })

  test('別の期の段には付けられない', async () => {
    const r = await recordAiPreAssessment(db, {
      personId, seasonId, selectionStepId: otherStepId, labelCode: '標準',
      rationale: 'x', model: 'claude-opus-5', source: 'application_answers',
      viewpoints: [{ viewpoint: REQUIRED_VIEWPOINT, score: 3, finding: '根拠が主張につながっている。' }],
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
        viewpoints: [{ viewpoint: REQUIRED_VIEWPOINT, score: 3, finding: '根拠が主張につながっている。' }],
        ...patch,
      })
      assert.equal(!r.ok && r.reason, reason)
    }
  })

  test('画面の待ち行列は応募フォーム本文だけを返し、分析済みを除く', async () => {
    await db.query(`UPDATE selection_steps SET name = '書類選考' WHERE id = $1`, [stepId])
    const target = await makePerson(db, await scalar<string>(db, `SELECT id FROM schools LIMIT 1`),
      { familyName: '架空', givenName: '待ち行列' })
    await makeApplication(db, target, seasonId, '2026-02-01T00:00:00Z')
    await db.query(`
      INSERT INTO person_notes (person_id, author_name, noted_at, body, involvement)
      VALUES ($1, '取込', now(), '応募回答の本文', '2期の応募フォーム（1/1）')`, [target])

    const queue = await listAiPreAssessmentTargets(db, seasonId)
    assert.equal(queue.find((r) => r.person_id === target)?.body, '応募回答の本文')
    assert.ok(!('family_name' in (queue[0] ?? {})), '氏名をAPI用の待ち行列へ混ぜない')
    assert.deepEqual(await listAiPreAssessmentTargets(db, seasonId, false, ''), queue,
      '採点対象を指定しない入口で空文字をUUIDとしてDBへ渡さない')

    await recordAiPreAssessment(db, {
      personId: target, seasonId, selectionStepId: stepId, labelCode: '標準',
      rationale: 'x', model: 'claude-opus-5', source: 'test',
      viewpoints: [{ viewpoint: REQUIRED_VIEWPOINT, score: 2, finding: '筋が通っている' }],
    })
    assert.equal((await listAiPreAssessmentTargets(db, seasonId))
      .some((r) => r.person_id === target), false)
    assert.equal((await listAiPreAssessmentTargets(db, seasonId, true))
      .some((r) => r.person_id === target), true)
  })
})

describe('APIキー入力画面', () => {
  test('キーは伏字入力で、保存後は自動利用する', async () => {
    const page = await readFile(new URL('../app/ai/page.tsx', import.meta.url), 'utf8')
    const action = await readFile(new URL('../app/ai/actions.ts', import.meta.url), 'utf8')
    const shell = await readFile(new URL('../app/_components/shell.tsx', import.meta.url), 'utf8')
    const scoring = await readFile(new URL('../app/_components/scoring.tsx', import.meta.url), 'utf8')
    assert.match(page, /name="apiKey" type="password"/)
    assert.match(page, /autoComplete="off"/)
    assert.match(page, /一度登録すれば以後も自動使用/)
    assert.match(action, /loadAnthropicApiKey/)
    assert.doesNotMatch(shell, /href: '\/ai'/, '左サイドバーへAI分析を追加しない')
    assert.match(scoring, /sheet\.step_name === '書類選考'/)
    assert.match(page, /label: '通常選考'[\s\S]*label: '書類選考'[\s\S]*label: '採点'[\s\S]*label: 'AI分析'/)
    // ★ 狙いは**鍵をブラウザ側へ置かないこと**であって、Cookie の禁止ではない。
    //   C-200 で「記録に聞く」の答えを短命な Cookie で戻すようにしたので、
    //   `cookies(` そのものを禁じると、鍵と無関係な用途まで落ちる。
    //   見るのは「鍵が入った Cookie を作っていないか」に絞る。
    assert.doesNotMatch(action, /localStorage|sessionStorage/)
    assert.doesNotMatch(action, /set\((['"`]).*(apiKey|api_key|anthropic).*\1/i,
      '鍵をブラウザ側（Cookie）へ置いている')
    assert.doesNotMatch(action, /p\.set\(['"]apiKey|console\.(log|error).*apiKey/)
  })

  test('APIキーは暗号文で永続化し、同じサーバ秘密でだけ復号できる', async () => {
    const db = await freshDb()
    const apiKey = 'sk-ant-test-persistent-secret'
    assert.equal((await saveAnthropicApiKey(db, apiKey, 'server-secret')).ok, true)
    // ★ 「行がある」ではなく「復号できる」で答える（C-205）。
    assert.equal(await hasAnthropicApiKey(db, 'server-secret'), true)
    assert.equal(await hasAnthropicApiKey(db, 'ちがう秘密ちがう秘密ちがう秘密ちがう秘密'), false,
      '復号できないのに「登録済み」と言っている')
    const stored = await maybeOne<{ ciphertext: string }>(db,
      `SELECT ciphertext FROM app_secrets WHERE name = 'anthropic_api_key'`)
    assert.notEqual(stored?.ciphertext, apiKey)
    assert.ok(!stored?.ciphertext.includes(apiKey), '平文APIキーがDBに残っている')
    assert.equal(await loadAnthropicApiKey(db, 'server-secret'), apiKey)
    assert.equal(await loadAnthropicApiKey(db, 'wrong-secret'), null)
    await db.close()
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

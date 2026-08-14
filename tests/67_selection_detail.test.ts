import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { freshDb } from '../src/db/testing.ts'
import { scalar } from '../src/db/client.ts'
import {
  planCriterionDetails, planStepDetails, planRequirements,
  SHEET_CRITERIA_DETAIL, SHEET_FLOW, SHEET_REQUIREMENTS, STEP_ALIASES,
} from '../src/import/selection_2026.ts'
import type { Workbook } from '../src/import/xlsx.ts'

/**
 * 評価軸・段・募集要項の説明（0042。C-160。依頼者の指示）。
 *
 * 依頼者の言葉（実行⑯）――「評価軸や選考関係はもっと情報を取得して、
 * DBに組み込んで」。
 *
 * ★ **実在の表は使わない。** 列の形と判定だけを組み立てた表で確かめる。
 */

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const bookOf = (sheets: Record<string, string[][]>): Workbook =>
  ({ rows: (name: string) => sheets[name] ?? [] }) as unknown as Workbook

describe('評価軸の観点を読む（C-160）', () => {
  test('★ 見出しが0列目に無くても読む（表は列がずれている）', () => {
    const out = planCriterionDetails(bookOf({
      [SHEET_CRITERIA_DETAIL]: [
        ['', '', 'A. 検査の軸', '見出しの観点'],
        ['', '', '続きの観点'],
        ['', '', 'B. 次の軸', '別の観点'],
      ],
    }))
    assert.equal(out.length, 2)
    assert.equal(out[0]!.mark, 'A')
    assert.equal(out[0]!.name, '検査の軸')
    assert.equal(out[0]!.description, '見出しの観点\n続きの観点')
    assert.equal(out[1]!.name, '次の軸')
  })

  test('観点が1行も無い軸は返さない（空で上書きしない）', () => {
    const out = planCriterionDetails(bookOf({
      [SHEET_CRITERIA_DETAIL]: [['A. 観点なしの軸']],
    }))
    assert.equal(out.length, 0)
  })

  test('★ 軸の名前を作り変えない（突き合わせの鍵になる）', () => {
    const out = planCriterionDetails(bookOf({
      [SHEET_CRITERIA_DETAIL]: [['A. NEOの環境を“使い倒せる”時間と覚悟', '観点']],
    }))
    assert.equal(out[0]!.name, 'NEOの環境を“使い倒せる”時間と覚悟')
  })
})

describe('段の説明を読む（C-160）', () => {
  test('表の書き方を DB の段名へ対応させる（こちらで語を作らない）', () => {
    assert.equal(STEP_ALIASES['書類審査'], '書類選考')
    assert.equal(STEP_ALIASES['エントリー'], '応募受付')
  })

  test('★ 日付や担当者名を説明として拾わない', () => {
    const out = planStepDetails(bookOf({
      [SHEET_FLOW]: [
        ['グループ面接', '実施', '46086.0', '事務局が候補者の希望を確認し、日程を確定させる。', '増田'],
        ['', '', '46081.0', '櫻木'],
      ],
    }))
    assert.equal(out.length, 1)
    assert.equal(out[0]!.name, 'グループ面接')
    assert.equal(out[0]!.description, '事務局が候補者の希望を確認し、日程を確定させる。')
  })

  test('同じ段の説明は重ねず、改行で足す', () => {
    const out = planStepDetails(bookOf({
      [SHEET_FLOW]: [
        ['最終面接', '', '候補者へリマインドの通知を送付する。'],
        ['', '', '候補者へリマインドの通知を送付する。'],
        ['', '', '結果をメールにて速やかに通知する。'],
      ],
    }))
    assert.equal(out[0]!.description,
      '候補者へリマインドの通知を送付する。\n結果をメールにて速やかに通知する。')
  })
})

describe('募集要項を読む（C-160）', () => {
  test('見出しで束を切り替え、条文を1行ずつ持つ', () => {
    const out = planRequirements(bookOf({
      [SHEET_REQUIREMENTS]: [
        ['共通軸', 'ユース選抜', '企業選抜'],
        ['原則 30歳以下'],
        ['理念に共感できる方'],
      ],
    }))
    assert.equal(out.length, 2)
    assert.equal(out[0]!.category, '共通軸')
    assert.equal(out[0]!.body, '原則 30歳以下')
    assert.equal(out[1]!.sortOrder, 2)
  })

  test('★ PJT の設計表は募集要項ではないので採らない', () => {
    const out = planRequirements(bookOf({
      [SHEET_REQUIREMENTS]: [
        ['共通軸', 'ユース選抜'],
        ['原則 30歳以下'],
        ['PJTパターン', '企業テーマPJT'],
        ['枠数 合計20PJT', '12チーム'],
      ],
    }))
    assert.deepEqual(out.map((r) => r.body), ['原則 30歳以下'])
  })
})

describe('記録層に置き場所がある（0042）', () => {
  test('軸と段が説明を持てる。募集要項の表がある', async () => {
    const db = await freshDb()
    assert.equal(Number(await scalar(db, `
      SELECT count(*) FROM information_schema.columns
       WHERE table_name = 'evaluation_criteria' AND column_name = 'description'`)), 1)
    assert.equal(Number(await scalar(db, `
      SELECT count(*) FROM information_schema.columns
       WHERE table_name = 'selection_steps' AND column_name = 'description'`)), 1)
    assert.equal(Number(await scalar(db, `
      SELECT count(*) FROM information_schema.tables
       WHERE table_name = 'season_requirements'`)), 1)
    await db.close()
  })

  test('★ 同じ条文は2度入らない（取り込みを何度流しても増えない）', async () => {
    const db = await freshDb({ seeds: 'production' })
    const season = await scalar<string>(db, `SELECT id FROM seasons LIMIT 1`)
    for (let i = 0; i < 2; i++) {
      await db.query(`
        INSERT INTO season_requirements (season_id, category, body, sort_order)
        VALUES ($1, '共通軸', '検査の条文', 1)
        ON CONFLICT (season_id, category, body) DO NOTHING`, [season])
    }
    assert.equal(Number(await scalar(db,
      `SELECT count(*) FROM season_requirements WHERE season_id = $1`, [season])), 1)
    await db.close()
  })

  test('★ 点を付ける画面に、何を見る軸かが出る', async () => {
    const scoring = await readFile(join(ROOT, 'app/_components/scoring.tsx'), 'utf8')
    assert.match(scoring, /criteria_description/, '採点画面に軸の観点が出ていない')
    const query = await readFile(join(ROOT, 'src/queries/borderline.ts'), 'utf8')
    assert.match(query, /ec\.description AS criteria_description/)
  })
})

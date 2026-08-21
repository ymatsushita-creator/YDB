import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { scalar } from '../src/db/client.ts'
import {
  planCommonRequirements, planTrackRequirements, planSelectionRequirements,
  planPersonas, planCourseTargets,
} from '../src/import/recruitment_plan_2026.ts'
import {
  SHEET_REQUIREMENTS, SHEET_PERSONAS, SHEET_KPI,
} from '../src/import/recruitment_plan_2026.ts'
import type { Workbook } from '../src/import/xlsx.ts'

/**
 * 募集要項・ペルソナ・KPI目標（C-162。依頼者の指示）。
 *
 * 依頼者の言葉（実行⑯）――「2期応募2のエクセルから、要項やペルソナやKPIを
 * 持ってきて新規DBにも実装して」。
 *
 * ★ **実在の表は使わない。** 組み立てた表で列の読み方だけ確かめる。
 */

const bookOf = (sheets: Record<string, string[][]>): Workbook =>
  ({ rows: (s: string) => sheets[s] ?? [] }) as unknown as Workbook

describe('募集要項 ―― 共通軸（既存の読み方）', () => {
  test('見出し語「軸」で束を切り替える', () => {
    const out = planCommonRequirements(bookOf({
      [SHEET_REQUIREMENTS]: [
        ['共通軸', 'ユース選抜'],
        ['原則 30歳以下'],
        ['PJTパターン', '企業テーマPJT'],
      ],
    }))
    assert.deepEqual(out.map((r) => r.body), ['原則 30歳以下'])
  })
})

describe('募集要項 ―― トラック比較表（C-162）', () => {
  test('★ 見出し「項目」の列と同じ列に、データ行の項目名が来る', () => {
    const rows: string[][] = []
    rows[0] = ['', 'タイトル', '項目', 'トラックA', 'トラックB']
    rows[1] = ['', '', '本人の課題', '課題A', '課題B']
    rows[2] = ['', '', '想定比率', '0.7', '0.3']
    const out = planTrackRequirements(bookOf({ [SHEET_REQUIREMENTS]: rows }))
    assert.equal(out.length, 4)
    assert.deepEqual(out.filter((r) => r.category === 'トラックA').map((r) => r.body),
      ['本人の課題: 課題A', '想定比率: 0.7'])
    assert.deepEqual(out.filter((r) => r.category === 'トラックB').map((r) => r.body),
      ['本人の課題: 課題B', '想定比率: 0.3'])
  })

  test('2つ目の見出し行で、別の表に切り替わる', () => {
    const rows: string[][] = []
    rows[0] = ['', 'x', '項目', 'A']
    rows[1] = ['', '', '項目1', '値1']
    rows[2] = []
    rows[3] = ['', 'y', '項目', 'B']
    rows[4] = ['', '', '項目2', '値2']
    const out = planTrackRequirements(bookOf({ [SHEET_REQUIREMENTS]: rows }))
    assert.deepEqual(out.map((r) => [r.category, r.body]),
      [['A', '項目1: 値1'], ['B', '項目2: 値2']])
  })

  test('値が空のセルは条文にしない', () => {
    const rows: string[][] = []
    rows[0] = ['', 'x', '項目', 'A', 'B']
    rows[1] = ['', '', '項目1', '値1', '']
    const out = planTrackRequirements(bookOf({ [SHEET_REQUIREMENTS]: rows }))
    assert.equal(out.length, 1)
    assert.equal(out[0]!.category, 'A')
  })
})

describe('募集要項 ―― 選考基準', () => {
  test('見出し語（位置ではない）で範囲を切る', () => {
    const out = planSelectionRequirements(bookOf({
      [SHEET_REQUIREMENTS]: [
        ['7. 選考について'],
        ['選考基準'],
        ['スキルより姿勢'],
        ['応募時に必ず聞く質問（例）'],
        ['主目的は何か'],
        ['8. 大切にしていること'],
        ['起業する人も企業で挑戦する人も'],
      ],
    }))
    assert.deepEqual(out.map((r) => [r.category, r.body]), [
      ['選考基準', 'スキルより姿勢'],
      ['応募時に必ず聞く質問（例）', '主目的は何か'],
    ])
  })
})

describe('ペルソナ（015_ペルソナ（NEW）。C-162）', () => {
  test('★ セグメント（左端）は空なら前の行から引き継ぐ', () => {
    const rows: string[][] = [
      [], [], ['', '', '人数'],
      ['学生', '自己成長欲求型', '12'],
      ['', '起業志向型', '12'],
    ]
    const out = planPersonas(bookOf({ [SHEET_PERSONAS]: rows }))
    assert.equal(out.length, 2)
    assert.equal(out[0]!.segment, '学生')
    assert.equal(out[1]!.segment, '学生', 'セグメントの引き継ぎが効いていない')
  })

  test('氏名（WHO）が無い行は入れない', () => {
    const rows: string[][] = [[], [], [], ['学生', '', '12']]
    const out = planPersonas(bookOf({ [SHEET_PERSONAS]: rows }))
    assert.equal(out.length, 0)
  })

  test('列の割り当てが正しい', () => {
    const rows: string[][] = [[], [], [], [
      '学生', 'テスト型', '10', '「一言」', '課題文', 'WHAT文', '特徴文',
      'ターゲット文', 'ニーズ文', '感情文', 'ゲスト文', '', '出口文',
    ]]
    const out = planPersonas(bookOf({ [SHEET_PERSONAS]: rows }))
    const p = out[0]!
    assert.equal(p.headcount, 10)
    assert.equal(p.tagline, '「一言」')
    assert.equal(p.problem, '課題文')
    assert.equal(p.valueProposition, 'WHAT文')
    assert.equal(p.exitImage, '出口文')
  })
})

describe('KPI目標（006_ユース募集施策。C-162）', () => {
  test('施策別ブロック ―― 見出し行自身が最初のデータを持つ', () => {
    const rows: string[][] = []
    rows[0] = []
    rows[1] = ['', '', '応募施策', '', '合格者', '応募者', '説明会', 'リーチ数']
    rows[2] = ['', '施策別', 'イベント集客', '', '10', '50', '41', '123']
    rows[3] = ['', '', '内部リファラル', '', '16', '32', '1', '50']
    rows[4] = ['', '', '合計', '', '32', '100', '58', '783']
    const out = planCourseTargets(bookOf({ [SHEET_KPI]: rows }))
    const b1 = out.filter((c) => c.category === '施策別')
    assert.deepEqual(b1.map((c) => c.courseLabel), ['イベント集客', '内部リファラル'])
    assert.equal(b1[0]!.targetAccepted, 10)
    assert.equal(b1[0]!.targetApplicants, 50)
  })

  test('★「合計」の行は独立した束として入れない', () => {
    const rows: string[][] = [
      [],
      ['', '', '応募施策'],
      ['', '施策別', 'イベント集客', '', '10', '50'],
      ['', '', '合計', '', '32', '100'],
    ]
    const out = planCourseTargets(bookOf({ [SHEET_KPI]: rows }))
    assert.equal(out.filter((c) => c.courseLabel === '合計').length, 0)
  })

  test('コース別ブロック ―― コース名は空欄のとき前の行から引き継ぐ', () => {
    const rows: string[][] = Array.from({ length: 11 }, () => [] as string[])
    rows[8] = ['', 'カテゴリ', '合格者区分']
    rows[9] = ['', 'コース別', '就職', '学生', '10', '20', '0', '26', '', '施策A']
    rows[10] = ['', '', '', '', '4', '20', '10', '30', '', '施策B']
    const out = planCourseTargets(bookOf({ [SHEET_KPI]: rows }))
    const b2 = out.filter((c) => c.category === 'コース別')
    assert.equal(b2.length, 2)
    assert.equal(b2[0]!.courseLabel, '就職')
    assert.equal(b2[1]!.courseLabel, '就職', 'コース名の引き継ぎが効いていない（施策Bが宙に浮く）')
  })

  test('施策は、その目標行にぶら下がる', () => {
    const rows: string[][] = Array.from({ length: 10 }, () => [] as string[])
    rows[9] = ['', 'コース別', '就職', '学生', '10', '20', '0', '26', '',
      '1期生からの紹介', '3', '18', '0.69', '高', '詳細文']
    const out = planCourseTargets(bookOf({ [SHEET_KPI]: rows }))
    assert.equal(out[0]!.tactics.length, 1)
    assert.equal(out[0]!.tactics[0]!.label, '1期生からの紹介')
    assert.equal(out[0]!.tactics[0]!.priority, '高')
  })
})

describe('記録層に置き場所がある（0043）', () => {
  test('募集要項・ペルソナ・KPIの表がある', async () => {
    const db = await freshDb()
    for (const t of ['recruitment_personas', 'recruitment_course_targets', 'recruitment_tactics']) {
      assert.equal(Number(await scalar(db, `
        SELECT count(*) FROM information_schema.tables WHERE table_name = $1`, [t])), 1,
        `${t} が無い`)
    }
    await db.close()
  })
})

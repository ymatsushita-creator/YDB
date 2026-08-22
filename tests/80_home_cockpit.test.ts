import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { freshDb } from '../src/db/testing.ts'
import { scalar, type Db } from '../src/db/client.ts'
import { baseFixture, makeSeason } from './support/fixtures.ts'
import { listTaskOwners, hasSelectionSteps } from '../src/queries/tasks.ts'

const PROJECT_ROOT = join(import.meta.dirname, '..')
const PAGE_FILE = join(PROJECT_ROOT, 'app', 'page.tsx')

describe('ホーム画面の契約テスト（担当者選択・ダッシュボード）', () => {
  let pageContent: string

  test.before(async () => {
    pageContent = await readFile(PAGE_FILE, 'utf-8')
  })

  test('1. SELECT 元素なし', () => {
    assert.doesNotMatch(pageContent, /\bSELECT\s+[\s\S]{0,120}\sFROM\b/i,
      'SELECT元素が無い')
  })

  test('2. ユーザー指示によりホームの担当者選択/選考運転席セクションは削除されている', () => {
    assert.doesNotMatch(pageContent, /className="selection-cockpit"/,
      'ユーザー指示によりselection-cockpitセクションは非表示')
  })

  test('3. ダッシュボード（状況レビュー・推移・KPI・ピックアップ）が存在する', () => {
    const reviewMatch = pageContent.match(/className="review-heading"/)
    const dashboardMatch = pageContent.match(/className="home-dashboard"/)

    assert.ok(reviewMatch, 'review-heading 要素存在')
    assert.ok(dashboardMatch, 'home-dashboard セクション存在')

    const dashboardText = pageContent.slice(dashboardMatch?.index ?? 0)
    assert.match(dashboardText, /title="推移"/,
      'ダッシュボード内に推移 Card がある')
    assert.match(dashboardText, /title="KPI"/,
      'ダッシュboard内にKPI Card がある')
    assert.match(dashboardText, /title="ピックアップ候補者"/,
      'ダッシュボード内にピックアップ Card がある')
  })
})

describe('DB実行テスト（listTaskOwners / hasSelectionSteps）', () => {
  test('1. hasSelectionSteps(fakeDb, "not-a-uuid") は false で db.query を呼ばない', async () => {
    const fakeDb = {
      query: () => { throw new Error('SQL が呼ばれた') },
    } as unknown as Db
    const result = await hasSelectionSteps(fakeDb, 'not-a-uuid')
    assert.equal(result, false,
      '壊れた UUID で false を返すべき')
  })

  test('2. listTaskOwners が active staff を display_name 昇順で返す', async () => {
    const db = await freshDb()
    try {
      await baseFixture(db)

      const staff2Id = await scalar<string>(db, `
        INSERT INTO staffs (display_name, email, is_active)
        VALUES ('山田 太郎', 'taro@example.test', true) RETURNING id`)
      const staff1Id = await scalar<string>(db, `
        INSERT INTO staffs (display_name, email, is_active)
        VALUES ('佐藤 次郎', 'jiro@example.test', true) RETURNING id`)

      const inactiveId = await scalar<string>(db, `
        INSERT INTO staffs (display_name, email, is_active)
        VALUES ('鈴木 花子', 'hanako@example.test', false) RETURNING id`)

      const owners = await listTaskOwners(db)

      const labels = owners.map((o) => o.label)
      assert.ok(labels.includes('佐藤 次郎'))
      assert.ok(labels.includes('山田 太郎'))
      assert.ok(!labels.includes('鈴木 花子'))

      const yamaIndex = labels.indexOf('山田 太郎')
      const satIndex = labels.indexOf('佐藤 次郎')
      assert.ok(satIndex < yamaIndex)

      const allIds = owners.map((o) => o.id)
      assert.ok(allIds.includes(staff1Id))
      assert.ok(allIds.includes(staff2Id))
      assert.ok(!allIds.includes(inactiveId))
    } finally {
      await db.close()
    }
  })

  test('3. hasSelectionSteps: selection step がない有効 season は false、1件追加後 true', async () => {
    const db = await freshDb()
    try {
      await baseFixture(db)

      const season = await makeSeason(db, { year: 2030, steps: [] })

      let result = await hasSelectionSteps(db, season.id)
      assert.equal(result, false)

      await scalar<string>(db, `
        INSERT INTO selection_steps (season_id, name, sort_order)
        VALUES ($1, 'テストステップ', 1) RETURNING id`, [season.id])

      result = await hasSelectionSteps(db, season.id)
      assert.equal(result, true)
    } finally {
      await db.close()
    }
  })
})

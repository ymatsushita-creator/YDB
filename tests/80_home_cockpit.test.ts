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
const CSS_FILE = join(PROJECT_ROOT, 'app', 'base.css')

describe('ホーム画面の契約テスト（選考の運転席）', () => {
  let pageContent: string
  let cssContent: string

  test.before(async () => {
    pageContent = await readFile(PAGE_FILE, 'utf-8')
    cssContent = await readFile(CSS_FILE, 'utf-8')
  })

  test('1. getWorkTasks / listTaskOwners / hasSelectionSteps のimport と呼出。SELECT 元素なし', () => {
    // import の検査
    assert.ok(pageContent.includes("from '../src/queries/tasks.ts'"),
      'tasks.ts がimportされている')
    assert.ok(pageContent.includes('getWorkTasks'),
      'getWorkTasks がある')
    assert.ok(pageContent.includes('listTaskOwners'),
      'listTaskOwners がある')
    assert.ok(pageContent.includes('hasSelectionSteps'),
      'hasSelectionSteps がある')

    // 呼出の検査
    assert.ok(pageContent.includes('getWorkTasks(db,'),
      'getWorkTasks(db, が呼ばれている')
    assert.ok(pageContent.includes('listTaskOwners(db)'),
      'listTaskOwners(db) が呼ばれている')
    assert.ok(pageContent.includes('hasSelectionSteps(db,'),
      'hasSelectionSteps(db, が呼ばれている')

    // SELECT 元素なし
    assert.doesNotMatch(pageContent, /\bSELECT\s+[\s\S]{0,120}\sFROM\b/i,
      'SELECT元素が無い')
  })

  test('2. 6 action label が正確', () => {
    const labels = {
      start_selection: '選考を始める',
      reassign: '担当を替える',
      unhold: '保留を解く',
      assign: '担当を決める',
      evaluate: '評価する',
      decide: '判定する',
    }

    for (const [key, label] of Object.entries(labels)) {
      // action object key は引用符なし (start_selection: 等) に対応
      assert.match(pageContent, new RegExp(`${key}\\s*:\\s*['"](${label})['"']`),
        `action "${key}" → "${label}" の対応が正確`)
    }
  })

  test('3. owner filter オプションに「私の仕事」なし。チーム全体/チーム共通/未割当のみ', () => {
    assert.match(pageContent, /ownerFilterOptions\s*=\s*\[\s*\{\s*label:\s*['"]チーム全体['"][^}]*\}/,
      'チーム全体 option がある')
    assert.match(pageContent, /ownerFilterOptions\s*=\s*[\s\S]*\{\s*label:\s*['"]チーム共通['"][^}]*\}/,
      'チーム共通 option がある')
    assert.match(pageContent, /ownerFilterOptions\s*=\s*[\s\S]*\{\s*label:\s*['"]未割当['"][^}]*\}/,
      'チーム未割当 option がある')
    assert.match(pageContent, /ownerFilterOptions\s*=\s*[\s\S]*\.map\s*\(\s*o\s*=>.*\{\s*label:\s*o\.label/,
      'taskOwners をmap して staff option が続く')

    assert.doesNotMatch(pageContent, /['"]私の仕事['"]/,
      '「私の仕事」という label がない')
  })

  test('4. owner parser が完全UUID staffのみ。不正値はallへ。taskMatchesOwner の staff 判定が完全', () => {
    // parseOwnerFilter の形
    assert.match(pageContent, /function parseOwnerFilter\(value:\s*string\s*\|\s*undefined\):\s*OwnerFilter/,
      'parseOwnerFilter 関数が定義')
    assert.match(pageContent, /if\s*\(!value\s*\|\|\s*value\s*===\s*['"]all['"]\)\s*return\s*\{\s*kind:\s*['"]all['"]\s*\}/,
      'undefined または "all" で { kind: "all" } を返す')
    assert.match(pageContent, /if\s*\(value\s*===\s*['"]team['"]\)\s*return\s*\{\s*kind:\s*['"]team['"]\s*\}/,
      '"team" を返す')
    assert.match(pageContent, /if\s*\(value\s*===\s*['"]unassigned['"]\)\s*return\s*\{\s*kind:\s*['"]unassigned['"]\s*\}/,
      '"unassigned" を返す')
    assert.match(pageContent, /if\s*\(value\.startsWith\s*\(\s*['"]staff:['"]\s*\)\)\s*{[\s\S]*?const\s+staffId\s*=\s*value\.slice\s*\(\s*6\s*\)[\s\S]*?if\s*\(\s*UUID_REGEX\.test\s*\(\s*staffId\s*\)\s*\)/,
      'staff: プレフィックス後の値をUUID_REGEX で検証')
    assert.match(pageContent, /UUID_REGEX\s*=\s*\/\^[^$]*\$\/i/,
      'UUID_REGEX が定義されている')

    // taskMatchesOwner の staff 判定
    assert.match(pageContent, /function taskMatchesOwner\(task:\s*UnifiedTask,\s*filter:\s*OwnerFilter\):\s*boolean/,
      'taskMatchesOwner 関数が定義')
    assert.match(pageContent, /case\s+['"]staff['"]:[\s\S]*?return\s+task\.owner_scope\s*===\s*['"]staff['"]\s*&&\s*task\.owner_staff_id\s*===\s*filter\.staffId/,
      'staff case で owner_scope と owner_staff_id の両方を確認')
  })

  test('5. buildHomeUrl が season と owner を常にset。work を扱う。primary Link が buildHomeUrl でaction/formなし', () => {
    assert.match(pageContent, /function buildHomeUrl\(seasonId:\s*string,\s*filter:\s*OwnerFilter,\s*workId\?\s*:\s*string\):\s*string/,
      'buildHomeUrl 関数が定義')
    assert.match(pageContent, /params\.set\s*\(\s*['"]season['"]/,
      'season をset')
    assert.match(pageContent, /params\.set\s*\(\s*['"]owner['"]/,
      'owner をset')
    assert.match(pageContent, /if\s*\(\s*workId\s*\)\s*params\.set\s*\(\s*['"]work['"]/,
      'work を条件付きでset')

    // primary button：href が className より前
    assert.match(pageContent, /href=\{buildHomeUrl\([^)]*\)[^>]*className="button-primary"/,
      'primary Link href が class より前')

    // selection-cockpit セクション内に form/action なし
    const cockpitMatch = pageContent.match(/className="selection-cockpit"[\s\S]*?(<\/\w+>)/)
    assert.ok(cockpitMatch, 'selection-cockpit セクション抽出')
    const cockpitSection = cockpitMatch[0]
    assert.doesNotMatch(cockpitSection, /<form[^>]*action=/,
      'selection-cockpit 内に form 要素なし')
    assert.doesNotMatch(cockpitSection, /<button[^>]*type="submit"/,
      'selection-cockpit 内に submit ボタンなし')
  })

  test('6. 正常Empty と設定エラー。文言および条件分岐区別', () => {
    const cond1 = pageContent.indexOf('!selectionStepsConfigured ?')
    const errorText = pageContent.indexOf('選考フローが設定されていません')
    const cond2 = pageContent.indexOf('filteredTasks.length === 0 ?')
    const emptyText = pageContent.indexOf('今日必要な選考処理はありません')

    assert.ok(cond1 >= 0, '!selectionStepsConfigured ? が見つかる')
    assert.ok(errorText >= 0, '選考フローが設定されていません が見つかる')
    assert.ok(cond2 >= 0, 'filteredTasks.length === 0 ? が見つかる')
    assert.ok(emptyText >= 0, '今日必要な選考処理はありません が見つかる')
    assert.ok(cond1 < errorText && errorText < cond2 && cond2 < emptyText,
      '条件と文言の順序が正しい')
  })

  test('7. input 早期return が getWorkTasks / Promise.all より前の文字位置', () => {
    const inputIndex = pageContent.indexOf("if (tier === 'input')")
    const queryIndex = pageContent.indexOf('getWorkTasks(db,')

    assert.ok(inputIndex >= 0, "if (tier === 'input') が見つかる")
    assert.ok(queryIndex >= 0, 'getWorkTasks(db, が見つかる')
    assert.ok(inputIndex < queryIndex,
      'input早期returnがgetWorkTasksの呼び出しより前')
  })

  test('8. セクション順序：「選考の運転席」<「状況レビュー」<「ホーム-ダッシュボード」。推移/KPI/ピックアップ残存', () => {
    const cockpitMatch = pageContent.match(/className="selection-cockpit"/)
    const reviewMatch = pageContent.match(/className="review-heading"/)
    const dashboardMatch = pageContent.match(/className="home-dashboard"/)

    assert.ok(cockpitMatch, 'selection-cockpit セクション存在')
    assert.ok(reviewMatch, 'review-heading 要素存在')
    assert.ok(dashboardMatch, 'home-dashboard セクション存在')

    const cockpitIndex = cockpitMatch.index ?? -1
    const reviewIndex = reviewMatch.index ?? -1
    const dashboardIndex = dashboardMatch.index ?? -1

    assert.ok(cockpitIndex < reviewIndex,
      '「選考の運転席」が「状況レビュー」より前')
    assert.ok(reviewIndex < dashboardIndex,
      '「状況レビュー」が「ホーム-ダッシュボード」より前')

    // 推移/KPI/ピックアップは home-dashboard 内
    const dashboardText = pageContent.slice(dashboardIndex)
    assert.match(dashboardText, /title="推移"/,
      'ダッシュボード内に推移 Card がある')
    assert.match(dashboardText, /title="KPI"/,
      'ダッシュボード内にKPI Card がある')
    assert.match(dashboardText, /title="ピックアップ候補者"/,
      'ダッシュボード内にピックアップ Card がある')
  })

  test('9. task row の要素と class：person/step/season/wait/SLA/overdue/owner/button', () => {
    const cockpitStart = pageContent.indexOf('className="selection-cockpit"')
    const reviewStart = pageContent.indexOf('className="review-heading"')
    assert.ok(cockpitStart >= 0, 'selection-cockpit が見つかる')
    assert.ok(reviewStart >= 0, 'review-heading が見つかる')
    const cockpitSection = pageContent.substring(cockpitStart, reviewStart)

    // required classes
    assert.ok(cockpitSection.includes('task-person'), 'task-person class がある')
    assert.ok(cockpitSection.includes('task-step'), 'task-step class がある')
    assert.ok(cockpitSection.includes('task-season'), 'task-season class がある')
    assert.ok(cockpitSection.includes('task-waiting'), 'task-waiting class がある')
    assert.ok(cockpitSection.includes('task-sla'), 'task-sla class がある')
    assert.ok(cockpitSection.includes('task-overdue'), 'task-overdue class がある')
    assert.ok(cockpitSection.includes('task-owner'), 'task-owner class がある')
    assert.ok(cockpitSection.includes('button-primary'), 'button-primary class がある')

    // required expressions
    assert.ok(cockpitSection.includes('task.person_name'), 'task.person_name がある')
    assert.ok(cockpitSection.includes('task.step_name'), 'task.step_name がある')
    assert.ok(cockpitSection.includes('seasonLabel(season)'), 'seasonLabel(season) がある')
    assert.ok(cockpitSection.includes('task.waiting_days'), 'task.waiting_days がある')
    assert.ok(cockpitSection.includes('task.sla_days'), 'task.sla_days がある')
    assert.ok(cockpitSection.includes('task.overdue_days'), 'task.overdue_days がある')
    assert.ok(cockpitSection.includes('ownerText'), 'ownerText がある')
    assert.ok(cockpitSection.includes('TASK_ACTION_LABELS[task.kind]'), 'TASK_ACTION_LABELS[task.kind] がある')
  })

  test('10. CSS に selection-cockpit / owner-filter-tabs / task-item / task-selected / config-error / review-heading がある。旧 home overflow:hidden なし', () => {
    assert.match(cssContent, /\.selection-cockpit\s*{/,
      '.selection-cockpit class 定義がある')
    assert.match(cssContent, /\.owner-filter-tabs\s*{/,
      '.owner-filter-tabs class 定義がある')
    assert.match(cssContent, /\.task-item\s*{/,
      '.task-item class 定義がある')
    assert.match(cssContent, /\.task-item\.selected\s*{|\.task-item\s*\{[\s\S]*?\.selected/,
      '.task-item.selected の状態定義がある')
    assert.match(cssContent, /\.config-error\s*{/,
      '.config-error class 定義がある')
    assert.match(cssContent, /\.review-heading\s*{/,
      '.review-heading class 定義がある')

    // 旧 home overflow hidden なし
    assert.doesNotMatch(cssContent, /\.home\s*\{[\s\S]*?overflow:\s*hidden/,
      '.home に overflow: hidden がない')
  })
})

// ================================================================
// DB実行 describe
// ================================================================

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

      // active staff 2件を逆順で insert（山田 太郎 → 佐藤 次郎）
      const staff2Id = await scalar<string>(db, `
        INSERT INTO staffs (display_name, email, is_active)
        VALUES ('山田 太郎', 'taro@example.test', true) RETURNING id`)
      const staff1Id = await scalar<string>(db, `
        INSERT INTO staffs (display_name, email, is_active)
        VALUES ('佐藤 次郎', 'jiro@example.test', true) RETURNING id`)

      // inactive 1件
      const inactiveId = await scalar<string>(db, `
        INSERT INTO staffs (display_name, email, is_active)
        VALUES ('鈴木 花子', 'hanako@example.test', false) RETURNING id`)

      const owners = await listTaskOwners(db)

      // inactive を除外し、display_name 昇順（佐藤 次郎 → 山田 太郎）
      const labels = owners.map((o) => o.label)
      assert.ok(labels.includes('佐藤 次郎'),
        '佐藤 次郎 が含まれるべき')
      assert.ok(labels.includes('山田 太郎'),
        '山田 太郎 が含まれるべき')
      assert.ok(!labels.includes('鈴木 花子'),
        '鈴木 花子（inactive）は除外されるべき')

      // 昇順確認
      const yamaIndex = labels.indexOf('山田 太郎')
      const satIndex = labels.indexOf('佐藤 次郎')
      assert.ok(satIndex < yamaIndex,
        `display_name 昇順違反: 佐藤 次郎 (index ${satIndex}) は 山田 太郎 (index ${yamaIndex}) より前であるべき`)

      // 既存の baseFixture スタッフがあれば ID で filter して検査
      const allIds = owners.map((o) => o.id)
      assert.ok(allIds.includes(staff1Id), `新規 staff1 (佐藤 次郎) の ID が含まれるべき: ${staff1Id}`)
      assert.ok(allIds.includes(staff2Id), `新規 staff2 (山田 太郎) の ID が含まれるべき: ${staff2Id}`)
      assert.ok(!allIds.includes(inactiveId), `inactive staff の ID が含まれない: ${inactiveId}`)
    } finally {
      await db.close()
    }
  })

  test('3. hasSelectionSteps: selection step がない有効 season は false、1件追加後 true', async () => {
    const db = await freshDb()
    try {
      await baseFixture(db)

      // season を作成（step なし）
      const season = await makeSeason(db, { year: 2030, steps: [] })

      // selection step がない → false
      let result = await hasSelectionSteps(db, season.id)
      assert.equal(result, false,
        'selection_steps がない season は false を返すべき')

      // selection_step を 1件追加
      await scalar<string>(db, `
        INSERT INTO selection_steps (season_id, name, sort_order)
        VALUES ($1, 'テストステップ', 1) RETURNING id`, [season.id])

      // selection step がある → true
      result = await hasSelectionSteps(db, season.id)
      assert.equal(result, true,
        'selection_steps を追加後は true を返すべき')
    } finally {
      await db.close()
    }
  })
})

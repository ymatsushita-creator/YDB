import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { canOpen, TIERS, TIER_HOME } from '../src/auth/tiers.ts'

/**
 * ホームとタブ（実行⑫。依頼者の指示）。
 *
 * 依頼者が決めたこと ――
 *   「既存のタブの上にホーム（サマリーをビジュアライズ、
 *     ピックアップ候補者を3人みたいな感じの画面）」
 *   「層ごとに出すものを変える」
 *   「ヘッドハンティング → 特別選考。**画面に出る語だけ**変える」
 *
 * ここで固定したいのは5つ ――
 *   ① ホームは**画面を持つ**（redirect だけに戻さない）
 *   ② 全層がホームを開ける（開けないタブを先頭に置かない）
 *   ③ ホームは**層ごとに出すものを変える**が、判定は `canOpen` を見る
 *      ―― ホーム専用の層判定を書かない（2箇所に分かれると必ず食い違う）
 *   ④ ホームは**新しい集計を作らない**（既にあるクエリを呼ぶだけ）
 *   ⑤ 「特別選考」は**画面の語だけ。** URL と識別子は `headhunting` のまま
 */

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const read = (p: string) => readFile(join(ROOT, p), 'utf8')

/**
 * コメントを落とした本文。
 *
 * ★ **コメントは履歴である。** 「これは出さない」と書いた注記まで
 *   「出している」と数えると、理由を書くほど検査が落ちる。
 */
const body = async (p: string) => (await read(p)).split('\n')
  .filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//')
    && !l.trimStart().startsWith('/*') && !l.includes('{/*'))
  .join('\n')

describe('ホーム', () => {
  test('① ホームは画面を持つ（redirect だけではない）', async () => {
    const src = await body('app/page.tsx')
    assert.match(src, /<Shell active="home"/, 'ホームは共通シェルを被る')
    assert.match(src, /Card title="母集団と歩留まり"/)
    assert.match(src, /Card title="集客の効き"/)
    assert.match(src, /Card title="面接の進み具合"/)
    assert.match(src, /Card title="ピックアップ候補者"/)
    // 依頼者が選ばなかったものを勝手に足していないこと。
    assert.doesNotMatch(src, /いま止まっているもの/)
  })

  test('② 全層がホームを開け、行き先もホームである', () => {
    for (const tier of TIERS) {
      assert.equal(canOpen(tier, '/'), true, tier)
      assert.equal(TIER_HOME[tier], '/', tier)
    }
  })

  test('③ ホームの層判定は canOpen だけを見る', async () => {
    const src = await body('app/page.tsx')
    assert.match(src, /canOpen/, '層の判定を1箇所（canOpen）から借りる')
    // 層ごとに出すものを変えている（入力層は数字を出さない）。
    assert.match(src, /tier === 'input'/)
    // ★ 独自の許可リストを作っていないこと。
    assert.doesNotMatch(src, /ALL_ONLY|INPUT_PATHS/)
  })

  test('④ ホームは新しい集計を作らない（既存のクエリを呼ぶ）', async () => {
    const src = await body('app/page.tsx')
    for (const fn of ['getSummary', 'getStepFlow', 'getPartnerReach',
      'getChannelPerformance', 'listSeasonInterviews', 'listConfidence']) {
      assert.match(src, new RegExp(fn), fn)
    }
    // 画面の中で SQL を書いていない（集計の定義が2箇所になる）。
    assert.doesNotMatch(src, /SELECT /)
  })

  test('④ ピックアップは確度の上位3人（依頼者の指示）', async () => {
    const src = await read('app/page.tsx')
    assert.match(src, /listConfidence\(db, season\.id, 3\)/)
  })
})

describe('タブの名称と構造', () => {
  test('⑤ タブは5本。先頭がホームで、特別選考は表示名だけ', async () => {
    const src = await body('app/_components/shell.tsx')
    assert.match(src, /id: 'home', href: '\/', label: 'ホーム'/)
    // ★ 画面の語は「特別選考」、URL と識別子は `headhunting` のまま。
    assert.match(src, /id: 'headhunting', href: '\/headhunting', label: '特別選考'/)
    assert.doesNotMatch(src, /label: 'ヘッドハンティング'/)
  })

  test('⑤ 画面に出る語から「ヘッドハンティング」が消えている', async () => {
    // 依頼者の指示は「画面に出る語だけ変える」。**見出しとパンくずも画面である。**
    const pages: string[] = []
    const walk = async (dir: string) => {
      for (const e of await readdir(join(ROOT, dir), { withFileTypes: true })) {
        if (e.isDirectory()) await walk(join(dir, e.name))
        else if (e.name.endsWith('.tsx')) pages.push(join(dir, e.name))
      }
    }
    await walk('app')

    const found: string[] = []
    for (const p of pages) {
      const src = await read(p)
      // 文字列リテラルとして画面に出ているものだけを見る（コメントは履歴である）。
      for (const line of src.split('\n')) {
        if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) continue
        if (/'ヘッドハンティング'|"ヘッドハンティング"|>ヘッドハンティング|ヘッドハンティング[^ト]*リスト/.test(line)) {
          found.push(`${p}: ${line.trim()}`)
        }
      }
    }
    assert.deepEqual(found, [], `画面の語が残っている:\n${found.join('\n')}`)
  })

  test('⑤ 「入力者を追加」が操作柱にあり、入力層でも開く', async () => {
    const src = await read('app/_components/shell.tsx')
    assert.match(src, /href: '\/staff\/new', label: '入力者を追加'/)
    assert.equal(canOpen('input', '/staff/new'), true)
  })
})

describe('表（スプシ形式）', () => {
  test('★ クライアントに置いたのは表だけである', async () => {
    // 実行⑪まで `'use client'` は 0 件だった。**増やしたのは1つだけ。**
    const found: string[] = []
    const walk = async (dir: string) => {
      for (const e of await readdir(join(ROOT, dir), { withFileTypes: true })) {
        if (e.isDirectory()) await walk(join(dir, e.name))
        else if (e.name.endsWith('.tsx') || e.name.endsWith('.ts')) {
          const src = await read(join(dir, e.name))
          if (/^'use client'/m.test(src)) found.push(join(dir, e.name))
        }
      }
    }
    await walk('app')
    assert.deepEqual(found, ['app/_components/sheet.tsx'])
  })

  test('★ 表は判定を持たない（コマンドを呼ぶだけ）', async () => {
    const src = await body('app/_components/sheet.tsx')
    // 必須・形式・参照先の判定を画面に書いていないこと。
    assert.doesNotMatch(src, /必須です|@.*\\\.|SELECT |INSERT /)
    assert.match(src, /src\/commands\/sheet\.ts/, '結果の型はコマンド側から借りる')
  })
})

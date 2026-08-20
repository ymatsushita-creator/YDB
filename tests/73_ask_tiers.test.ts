import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { TIERS, type Tier } from '../src/auth/tiers.ts'

/**
 * 記録に聞く道具は、層ごとに分ける（C-200 / C-201。依頼者の指示）。
 *
 * 依頼者の言葉 ――「APIは、ragとしても使えるようにDB全体を見渡せる存在に」
 * 「閲覧できる情報は権限ごとにわけてね」。
 *
 * ★ APIは呼ばない。確かめるのは**渡す道具の顔ぶれ**である。
 * ★ 固定したいのは3つ ――
 *   ① 全部の層に割り当てがある（層が増えたら**必ずここで落ちる**）
 *   ② 個人を引く道具は all だけ
 *   ③ 書き換えの文が道具に混じっていない（読み取り専用）
 */

const SRC = fileURLToPath(new URL('../src/ai/ask.ts', import.meta.url))

describe('記録に聞く ―― 層ごとの道具（C-201）', () => {
  test('★ すべての層に割り当てがある', async () => {
    const src = await readFile(SRC, 'utf8')
    for (const tier of TIERS as readonly Tier[]) {
      assert.match(src, new RegExp(`\\b${tier}:\\s*\\[`),
        `${tier} の割り当てが無い ―― 層を増やしたらここも決める`)
    }
  })

  test('★ 個人を引く道具は all だけ', async () => {
    const src = await readFile(SRC, 'utf8')
    const block = /const TOOLS_BY_TIER[\s\S]*?\n}/.exec(src)![0]
    const line = (tier: string) =>
      new RegExp(`${tier}: \\[([\\s\\S]*?)\\],?\\n`).exec(block)?.[1] ?? ''
    assert.match(line('all'), /find_person/, 'all が個人を引けない')
    assert.doesNotMatch(line('personal'), /find_person/, 'personal が個人を引ける')
    assert.doesNotMatch(line('input'), /find_person/, 'input が個人を引ける')
    // 確度は個人の見立てなので、集計であっても all だけに置く。
    assert.doesNotMatch(line('input'), /confidence_breakdown/)
  })

  test('★ 道具はすべて読み取り専用（書き換えの文が無い）', async () => {
    const src = await readFile(SRC, 'utf8')
    for (const word of ['INSERT ', 'UPDATE ', 'DELETE ', 'DROP ', 'ALTER ', 'TRUNCATE']) {
      assert.ok(!src.includes(word),
        `道具に書き換えの文がある: ${word.trim()}`)
    }
  })

  test('行を丸ごと返す道具を置かない（上限がある）', async () => {
    const src = await readFile(SRC, 'utf8')
    // 個人を引く道具には必ず上限を付ける。
    const findPerson = /find_person:[\s\S]*?\n {2}},/.exec(src)![0]
    assert.match(findPerson, /LIMIT \d+/, '個人を引く道具に上限が無い')
  })
})

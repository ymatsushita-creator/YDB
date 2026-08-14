import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

/**
 * 実行の場所と接続の本数（C-147）。
 *
 * ★ 読み込みの遅さは DB の中身ではなく**距離**だった。
 *   `x-vercel-id: hnd1::iad1::…` ―― 東京で受けて**バージニアで実行**し、
 *   DB は東京（ap-northeast-1）にある。問い合わせ1回ごとに太平洋を往復していた。
 *
 * ★ どちらも**設定を1行変えるだけで黙って戻る**種類の値である。
 *   戻ったことは画面にも出力にも出ない。だからここで固定する
 *   （C-124 でデプロイ先を固定したのと同じ理由）。
 */

const ROOT = fileURLToPath(new URL('../', import.meta.url))

describe('実行の場所と接続の本数（C-147）', () => {
  test('関数は東京で動かす ―― DB と同じ地域', async () => {
    const conf = JSON.parse(await readFile(join(ROOT, 'vercel.json'), 'utf8'))
    assert.deepEqual(
      conf.regions,
      ['hnd1'],
      'DB は ap-northeast-1（東京）にある。関数を別の地域へ置くと、'
        + '問い合わせ1回ごとに太平洋を往復する',
    )
  })

  test('接続は1本にしない ―― 画面は並列に投げている', async () => {
    const src = await readFile(join(ROOT, 'src/db/postgres.ts'), 'utf8')
    const m = src.match(/^\s*max:\s*(\d+),/m)
    assert.ok(m, 'プールの max が読み取れない')
    const max = Number(m![1])
    assert.ok(max > 1, `max: ${max} では Promise.all が直列に戻る`)
    // 上限は Supabase session pooler 側にある。増やし過ぎない理由は
    // 元のコメントの通りで、こちらも黙って外れないように留める。
    assert.ok(max <= 5, `max: ${max} は pooler の上限を実行環境の数だけ食う`)
  })
})

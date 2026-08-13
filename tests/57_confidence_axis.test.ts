import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freshDb } from '../src/db/testing.ts'
import { hasScoringRules, getHomeTrends } from '../src/queries/dashboard.ts'
import { scalar } from '../src/db/client.ts'

/**
 * 確度の軸と、混乱する用語（依頼者の指示。実行⑭）。
 *
 * 依頼者の問い ―― 「確度の軸が定まり、エクセルファイルと同じ基準で判断され、
 * 混乱する用語がないか」。**調べた答えは「まだ定まっていない」である**（C-127）。
 *
 *   記録層   規則から点を積んで**比率（0〜1）**にする（0017）。
 *            **本番の規則は0件**なので、確度は誰にも付いていない
 *   運営     応募管理表 `003_2期生アプローチリスト` の「参加確度」――
 *            **帯（020％／050％／080％／100％）と状態語**
 *            （未計測・興味なし/対象外・応募完了）
 *
 * ★ **同じ基準ではない。** 帯を受け取って取り込むまでは、こちらの確度は空である。
 *
 * ★ 画面は「通常選考者（確度A以上）」と名乗っていた。**A は記録に無い格付け**で、
 *   応募管理表では A〜C（必須）・D〜I（加点）が**特別選考の軸の記号**である。
 *   同じ字が2つの意味を持っていた ―― ここで固定するのは、その語を戻さないこと。
 */

const ROOT = fileURLToPath(new URL('../', import.meta.url))

/** コメントを落とした本文（コメントは履歴なので数えない。tests/45 と同じ作法）。 */
const body = async (p: string) => (await readFile(join(ROOT, p), 'utf8')).split('\n')
  .filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//')
    && !l.trimStart().startsWith('/*') && !l.includes('{/*'))
  .join('\n')

describe('確度の軸（C-127）', () => {
  test('本番シードに確度の規則は入っていない（点数と閾値は未受領）', async () => {
    const db = await freshDb({ seeds: 'production' })
    assert.equal(await hasScoringRules(db), false,
      '規則が入った。運営の基準（参加確度の帯）と揃っているか確かめること')
    assert.equal(Number(await scalar<string>(db, `SELECT count(*)::text FROM scoring_rules`)), 0)
    await db.close()
  })

  test('規則が無いとき、確度は 0 ではなく「算出なし」で出る', async () => {
    // ★ 0017 が書いたとおり ――「無いことを 0 と書くと、それは嘘の数字になる」。
    //   ホームは規則が無ければ確度の系列を出さず、タイルは算出なしを出す。
    const src = await body('app/page.tsx')
    assert.ok(/derived=\{hasRules\}/.test(src),
      'ホームのタイルが、規則の有無を見ずに数字を出している')
    assert.ok(/\.\.\.\(hasRules/.test(src),
      'ホームの系列が、規則の有無を見ずに確度の線を引いている')
    await Promise.resolve()
  })

  test('★ 記録に無い格付け「確度A」を画面へ戻さない', async () => {
    // A〜C・D〜I は応募管理表では**特別選考の軸の記号**である（0033・0005）。
    // 確度の格付けとして A を使うと、同じ字が2つの意味を持つ。
    for (const f of await readdir(join(ROOT, 'app'), { recursive: true })) {
      if (typeof f !== 'string' || !f.endsWith('.tsx')) continue
      const src = await body(join('app', f))
      assert.equal(/確度\s*[A-E]\b/.test(src), false,
        `${f} が「確度A」のような記録に無い格付けを出している`)
      assert.equal(/通常選考\s*[A-E]\s*以上/.test(src), false,
        `${f} が「通常選考 A以上」を出している`)
    }
  })

  test('閾値は画面に書かない（C-62）。定義はクエリのコメントに置く', async () => {
    const screen = await body('app/page.tsx')
    assert.equal(/0\.8|80\s*%以上/.test(screen), false, '閾値が画面に出ている')
    const query = await readFile(join(ROOT, 'src/queries/dashboard.ts'), 'utf8')
    assert.ok(/閾値 0\.8 は受領していない/.test(query),
      'クエリのコメントに、閾値の由来（未受領）が書かれていない')
    assert.ok(/参加確度/.test(query),
      'クエリのコメントに、運営の基準（参加確度の帯）が書かれていない')
  })

  test('推移は確度の列を持つが、規則が無ければ全日0のまま（線を引かない根拠）', async () => {
    const db = await freshDb({ seeds: 'production' })
    const seasonId = await scalar<string>(
      db, `SELECT id FROM seasons WHERE enrollment_year = 2026`)
    const points = await getHomeTrends(db, seasonId)
    assert.ok(points.length > 0, '推移が1点も出ていない')
    assert.ok(points.every((p) => p.high_confidence === 0),
      '規則が無いのに確度の数が入っている')
    await db.close()
  })
})

describe('混乱する用語（C-127）', () => {
  test('画面に出る語と、記録の語が食い違っていない', async () => {
    // ★ ここで見張るのは「**画面が記録に無い語で数字を名乗らないこと**」である。
    //   語そのものを増やすのは依頼者の判断で、こちらは翻訳しない（Pilot Rule）。
    const screens: string[] = []
    for (const f of await readdir(join(ROOT, 'app'), { recursive: true })) {
      if (typeof f === 'string' && f.endsWith('page.tsx')) screens.push(join('app', f))
    }
    assert.ok(screens.length > 10, `画面が ${screens.length} 枚しか拾えていない`)

    // 運営から受け取っていない格付けの語。**足すときは受領を確かめてから。**
    const invented = ['ランクA', 'ランクB', '確度ランクA', 'Sランク', '優先度A']
    for (const p of screens) {
      const src = await body(p)
      for (const word of invented) {
        assert.equal(src.includes(word), false, `${p} に受領していない語「${word}」がある`)
      }
    }
  })
})

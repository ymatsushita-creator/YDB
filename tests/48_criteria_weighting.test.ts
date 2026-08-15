import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { all, one, scalar } from '../src/db/client.ts'
import { listSeasonCriteria } from '../src/queries/dashboard.ts'

/**
 * 評価軸の重み付け（必須／加点）。
 *
 * 依頼者の指示（実行⑬）――「特別選考の重み付けはエクセルに従え」。
 * 応募管理表の「特別選考」シートは9軸を A〜C（必須の前提）と
 * D〜I（加点）の2段で並べていた。**数値の配点は表に無い**ので作らない。
 *   0033  evaluation_criteria.kind を足す
 *   0005  2期に特別選考ステップ＋9軸（kind 付き）を入れる
 */

describe('0033 kind 列', () => {
  test('既定は standard。standard/required/strong 以外は入らない', async () => {
    const db = await freshDb({ seeds: 'production' })
    // 既存の段を1つ借りる（段そのものは検証対象ではない）。
    const s = await one<{ id: string }>(db, `
      SELECT id FROM selection_steps ORDER BY id LIMIT 1`)
    // kind を指定せずに入れると standard。
    const c = await one<{ kind: string }>(db, `
      INSERT INTO evaluation_criteria (selection_step_id, name, scale_max, sort_order)
      VALUES ($1, '段分けの無い軸', 4, 900) RETURNING kind`, [s.id])
    assert.equal(c.kind, 'standard')

    await assert.rejects(
      db.query(`
        INSERT INTO evaluation_criteria (selection_step_id, name, scale_max, sort_order, kind)
        VALUES ($1, '悪い', 4, 901, 'bonus')`, [s.id]),
      /kind/,
      '定義外の重みは受け付けない',
    )
    await db.close()
  })
})

describe('0005 2期の特別選考9軸', () => {
  test('9軸あり、A〜C=必須・D〜I=加点、満点は4', async () => {
    const db = await freshDb({ seeds: 'production' })
    const rows = await all<{ name: string; kind: string; scale_max: number; sort_order: number }>(db, `
      SELECT ec.name, ec.kind, ec.scale_max, ec.sort_order
        FROM evaluation_criteria ec
        JOIN selection_steps ss ON ss.id = ec.selection_step_id
        JOIN seasons se ON se.id = ss.season_id
       WHERE se.cohort_number = 2 AND ss.name = '特別選考'
       ORDER BY ec.sort_order`)

    assert.equal(rows.length, 9)
    assert.deepEqual(rows.map((r) => r.kind), [
      'required', 'required', 'required',
      'strong', 'strong', 'strong', 'strong', 'strong', 'strong',
    ])
    assert.ok(rows.every((r) => r.scale_max === 4), '満点は4（表に点の定義が無い）')
    // 運営の語をそのまま（言い換えない）。先頭と末尾だけ固定する。
    assert.equal(rows[0]!.name, 'NEOの環境を“使い倒せる”時間と覚悟')
    assert.equal(rows[8]!.name, 'NEO側が“賭けたい”と思える直感')
    await db.close()
  })

  test('特別選考は先頭・最終面接は最後（合格の定義を動かさない）', async () => {
    const db = await freshDb({ seeds: 'production' })
    const first = await scalar<string>(db, `
      SELECT ss.name FROM selection_steps ss
        JOIN seasons se ON se.id = ss.season_id
       WHERE se.cohort_number = 2 ORDER BY ss.sort_order ASC LIMIT 1`)
    const last = await scalar<string>(db, `
      SELECT ss.name FROM selection_steps ss
        JOIN seasons se ON se.id = ss.season_id
       WHERE se.cohort_number = 2 ORDER BY ss.sort_order DESC LIMIT 1`)
    assert.equal(first, '特別選考')
    assert.equal(last, '最終面接')
    await db.close()
  })

  /**
   * ★ グループ面接は 0008 で入った（依頼者「最終と同じでいいから」。実行⑯）。
   *   **書類選考はまだ空** ―― 軸の呼び名を受け取っていない。
   *   受け取らないうちに、こちらで名付けない（原則3）。
   */
  test('書類選考にはまだ軸を足していない（呼び名を受け取っていない）', async () => {
    const db = await freshDb({ seeds: 'production' })
    const n = await scalar<number>(db, `
      SELECT count(*)::int FROM evaluation_criteria ec
        JOIN selection_steps ss ON ss.id = ec.selection_step_id
        JOIN seasons se ON se.id = ss.season_id
       WHERE se.cohort_number = 2 AND ss.name = '書類選考'`)
    assert.equal(n, 0)
    await db.close()
  })

  test('listSeasonCriteria が kind を返す', async () => {
    const db = await freshDb({ seeds: 'production' })
    const season = await one<{ id: string }>(db, `
      SELECT id FROM seasons WHERE cohort_number = 2`)
    const criteria = await listSeasonCriteria(db, season.id)
    const required = criteria.filter((c) => c.kind === 'required')
    const strong = criteria.filter((c) => c.kind === 'strong')
    const standard = criteria.filter((c) => c.kind === 'standard')
    assert.equal(required.length, 3, '必須はA〜Cの3つ')
    assert.equal(strong.length, 6, '加点はD〜Iの6つ')
    // ★ 0008 でグループ面接にも同じ6軸を入れた（実行⑯）。
    //   段が違えば別の軸なので、段分けを持たない軸は 6 → 12 になる。
    assert.equal(standard.length, 12,
      '最終面接とグループ面接の各6軸は、どちらも段分けを持たない')
    await db.close()
  })
})

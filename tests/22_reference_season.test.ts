import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { all, one, scalar } from '../src/db/client.ts'
import { seed } from '../src/db/migrate.ts'
import { seedDemo } from '../src/seed/demo.ts'

/**
 * 本番の参照データ（db/seeds/0001_reference.sql）に入れた 2026年度。
 *
 * ここで固定しているのは値そのものではなく、**値の由来**である。
 * 4つの日付のうち application_close_date は推測値で、実際の締切が
 * 判明したら season_revisions を残して直す（D-8）。テストが値を
 * 押さえていれば、黙って書き換わったときに気づける。
 *
 * 集計マスタは更新せず追加と非活性化で運用する（原則3）ため、
 * ここに入った行は事実上あとから消せない。**入っていないこと**も
 * 同じ重さで検査する ―― 書類選考の軸は満点16が確定していても
 * 呼び名が未確認で、名付ければマスタとして固定化するので入れていない。
 */

const productionDb = () => freshDb({ seeds: 'production' })

describe('本番シードの 2026年度（D-8）', () => {
  test('年度が1件あり、定員と目標応募数は受領した実数値である', async () => {
    const db = await productionDb()
    const s = await one<{
      enrollment_year: number
      capacity: number
      target_application_count: number
    }>(db, `SELECT enrollment_year, capacity, target_application_count FROM seasons`)

    assert.equal(s.enrollment_year, 2026)
    assert.equal(s.capacity, 36)
    assert.equal(s.target_application_count, 100)
    await db.close()
  })

  test('4つの日付は受領した値のまま入っている（うち締切は推測値）', async () => {
    const db = await productionDb()
    // date 型は jst_date() を通さない。日付そのものであって時刻ではないため、
    // 接続のタイムゾーンで解釈が動かない。to_char で文字列として突き合わせる。
    const s = await one<Record<string, string>>(
      db,
      `SELECT to_char(outreach_start_date,    'YYYY-MM-DD') AS outreach,
              to_char(application_open_date,  'YYYY-MM-DD') AS open,
              to_char(application_close_date, 'YYYY-MM-DD') AS close,
              to_char(selection_end_date,     'YYYY-MM-DD') AS selection_end
         FROM seasons`,
    )

    assert.equal(s.outreach, '2026-02-01', '1次面談の開始日を集客起点に充てた')
    assert.equal(s.open, '2026-03-10', '応募フォームの受付開始。確定')
    assert.equal(s.close, '2026-03-22', '★推測値。実績の最終応募日を締切と見なしている')
    assert.equal(s.selection_end, '2026-04-15', '合否通知・入金案内の日')
    await db.close()
  })
})

describe('本番シードの選考ステップ', () => {
  test('ステップは4つで、この順番である', async () => {
    const db = await productionDb()
    const rows = await all<{ sort_order: number; name: string }>(
      db,
      `SELECT sort_order, name FROM selection_steps ORDER BY sort_order`,
    )

    assert.deepEqual(rows, [
      { sort_order: 1, name: '応募受付' },
      { sort_order: 2, name: '書類選考' },
      { sort_order: 3, name: 'グループ面接' },
      { sort_order: 4, name: '最終面接' },
    ])
    await db.close()
  })

  test('結果や状態はステップに混ざっていない', async () => {
    const db = await productionDb()
    // 旧システムの遷移には 合格予定 / 合格 / 補欠合格 / 承諾書提出 /
    // 保留 / 辞退 / 応募前 も並んでいた。これらを段として入れると
    // 「最終ステップを通過したら合格」が壊れる ―― 合格が段になるため、
    // 通過しても次の段が残りつづける。
    const notSteps = ['応募前', '応募完了', '合格予定', '合格', '補欠合格', '承諾書提出', '保留', '辞退']
    const hit = await scalar<number>(
      db,
      `SELECT count(*)::int FROM selection_steps WHERE name = ANY($1)`,
      [notSteps],
    )

    assert.equal(hit, 0, '結果・状態が selection_steps に入っている')
    await db.close()
  })

  test('最終ステップは最終面接である', async () => {
    const db = await productionDb()
    const last = await scalar<string>(
      db,
      `SELECT name FROM selection_steps ORDER BY sort_order DESC LIMIT 1`,
    )

    assert.equal(last, '最終面接')
    await db.close()
  })

  test('SLA と通過基準は入れていない（運用時に決める値で、旧システムに記録が無い）', async () => {
    const db = await productionDb()
    const filled = await scalar<number>(
      db,
      `SELECT count(*)::int FROM selection_steps
        WHERE sla_days IS NOT NULL OR pass_criteria IS NOT NULL`,
    )

    assert.equal(filled, 0, '推測の SLA が入ると、根拠のない日数で超過が鳴る')
    await db.close()
  })
})

describe('本番シードの評価の観点', () => {
  test('最終面接に6軸があり、運営の言葉のまま入っている', async () => {
    const db = await productionDb()
    const rows = await all<{ name: string; scale_max: number }>(
      db,
      `SELECT c.name, c.scale_max
         FROM evaluation_criteria c
         JOIN selection_steps s ON s.id = c.selection_step_id
        WHERE s.name = '最終面接'
        ORDER BY c.sort_order`,
    )

    assert.deepEqual(
      rows.map((r) => r.name),
      ['笑顔', 'リスペクト', '前提超越', '熱量', '地頭力', '素直さ'],
    )
    assert.ok(
      rows.every((r) => r.scale_max === 4),
      '各軸は4点満点（依頼者に確認して確定。実測の最大からの推定ではない）',
    )
    await db.close()
  })

  test('6軸の満点の合計は24である', async () => {
    const db = await productionDb()
    const total = await scalar<number>(
      db,
      `SELECT sum(c.scale_max)::int
         FROM evaluation_criteria c
         JOIN selection_steps s ON s.id = c.selection_step_id
        WHERE s.name = '最終面接'`,
    )

    assert.equal(total, 24)
    await db.close()
  })

  test('書類選考の軸は入れていない（満点16は確定。呼び名が未確認）', async () => {
    const db = await productionDb()
    // 実測の最大が満点ではない、の実例がここにある。
    // doc_score は実測13・満点16だった。実測から満点を推定していたら間違えていた。
    const n = await scalar<number>(
      db,
      `SELECT count(*)::int
         FROM evaluation_criteria c
         JOIN selection_steps s ON s.id = c.selection_step_id
        WHERE s.name = '書類選考'`,
    )

    assert.equal(
      n,
      0,
      '軸を足すときは呼び名を確認してから。名付けるとマスタとして固定化する（原則3）',
    )
    await db.close()
  })

  test('グループ面接の軸も入れていない（旧データに点が無い）', async () => {
    const db = await productionDb()
    const n = await scalar<number>(
      db,
      `SELECT count(*)::int
         FROM evaluation_criteria c
         JOIN selection_steps s ON s.id = c.selection_step_id
        WHERE s.name = 'グループ面接'`,
    )

    assert.equal(n, 0, 'sec2_group は A〜E の組分けであって評価ではない')
    await db.close()
  })
})

describe('シードは何度流しても増えない', () => {
  test('2回目の適用で年度・ステップ・軸が重複しない', async () => {
    const db = await productionDb()
    await seed(db)

    assert.equal(await scalar<number>(db, `SELECT count(*)::int FROM seasons`), 1)
    assert.equal(await scalar<number>(db, `SELECT count(*)::int FROM selection_steps`), 4)
    assert.equal(await scalar<number>(db, `SELECT count(*)::int FROM evaluation_criteria`), 6)
    await db.close()
  })
})

describe('実年度と創作のデモは同居しない（C-28）', () => {
  test('サンプルの環境に実年度は入らない', async () => {
    // src/seed/demo.ts は 2024〜2027 を創作しており 2026 が重なる。
    // 実年度が残っていると seasons_year_key で衝突するか、
    // 衝突を避ければ創作の応募が実在の年度にぶら下がる。
    const db = await freshDb({ seeds: 'examples' })
    assert.equal(await scalar<number>(db, `SELECT count(*)::int FROM seasons`), 0)
    await db.close()
  })

  test('サンプルの環境にデモを入れても年度が衝突しない', async () => {
    const db = await freshDb({ seeds: 'examples' })
    await seedDemo(db)
    const years = await all<{ enrollment_year: number }>(
      db,
      `SELECT enrollment_year FROM seasons ORDER BY enrollment_year`,
    )
    assert.deepEqual(years.map((r) => r.enrollment_year), [2024, 2025, 2026, 2027])
    await db.close()
  })

  test('本番の環境にサンプルの参照データは入らない', async () => {
    const db = await productionDb()
    assert.equal(await scalar<number>(db, `SELECT count(*)::int FROM channels`), 0)
    await db.close()
  })
})

describe('個人を含むものはシードに入っていない', () => {
  test('本番シードは候補者も職員も作らない', async () => {
    const db = await productionDb()
    // 実データは db/private/ にあり、git の追跡下に無い。
    // 取り込みは .pgdata/ への直接投入で行う（DATA-INTAKE.md 3節の 4）。
    // ここに1人でも入ると、氏名が origin と mirror へ push される。
    for (const t of ['persons', 'staffs', 'applications', 'evaluations']) {
      assert.equal(
        await scalar<number>(db, `SELECT count(*)::int FROM ${t}`),
        0,
        `${t} に行がある。本番シードは個人を含まない`,
      )
    }
    await db.close()
  })
})

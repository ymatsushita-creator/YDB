import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { all, one, scalar } from '../src/db/client.ts'
import { seed } from '../src/db/migrate.ts'

/**
 * 0006 が**本番の形**に当たったときの振る舞い（C-122）。
 *
 * ★ 新しい DB でシードを順に流した結果は tests/22 が固定している。
 *   だが本番の3期は**その形をしていない** ―― 実行⑫の取り込み（C-105）が
 *   特別選考の段と9軸を本番へ直接入れており、シードには無かった。
 *
 *   本番       特別選考(1・9軸・kind は standard) / 書類審査(2) /
 *              グループ面接(3) / 最終面接(4・軸なし)
 *   シード     書類審査(1) / グループ面接(2) / 最終面接(3)
 *
 * **流す前に、流す先の形で確かめる。** ここで作り直しているのは
 * 「取り込み済みの本番」であって、シードが作る姿ではない。
 */

/** 本番の3期の姿へ戻す（0006 が当たる前の状態）。 */
async function asProduction(db: Awaited<ReturnType<typeof freshDb>>) {
  const s3 = await scalar<string>(db, `SELECT id FROM seasons WHERE enrollment_year = 2027`)
  // 応募受付は無い。最終面接の軸も無い。
  await db.query(`
    DELETE FROM evaluation_criteria WHERE selection_step_id IN (
      SELECT id FROM selection_steps WHERE season_id = $1 AND name = '最終面接')`, [s3])
  await db.query(
    `DELETE FROM selection_steps WHERE season_id = $1 AND name = '応募受付'`, [s3])
  // 呼び名は受領した語のまま（C-55）。
  await db.query(
    `UPDATE selection_steps SET name = '書類審査' WHERE season_id = $1 AND name = '書類選考'`,
    [s3])
  // 取り込みは 0033 の既定のまま入れた（重み付けを持たない）。
  await db.query(`
    UPDATE evaluation_criteria SET kind = 'standard' WHERE selection_step_id IN (
      SELECT id FROM selection_steps WHERE season_id = $1)`, [s3])
  // 位置を詰め直す（1..4）。
  for (const [order, name] of [[1, '特別選考'], [2, '書類審査'], [3, 'グループ面接'], [4, '最終面接']] as const) {
    await db.query(
      `UPDATE selection_steps SET sort_order = $2 + 100 WHERE season_id = $1 AND name = $3`,
      [s3, order, name])
  }
  await db.query(
    `UPDATE selection_steps SET sort_order = sort_order - 100 WHERE season_id = $1`, [s3])
  return s3
}

const shape = async (db: Awaited<ReturnType<typeof freshDb>>, cohort: number) =>
  (await all<{ o: number; step: string; crit: string }>(db, `
    SELECT ss.sort_order AS o, ss.name AS step,
           coalesce(string_agg(ec.name || ':' || ec.kind, ',' ORDER BY ec.sort_order), '') AS crit
      FROM selection_steps ss
      JOIN seasons se ON se.id = ss.season_id
      LEFT JOIN evaluation_criteria ec ON ec.selection_step_id = ss.id
     WHERE se.cohort_number = $1
     GROUP BY ss.sort_order, ss.name ORDER BY ss.sort_order`, [cohort]))
    .map((r) => [r.o, r.step, r.crit] as const)

describe('0006 を本番の形に当てる（C-122）', () => {
  test('取り込み済みの3期が、2期と同じ形へ収束する', async () => {
    const db = await freshDb({ seeds: 'production' })
    await asProduction(db)

    // 当てる前 ―― 4段・呼び名は書類審査・重み付け無し
    const before = await shape(db, 3)
    assert.deepEqual(before.map((r) => [r[0], r[1]]), [
      [1, '特別選考'], [2, '書類審査'], [3, 'グループ面接'], [4, '最終面接'],
    ], '本番の形を作れていない')
    assert.ok(before[0]![2].includes(':standard'), '取り込みの軸は重み付けを持たない')

    await seed(db)

    assert.deepEqual(await shape(db, 3), await shape(db, 2),
      '3期が2期と同じ形になっていない')
    await db.close()
  })

  test('軸を重ねて増やさない（9軸のまま重み付けだけ変わる）', async () => {
    const db = await freshDb({ seeds: 'production' })
    await asProduction(db)
    await seed(db)
    await seed(db)   // 二度流しても増えない

    const rows = await all<{ kind: string }>(db, `
      SELECT ec.kind FROM evaluation_criteria ec
        JOIN selection_steps ss ON ss.id = ec.selection_step_id
        JOIN seasons se ON se.id = ss.season_id
       WHERE se.cohort_number = 3 AND ss.name = '特別選考'
       ORDER BY ec.sort_order`)
    assert.equal(rows.length, 9, '軸が増えている（写す前にあった9軸と重なった）')
    assert.deepEqual(rows.map((r) => r.kind), [
      'required', 'required', 'required',
      'strong', 'strong', 'strong', 'strong', 'strong', 'strong',
    ])
    await db.close()
  })

  test('3期に応募が1件でもあれば並べ替えない（C-105 と同じ条件）', async () => {
    // 段の位置は選考の順序そのもので、応募が乗ってから動かすものではない。
    const db = await freshDb({ seeds: 'production' })
    const s3 = await asProduction(db)

    // 本番シードは人も学校も作らない（個人を含まない）。検査用に1件だけ作る。
    const school = await one<{ id: string }>(db, `
      INSERT INTO schools (name) VALUES ('検査用の学校') RETURNING id`)
    const person = await one<{ id: string }>(db, `
      INSERT INTO persons (family_name, given_name, school_id)
      VALUES ('検査', '応募あり', $1) RETURNING id`, [school.id])
    await db.query(`
      INSERT INTO applications (person_id, season_id, submitted_at)
      VALUES ($1, $2, now())`, [person.id, s3])

    await seed(db)

    const steps = await all<{ name: string }>(db, `
      SELECT name FROM selection_steps WHERE season_id = $1 ORDER BY sort_order`, [s3])
    assert.deepEqual(steps.map((r) => r.name),
      ['特別選考', '書類選考', 'グループ面接', '最終面接'],
      '応募が乗っている期の並びを動かしている')
    await db.close()
  })
})

/**
 * 0007 取りこぼした値を引き継ぐ（C-152。依頼者の指示）。
 *
 * 依頼者の言葉（実行⑯）――「選考基準や募集要項、特別選考の基準等
 * 変わらないので引き継げ。勝手に取りこぼしてんじゃねぇよ」。
 *
 * ★ 0006 は段と軸を写したが、**目標応募数だけ null のまま残っていた。**
 *   応募管理表 `001_使い方` の目標 KR には最初から書いてある
 *   （「100名の応募完了と36名の選出」）。定員36は入り、隣の100だけが落ちていた。
 */
describe('0007 目標応募数を引き継ぐ（C-152）', () => {
  /**
   * ★ 変更履歴には職員が要る（`changed_by_staff_id` は NOT NULL）。
   *   本番シードは職員を1人も作らない（個人を含まない）ので、
   *   **職員を入れてから流す** ―― 本番には20人居る。
   *   誰が変えたか名乗れないうちは、この引き継ぎは走らない（それでよい）。
   */
  const withStaff = async () => {
    const db = await freshDb({ seeds: 'production' })
    await db.query(
      `INSERT INTO staffs (display_name) VALUES ('検査 運営')`)
    await seed(db)
    return db
  }

  test('職員が居ないうちは走らない（空欄で濁さない）', async () => {
    const db = await freshDb({ seeds: 'production' })
    const y2027 = await all<{ target_application_count: number | null }>(db,
      `SELECT target_application_count FROM seasons WHERE enrollment_year = 2027`)
    assert.equal(y2027[0]?.target_application_count ?? null, null)
    await db.close()
  })

  test('★ 3期の目標応募数が、2期と同じになる', async () => {
    const db = await withStaff()
    const rows = await all<{ enrollment_year: number; target_application_count: number | null }>(
      db, `SELECT enrollment_year, target_application_count FROM seasons
            WHERE NOT is_demo ORDER BY enrollment_year`)
    const y2026 = rows.find((r) => r.enrollment_year === 2026)
    const y2027 = rows.find((r) => r.enrollment_year === 2027)
    assert.ok(y2026?.target_application_count, '2期の目標応募数が空。写す元が無い')
    assert.equal(y2027?.target_application_count, y2026?.target_application_count,
      '3期の目標応募数が引き継がれていない')
    await db.close()
  })

  test('変えた事実が変更履歴に残る（現在値だけ動かさない）', async () => {
    const db = await withStaff()
    const rev = await all<{ changed_field: string; new_value: string }>(db, `
      SELECT r.changed_field, r.new_value
        FROM season_revisions r JOIN seasons s ON s.id = r.season_id
       WHERE s.enrollment_year = 2027 AND r.changed_field = 'target_application_count'`)
    assert.equal(rev.length, 1, '目標応募数を変えた履歴が無い')
    await db.close()
  })

  test('★ 2度流しても、履歴は1件のまま（冪等）', async () => {
    const db = await withStaff()
    await seed(db)
    const n = await all<{ id: string }>(db, `
      SELECT r.id FROM season_revisions r JOIN seasons s ON s.id = r.season_id
       WHERE s.enrollment_year = 2027 AND r.changed_field = 'target_application_count'`)
    assert.equal(n.length, 1, '流すたびに履歴が積まれている')
    await db.close()
  })
})

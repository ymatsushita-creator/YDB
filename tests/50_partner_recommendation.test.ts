import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { all, scalar, maybeOne, type Db } from '../src/db/client.ts'
import { setPartnerRecommendationState } from '../src/commands/partner.ts'
import { listPartnerSheetRows } from '../src/queries/sheet.ts'
import { addStaff } from '../src/commands/staff.ts'

/**
 * 推薦枠ステイタス（0035）。
 *
 * 応募管理表 `011_提携団体` の「2期生推薦枠ステイタス」。**期の言葉**なので
 * 団体の現在値にしない ―― 3期を入れた瞬間に2期が消える形にしない。
 *
 * 形は 0016（アプローチ状態）と同じ ―― マスタ＋追記専用＋最新から導く現在値。
 */

async function world(db: Db) {
  const staff = await addStaff(db, { displayName: '架空 推薦担当' })
  if (!staff.ok) throw new Error('unreachable')
  const partnerId = await scalar<string>(db,
    `INSERT INTO partners (name) VALUES ('架空推薦大学') RETURNING id`)
  const season2 = await scalar<string>(db, `SELECT id FROM seasons WHERE cohort_number = 2`)
  const season3 = await scalar<string>(db, `SELECT id FROM seasons WHERE cohort_number = 3`)
  const states = new Map((await all<{ code: string; id: string }>(db,
    `SELECT code, id FROM partner_recommendation_states`)).map((s) => [s.code, s.id]))
  return { staffId: staff.staffId, partnerId, season2, season3, states }
}

describe('推薦枠ステイタス（0035）', () => {
  test('運営の語をそのまま4つ持つ（言い換えない）', async () => {
    const db = await freshDb()
    const labels = await all<{ label: string }>(db, `
      SELECT label FROM partner_recommendation_states WHERE is_active ORDER BY sort_order`)
    assert.deepEqual(labels.map((l) => l.label),
      ['未連絡', 'メール送信済み', 'アポ実施済み', '対象外'])
    // 「対象外」だけが終端（これ以上こちらから動かさない）。
    const terminal = await all<{ code: string }>(db, `
      SELECT code FROM partner_recommendation_states WHERE is_terminal`)
    assert.deepEqual(terminal.map((t) => t.code), ['out_of_scope'])
    await db.close()
  })

  test('★ 期ごとに別の状態を持てる（3期を入れても2期が消えない）', async () => {
    const db = await freshDb({ seeds: 'production' })
    const w = await world(db)

    assert.equal((await setPartnerRecommendationState(db, {
      partnerId: w.partnerId, seasonId: w.season2,
      stateId: w.states.get('met')!, staffId: w.staffId,
    })).ok, true)
    assert.equal((await setPartnerRecommendationState(db, {
      partnerId: w.partnerId, seasonId: w.season3,
      stateId: w.states.get('not_contacted')!, staffId: w.staffId,
    })).ok, true)

    const state = (seasonId: string) => maybeOne<{ state_label: string }>(db, `
      SELECT state_label FROM v_partner_recommendation_state
       WHERE partner_id = $1 AND season_id = $2`, [w.partnerId, seasonId])

    assert.equal((await state(w.season2))?.state_label, 'アポ実施済み',
      '3期を入れても2期の状態が残る')
    assert.equal((await state(w.season3))?.state_label, '未連絡')
    await db.close()
  })

  test('同じ状態をもう一度置いても出来事を積まない', async () => {
    const db = await freshDb({ seeds: 'production' })
    const w = await world(db)
    const put = () => setPartnerRecommendationState(db, {
      partnerId: w.partnerId, seasonId: w.season2,
      stateId: w.states.get('mailed')!, staffId: w.staffId,
    })
    const first = await put()
    assert.equal(first.ok && first.changed, true)
    const again = await put()
    assert.equal(again.ok && again.changed, false, '積むと「その日に動きがあった」意味が生まれる')
    assert.equal(await scalar<number>(db, `
      SELECT count(*)::int FROM partner_recommendation_events
       WHERE partner_id = $1`, [w.partnerId]), 1)
    await db.close()
  })

  test('追記専用（UPDATE も DELETE もトリガが拒む）', async () => {
    const db = await freshDb({ seeds: 'production' })
    const w = await world(db)
    await setPartnerRecommendationState(db, {
      partnerId: w.partnerId, seasonId: w.season2,
      stateId: w.states.get('met')!, staffId: w.staffId,
    })
    const id = await scalar<string>(db,
      `SELECT id FROM partner_recommendation_events LIMIT 1`)
    await assert.rejects(db.query(
      `UPDATE partner_recommendation_events SET note = 'x' WHERE id = $1`, [id]))
    await assert.rejects(db.query(
      `DELETE FROM partner_recommendation_events WHERE id = $1`, [id]))
    await db.close()
  })

  test('打ち消しの追記で訂正でき、訂正を訂正すると元に戻る', async () => {
    const db = await freshDb({ seeds: 'production' })
    const w = await world(db)
    await setPartnerRecommendationState(db, {
      partnerId: w.partnerId, seasonId: w.season2,
      stateId: w.states.get('out_of_scope')!, staffId: w.staffId,
    })
    const wrong = await scalar<string>(db,
      `SELECT id FROM partner_recommendation_events LIMIT 1`)
    const label = () => scalar<string | null>(db, `
      SELECT state_label FROM v_partner_recommendation_state
       WHERE partner_id = $1 AND season_id = $2`, [w.partnerId, w.season2])
    assert.equal(await label(), '対象外')

    // 「対象外」を押し間違えた。打ち消して「アポ実施済み」に直す。
    // ★ 訂正行は**そのとき正しい値を持つ**（0016 と同じ ―― 打ち消しは
    //   「無かったことにする」ではなく「こう直す」である）。
    const fix = await scalar<string>(db, `
      INSERT INTO partner_recommendation_events
        (partner_id, season_id, state_id, occurred_at, recorded_by_staff_id,
         is_correction, corrects_event_id)
      VALUES ($1, $2, $3, now(), $4, true, $5) RETURNING id`,
    [w.partnerId, w.season2, w.states.get('met'), w.staffId, wrong])
    assert.equal(await label(), 'アポ実施済み')

    // 訂正のほうが誤りだった。打ち消すと元の「対象外」が復活する（逆仕訳）。
    await db.query(`
      INSERT INTO partner_recommendation_events
        (partner_id, season_id, state_id, occurred_at, recorded_by_staff_id,
         is_correction, corrects_event_id)
      VALUES ($1, $2, $3, now(), $4, true, $5)`,
    [w.partnerId, w.season2, w.states.get('out_of_scope'), w.staffId, fix])
    assert.equal(await label(), '対象外')
    await db.close()
  })

  test('表はその期の推薦枠を出す（期を渡さなければ空）', async () => {
    const db = await freshDb({ seeds: 'production' })
    const w = await world(db)
    await setPartnerRecommendationState(db, {
      partnerId: w.partnerId, seasonId: w.season2,
      stateId: w.states.get('met')!, staffId: w.staffId,
    })

    const row2 = (await listPartnerSheetRows(db, w.season2))
      .find((p) => p.partner_id === w.partnerId)
    assert.equal(row2?.recommendation_state_id, w.states.get('met'))

    const row3 = (await listPartnerSheetRows(db, w.season3))
      .find((p) => p.partner_id === w.partnerId)
    assert.equal(row3?.recommendation_state_id, null, '別の期の状態を持ち込まない')
    await db.close()
  })
})

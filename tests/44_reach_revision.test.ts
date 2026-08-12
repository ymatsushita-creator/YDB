import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { all, maybeOne, scalar, type Db } from '../src/db/client.ts'
import { addPartnerReach } from '../src/commands/intake.ts'
import { updatePartnerReach } from '../src/commands/partner.ts'
import { makeSeason } from './support/fixtures.ts'

/**
 * 接触記録をセルで直せるようにする（実行⑫。依頼者の指示）。
 *
 * 依頼者の判断は「直せる。変更履歴を新しく持つ」。
 * 記録層は 0032（`partner_reach_revisions`）。
 *
 * ★ `partner_reaches` は追記専用ではないので UPDATE そのものは通る。
 *   だが**現在値を上書きするなら履歴を追記保存する**（`CLAUDE.md`）。
 *   置き場所が無いままセルで直せるようにすると、
 *   「誰が推定リーチを 300 から 30 にしたのか」が消える。
 *
 * 固定したいのは6つ ――
 *   ① 直すと現在値が変わり、変更後の値が版として積まれる
 *   ② **日付を変えたら期の帰属も付け替わる。** 近い期へ寄せない
 *   ③ 推定リーチは**空に戻せる。** 0 にしない（0 は「届かなかった」）
 *   ④ 変更履歴は追記専用。後から書き換えられない
 *   ⑤ 何も変わっていない保存で版を増やさない
 *   ⑥ 居ない接触・読めない値は保存しない
 */

describe('接触記録の訂正', () => {
  let db: Db
  let partnerId: string
  let staffId: string
  let reachId: string
  let seasonId: string

  const revisions = () => all<{
    revision_number: number
    occurred_on: Date
    method: string | null
    estimated_reach: number | null
    note: string | null
    season_id: string | null
  }>(db, `
    SELECT revision_number, occurred_on, method, estimated_reach, note, season_id
      FROM partner_reach_revisions
     WHERE reach_id = $1
     ORDER BY revision_number`, [reachId])

  before(async () => {
    db = await freshDb()
    const season = await makeSeason(db, {
      year: 2026,
      outreachStart: '2025-09-01',
      selectionEnd: '2026-02-28',
    })
    seasonId = season.id
    staffId = await scalar<string>(db, `
      INSERT INTO staffs (display_name, email)
      VALUES ('架空 運営', 'reach@example.test') RETURNING id`)

    const added = await addPartnerReach(db, {
      partnerId: '', partnerName: '架空接触団体', category: '', contactName: '',
      contactEmail: '', occurredOn: '2025-10-01', method: '訪問',
      estimatedReach: '300', note: '説明会を開いた',
    })
    assert.equal(added.ok, true)
    if (!added.ok) throw new Error('unreachable')
    partnerId = added.partnerId
    reachId = await scalar<string>(db,
      `SELECT id FROM partner_reaches WHERE partner_id = $1`, [partnerId])
  })

  after(async () => { await db.close() })

  // -----------------------------------------------------------
  // ① 直すと版が積まれる
  // -----------------------------------------------------------
  test('直すと現在値が変わり、変更後の値が版になる', async () => {
    const r = await updatePartnerReach(db, {
      reachId, occurredOn: '2025-10-01', method: 'オンライン説明会',
      estimatedReach: '250', note: '説明会を開いた', staffId,
    })
    assert.equal(r.ok, true)

    const now = await maybeOne<{ method: string; estimated_reach: number }>(db,
      `SELECT method, estimated_reach FROM partner_reaches WHERE id = $1`, [reachId])
    assert.equal(now?.method, 'オンライン説明会')
    assert.equal(now?.estimated_reach, 250)

    const log = await revisions()
    assert.equal(log.length, 1)
    assert.equal(log[0]?.revision_number, 1)
    assert.equal(log[0]?.method, 'オンライン説明会')
    assert.equal(log[0]?.estimated_reach, 250)
    assert.equal(log[0]?.season_id, seasonId, '版はその時点の期の帰属も持つ')
  })

  // -----------------------------------------------------------
  // ② 日付を変えたら期の帰属も動く
  // -----------------------------------------------------------
  test('日付を変えると期の帰属が付け替わる。どの期にも入らない日は紐づかない', async () => {
    const inside = await updatePartnerReach(db, {
      reachId, occurredOn: '2026-01-15', method: 'オンライン説明会',
      estimatedReach: '250', note: '説明会を開いた', staffId,
    })
    assert.equal(inside.ok, true)
    assert.equal(
      await scalar<string | null>(db,
        `SELECT season_id FROM partner_reaches WHERE id = $1`, [reachId]),
      seasonId)

    // 期の期間の外へ動かす。**近い期へ寄せない**（C-78 と同じ規律）。
    const outside = await updatePartnerReach(db, {
      reachId, occurredOn: '2024-05-01', method: 'オンライン説明会',
      estimatedReach: '250', note: '説明会を開いた', staffId,
    })
    assert.equal(outside.ok, true)
    assert.equal(
      await scalar<string | null>(db,
        `SELECT season_id FROM partner_reaches WHERE id = $1`, [reachId]),
      null, 'どの期にも入らない接触は、どの期にも紐づかないまま残る')
  })

  // -----------------------------------------------------------
  // ③ 推定リーチは空に戻せる
  // -----------------------------------------------------------
  test('推定リーチを空に戻せる（0 にしない）', async () => {
    const r = await updatePartnerReach(db, {
      reachId, occurredOn: '2025-10-01', method: 'オンライン説明会',
      estimatedReach: '', note: '説明会を開いた', staffId,
    })
    assert.equal(r.ok, true)
    assert.equal(
      await scalar<number | null>(db,
        `SELECT estimated_reach FROM partner_reaches WHERE id = $1`, [reachId]),
      null, '分からないは 0 ではない')
  })

  // -----------------------------------------------------------
  // ④ 追記専用
  // -----------------------------------------------------------
  test('変更履歴は後から書き換えられない', async () => {
    await assert.rejects(() => db.query(
      `UPDATE partner_reach_revisions SET method = '書き換え' WHERE reach_id = $1`, [reachId]))
    await assert.rejects(() => db.query(
      `DELETE FROM partner_reach_revisions WHERE reach_id = $1`, [reachId]))
  })

  // -----------------------------------------------------------
  // ⑤ 変わっていないなら版を増やさない
  // -----------------------------------------------------------
  test('同じ値で保存し直しても版は増えない', async () => {
    const same = {
      reachId, occurredOn: '2025-10-01', method: 'オンライン説明会',
      estimatedReach: '', note: '説明会を開いた', staffId,
    }
    await updatePartnerReach(db, same)
    const before = (await revisions()).length
    const again = await updatePartnerReach(db, same)
    assert.equal(again.ok, true)
    assert.equal((await revisions()).length, before)
  })

  // -----------------------------------------------------------
  // ⑥ 読めない値は保存しない
  // -----------------------------------------------------------
  test('居ない接触・読めない値は保存しない', async () => {
    const missing = await updatePartnerReach(db, {
      reachId: '00000000-0000-0000-0000-000000000000',
      occurredOn: '2025-10-01', method: '', estimatedReach: '', note: '', staffId,
    })
    assert.equal(missing.ok, false)
    if (missing.ok) throw new Error('unreachable')
    assert.equal(missing.reason, 'reach_not_found')

    const badDate = await updatePartnerReach(db, {
      reachId, occurredOn: '2025/10/01', method: '', estimatedReach: '', note: '', staffId,
    })
    assert.equal(badDate.ok, false)
    if (badDate.ok) throw new Error('unreachable')
    assert.equal(badDate.reason, 'bad_date')

    const badEstimate = await updatePartnerReach(db, {
      reachId, occurredOn: '2025-10-01', method: '', estimatedReach: '-1', note: '', staffId,
    })
    assert.equal(badEstimate.ok, false)
    if (badEstimate.ok) throw new Error('unreachable')
    assert.equal(badEstimate.reason, 'bad_estimate')
  })
})

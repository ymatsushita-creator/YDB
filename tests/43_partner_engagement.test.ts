import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { all, maybeOne, scalar, type Db } from '../src/db/client.ts'
import { setPartnerEngagement, ENGAGEMENT_MAX } from '../src/commands/partner.ts'

/**
 * 団体の「NEO としてどう関わるか」（実行⑫。依頼者の指示）。
 *
 * 依頼者が決めたこと ――
 *   位置   **団体そのものの属性**（現在値。メモごとではない）
 *   持ち方 **自由入力の1行**
 *   メモ   **既存の接触記録の「記録」欄を使う**（団体メモの表を作らない）
 *
 * ★ 現在値を上書きするので、**変更履歴を追記保存する**（`CLAUDE.md`）。
 *   形は `interview_sheets` ＋ `interview_sheet_revisions`（0022）と同じ。
 *
 * 固定したいのは5つ ――
 *   ① 書けば現在値になる。**同時に第1版が積まれる**
 *   ② 書き換えると版が増える。**前の値が消えない**
 *   ③ 消す（空にする）のも変更である。版に残る
 *   ④ 変更履歴は追記専用。**後から書き換えられない**
 *   ⑤ 同じ値で保存し直したときは版を増やさない（履歴が「何も変わっていない版」で埋まる）
 */

describe('団体の関わり方', () => {
  let db: Db
  let partnerId: string
  let staffId: string

  const revisions = () => all<{ revision_number: number; engagement: string | null }>(db, `
    SELECT revision_number, engagement
      FROM partner_engagement_revisions
     WHERE partner_id = $1
     ORDER BY revision_number`, [partnerId])

  const current = () => scalar<string | null>(db,
    `SELECT engagement FROM partners WHERE id = $1`, [partnerId])

  before(async () => {
    db = await freshDb()
    partnerId = await scalar<string>(db,
      `INSERT INTO partners (name) VALUES ('架空団体') RETURNING id`)
    staffId = await scalar<string>(db, `
      INSERT INTO staffs (display_name, email)
      VALUES ('架空 運営', 'partner@example.test') RETURNING id`)
  })

  after(async () => { await db.close() })

  // -----------------------------------------------------------
  // ① 現在値と第1版
  // -----------------------------------------------------------
  test('書くと現在値になり、第1版が積まれる', async () => {
    const r = await setPartnerEngagement(db, {
      partnerId, engagement: '合同イベントの共催先', staffId,
    })
    assert.equal(r.ok, true)

    assert.equal(await current(), '合同イベントの共催先')
    const log = await revisions()
    assert.deepEqual(log, [{ revision_number: 1, engagement: '合同イベントの共催先' }])
  })

  // -----------------------------------------------------------
  // ② 書き換えても前の値が消えない
  // -----------------------------------------------------------
  test('書き換えると版が増え、前の値が履歴に残る', async () => {
    const r = await setPartnerEngagement(db, {
      partnerId, engagement: '講座の登壇先', staffId,
    })
    assert.equal(r.ok, true)

    assert.equal(await current(), '講座の登壇先')
    const log = await revisions()
    assert.deepEqual(log.map((x) => x.engagement),
      ['合同イベントの共催先', '講座の登壇先'],
      '現在値だけ見れば十分ではない。何から何へ変えたかが辿れること')
  })

  // -----------------------------------------------------------
  // ③ 空にするのも変更
  // -----------------------------------------------------------
  test('空にするのも変更として版に残る', async () => {
    const r = await setPartnerEngagement(db, { partnerId, engagement: '   ', staffId })
    assert.equal(r.ok, true)

    assert.equal(await current(), null, '空白だけは NULL に倒す')
    const log = await revisions()
    assert.equal(log.length, 3)
    assert.equal(log[2]?.engagement, null, '「消した」ことが版に残る')
  })

  // -----------------------------------------------------------
  // ④ 追記専用
  // -----------------------------------------------------------
  test('変更履歴は後から書き換えられない', async () => {
    await assert.rejects(() => db.query(
      `UPDATE partner_engagement_revisions SET engagement = '書き換え' WHERE partner_id = $1`,
      [partnerId]))
    await assert.rejects(() => db.query(
      `DELETE FROM partner_engagement_revisions WHERE partner_id = $1`, [partnerId]))
  })

  // -----------------------------------------------------------
  // ⑤ 変わっていないなら版を増やさない
  // -----------------------------------------------------------
  test('同じ値で保存し直しても版は増えない', async () => {
    await setPartnerEngagement(db, { partnerId, engagement: '紹介元', staffId })
    const before = (await revisions()).length

    const again = await setPartnerEngagement(db, { partnerId, engagement: '紹介元', staffId })
    assert.equal(again.ok, true)
    assert.equal((await revisions()).length, before,
      '同じ値なら履歴を増やさない（増やすと「いつ変わったか」が読めなくなる）')
  })

  // -----------------------------------------------------------
  // 参照先と長さは、コマンド側でも見る
  // -----------------------------------------------------------
  test('居ない団体・長すぎる値は保存しない', async () => {
    const missing = await setPartnerEngagement(db, {
      partnerId: '00000000-0000-0000-0000-000000000000', engagement: '共催', staffId,
    })
    assert.equal(missing.ok, false)
    if (missing.ok) throw new Error('unreachable')
    assert.equal(missing.reason, 'partner_not_found')

    const tooLong = await setPartnerEngagement(db, {
      partnerId, engagement: 'あ'.repeat(ENGAGEMENT_MAX + 1), staffId,
    })
    assert.equal(tooLong.ok, false)
    if (tooLong.ok) throw new Error('unreachable')
    assert.equal(tooLong.reason, 'engagement_too_long')
  })

  // -----------------------------------------------------------
  // 記録した人
  // -----------------------------------------------------------
  test('誰が変えたかを版に持つ（居ない職員は受け取らない）', async () => {
    const row = await maybeOne<{ changed_by_staff_id: string | null }>(db, `
      SELECT changed_by_staff_id FROM partner_engagement_revisions
       WHERE partner_id = $1 ORDER BY revision_number DESC LIMIT 1`, [partnerId])
    assert.equal(row?.changed_by_staff_id, staffId)

    const bad = await setPartnerEngagement(db, {
      partnerId, engagement: '共催', staffId: '00000000-0000-0000-0000-000000000000',
    })
    assert.equal(bad.ok, false)
    if (bad.ok) throw new Error('unreachable')
    assert.equal(bad.reason, 'staff_not_found')
  })
})

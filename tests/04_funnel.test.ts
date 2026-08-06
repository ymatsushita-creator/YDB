import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { one, scalar } from '../src/db/client.ts'
import {
  baseFixture, makeSeason, makePerson, makeApplication, addHistory, accept,
  makeChannel, makeTouchpoint, makeVoidReason, voidApplication, funnelOn, jst,
} from './support/fixtures.ts'

const OPEN = '2025-11-01'
const CLOSE = '2025-12-15'
const END = '2026-02-28'

const setup = async () => {
  const db = await freshDb()
  const base = await baseFixture(db)
  const season = await makeSeason(db, {
    year: 2026, applicationOpen: OPEN, applicationClose: CLOSE, selectionEnd: END,
  })
  return { ...base, season }
}

describe('ファネルは累積で数える', () => {
  test('応募は提出日から末日まで計上され続ける', async () => {
    const { db, schoolId, season } = await setup()
    const p = await makePerson(db, schoolId)
    await makeApplication(db, p, season.id, jst('2025-11-10T09:00:00'))

    assert.equal((await funnelOn(db, season.id, '2025-11-09')).applicant_cum, 0, '提出前')
    assert.equal((await funnelOn(db, season.id, '2025-11-10')).applicant_cum, 1, '提出当日')
    assert.equal((await funnelOn(db, season.id, END)).applicant_cum, 1, '末日まで残る')
    await db.close()
  })

  test('中間ステップへの advance では幹にならない', async () => {
    // 幹の定義は「最終ステップへの有効な advance」。
    const { db, schoolId, staffId, season } = await setup()
    const p = await makePerson(db, schoolId)
    const app = await makeApplication(db, p, season.id, jst('2025-11-10T09:00:00'))

    for (const stepId of season.stepIds.slice(0, -1)) {
      await addHistory(db, {
        applicationId: app, type: 'advance', stepId, staffId,
        occurredAt: jst('2025-11-20T10:00:00'),
      })
    }
    assert.equal((await funnelOn(db, season.id, END)).accepted_cum, 0)

    await accept(db, { applicationId: app, season, staffId, occurredAt: jst('2025-12-20T10:00:00') })
    assert.equal((await funnelOn(db, season.id, '2025-12-19')).accepted_cum, 0)
    assert.equal((await funnelOn(db, season.id, '2025-12-20')).accepted_cum, 1)
    await db.close()
  })

  test('差し戻し（revert）が起きても到達済みとして数え続ける', async () => {
    // 「到達したことがあるか」で判定するため、1人は1人として数える。
    const { db, schoolId, staffId, season } = await setup()
    const p = await makePerson(db, schoolId)
    const app = await makeApplication(db, p, season.id, jst('2025-11-10T09:00:00'))
    await accept(db, { applicationId: app, season, staffId, occurredAt: jst('2025-12-20T10:00:00') })
    await addHistory(db, {
      applicationId: app, type: 'revert', stepId: season.stepIds[1], staffId,
      occurredAt: jst('2025-12-22T10:00:00'),
    })

    assert.equal((await funnelOn(db, season.id, END)).accepted_cum, 1)
    await db.close()
  })
})

describe('不合格と辞退は混ぜない', () => {
  test('内定辞退は幹を減らさず、純幹だけを減らす', async () => {
    // 定員に対する充足を測るのは純幹のほう。
    const { db, schoolId, staffId, season } = await setup()
    const p1 = await makePerson(db, schoolId)
    const p2 = await makePerson(db, schoolId)
    for (const p of [p1, p2]) {
      const app = await makeApplication(db, p, season.id, jst('2025-11-10T09:00:00'))
      await accept(db, { applicationId: app, season, staffId, occurredAt: jst('2025-12-20T10:00:00') })
      if (p === p2) {
        await addHistory(db, {
          applicationId: app, type: 'withdraw', staffId,
          occurredAt: jst('2026-01-10T10:00:00'),
        })
      }
    }

    const before = await funnelOn(db, season.id, '2026-01-09')
    assert.deepEqual([before.accepted_cum, before.net_accepted_cum], [2, 2], '辞退前')

    const after = await funnelOn(db, season.id, '2026-01-10')
    assert.equal(after.accepted_cum, 2, '幹は減らない。到達した事実は消えない')
    assert.equal(after.net_accepted_cum, 1, '純幹は辞退を控除する')
    assert.equal(after.withdrawn_cum, 1)
    assert.equal(after.rejected_cum, 0, '辞退は不合格ではない')
    await db.close()
  })

  test('不合格と辞退は別々に集計される', async () => {
    const { db, schoolId, staffId, season } = await setup()
    const rejected = await makeApplication(
      db, await makePerson(db, schoolId), season.id, jst('2025-11-10T09:00:00'))
    const withdrawn = await makeApplication(
      db, await makePerson(db, schoolId), season.id, jst('2025-11-10T09:00:00'))

    await addHistory(db, {
      applicationId: rejected, type: 'reject', staffId, occurredAt: jst('2025-12-01T10:00:00'),
    })
    await addHistory(db, {
      applicationId: withdrawn, type: 'withdraw', staffId, occurredAt: jst('2025-12-01T10:00:00'),
    })

    const f = await funnelOn(db, season.id, END)
    assert.deepEqual([f.rejected_cum, f.withdrawn_cum], [1, 1])
    await db.close()
  })
})

describe('訂正はファネルにそのまま反映される', () => {
  test('合格を取り消す訂正で幹が減り、その訂正をさらに訂正すると戻る', async () => {
    const { db, schoolId, staffId, season } = await setup()
    const p = await makePerson(db, schoolId)
    const app = await makeApplication(db, p, season.id, jst('2025-11-10T09:00:00'))

    const h1 = await accept(db, {
      applicationId: app, season, staffId, occurredAt: jst('2025-12-20T10:00:00'),
    })
    assert.equal((await funnelOn(db, season.id, END)).accepted_cum, 1)

    // 誤って合格にしていた。打ち消して不合格に訂正する。
    const h2 = await addHistory(db, {
      applicationId: app, type: 'reject', staffId,
      occurredAt: jst('2025-12-21T10:00:00'), correctsHistoryId: h1,
    })
    let f = await funnelOn(db, season.id, END)
    assert.deepEqual([f.accepted_cum, f.rejected_cum], [0, 1], '訂正が効いている')

    // やはり合格が正しかった。訂正を訂正する。
    await addHistory(db, {
      applicationId: app, type: 'advance', stepId: season.finalStepId, staffId,
      occurredAt: jst('2025-12-22T10:00:00'), correctsHistoryId: h2,
    })
    f = await funnelOn(db, season.id, END)
    assert.deepEqual([f.accepted_cum, f.rejected_cum], [1, 0], '元の合格が復活している')
    await db.close()
  })
})

describe('無効化された応募の扱い', () => {
  test('counts_as_application が真なら、無効化されても木に数える', async () => {
    // 取り下げのように代替の Application が生まれない無効化は、
    // 応募が起きた事実として残さないと応募数が実態より少なく出る。
    const { db, schoolId, season } = await setup()
    const counts = await makeVoidReason(db, 'withdrawn_by_applicant', true)
    const notCounts = await makeVoidReason(db, 'identity_merge_error', false)

    const kept = await makeApplication(
      db, await makePerson(db, schoolId), season.id, jst('2025-11-10T09:00:00'))
    const dropped = await makeApplication(
      db, await makePerson(db, schoolId), season.id, jst('2025-11-10T09:00:00'))

    assert.equal((await funnelOn(db, season.id, END)).applicant_cum, 2, '無効化前は2件')

    await voidApplication(db, kept, counts, jst('2025-11-20T10:00:00'))
    await voidApplication(db, dropped, notCounts, jst('2025-11-20T10:00:00'))

    assert.equal(
      (await funnelOn(db, season.id, END)).applicant_cum, 1,
      'counts_as_application=false の1件だけが落ちる',
    )
    await db.close()
  })

  test('個人情報削除（deleted_at）は理由を問わず集計から外れる', async () => {
    const { db, schoolId, season } = await setup()
    const app = await makeApplication(
      db, await makePerson(db, schoolId), season.id, jst('2025-11-10T09:00:00'))
    await db.query(`UPDATE applications SET deleted_at = now() WHERE id = $1`, [app])
    assert.equal((await funnelOn(db, season.id, END)).applicant_cum, 0)
    await db.close()
  })
})

describe('林は Season スコープのアクティブ判定', () => {
  test('直近 N 日に接点がある Person だけを数える', async () => {
    const { db, schoolId, season } = await setup()
    const ch = await makeChannel(db, 'イベント')
    const p = await makePerson(db, schoolId, { createdAt: jst('2025-10-15T10:00:00') })
    await makeTouchpoint(db, p, ch, jst('2025-10-15T10:00:00'))

    // 窓は「その日から遡って30日以内」。境界は開区間。
    assert.equal((await funnelOn(db, season.id, '2025-11-13', 30)).identified_person_cum, 1,
      '29日後：まだ窓の中')
    assert.equal((await funnelOn(db, season.id, '2025-11-14', 30)).identified_person_cum, 0,
      '30日後：窓から外れる')
    await db.close()
  })

  test('接点が一度もない Person は林に数えない', async () => {
    const { db, schoolId, season } = await setup()
    await makePerson(db, schoolId, { createdAt: jst('2025-10-15T10:00:00') })
    assert.equal((await funnelOn(db, season.id, '2025-11-01', 30)).identified_person_cum, 0)
    await db.close()
  })

  test('新しい接点があれば林に戻る', async () => {
    // タレントプールからの再アプローチ（is_scout）で林に復帰する経路。
    const { db, schoolId, season } = await setup()
    const ch = await makeChannel(db, 'スカウト')
    const p = await makePerson(db, schoolId, { createdAt: jst('2025-09-01T10:00:00') })
    await makeTouchpoint(db, p, ch, jst('2025-09-01T10:00:00'))

    assert.equal((await funnelOn(db, season.id, '2025-11-20', 30)).identified_person_cum, 0,
      '古い接点だけでは休眠')

    await makeTouchpoint(db, p, ch, jst('2025-11-18T10:00:00'))
    assert.equal((await funnelOn(db, season.id, '2025-11-20', 30)).identified_person_cum, 1,
      '再接触で復帰')
    await db.close()
  })
})

describe('ファネルの単調性', () => {
  test('累積列はどれも日付に対して減少しない', async () => {
    // 累積の定義から自明に見えるが、訂正や辞退の控除が絡むと崩れやすい。
    // net_accepted_cum だけは辞退で減るため対象外。
    const { db, schoolId, staffId, season } = await setup()
    for (let i = 0; i < 5; i++) {
      const app = await makeApplication(
        db, await makePerson(db, schoolId), season.id, jst(`2025-11-${10 + i}T09:00:00`))
      if (i % 2 === 0) {
        await accept(db, { applicationId: app, season, staffId, occurredAt: jst(`2025-12-${10 + i}T10:00:00`) })
      } else {
        await addHistory(db, {
          applicationId: app, type: 'reject', staffId, occurredAt: jst(`2025-12-${10 + i}T10:00:00`),
        })
      }
    }

    const { rows } = await db.query<Record<string, string>>(
      `SELECT as_of, applicant_cum, accepted_cum, rejected_cum, withdrawn_cum
         FROM f_funnel_daily(90) WHERE season_id = $1 ORDER BY as_of`,
      [season.id],
    )
    const cols = ['applicant_cum', 'accepted_cum', 'rejected_cum', 'withdrawn_cum'] as const
    for (const col of cols) {
      let prev = -1
      for (const r of rows) {
        const v = Number(r[col])
        assert.ok(v >= prev, `${col} が ${r.as_of} で減少した: ${prev} -> ${v}`)
        prev = v
      }
    }
    assert.ok(rows.length > 100, '応募開始から選考終了まで日次で並ぶ')
    await db.close()
  })
})

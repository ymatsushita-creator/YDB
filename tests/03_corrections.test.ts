import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { all, one, scalar, type Db } from '../src/db/client.ts'
import {
  baseFixture, makeSeason, makePerson, makeApplication, addHistory, jst,
  type Season,
} from './support/fixtures.ts'

/**
 * 原則5「訂正は打ち消しの追記で表現し、元の記録は残す」の検証。
 *
 * 有効性の判定は訂正チェーンの深さで決まる。誰にも訂正されていない行を
 * 深さ0とし、偶数深度の行が有効。訂正を訂正すれば元が復活する。
 * 会計の逆仕訳と同じ挙動になる。
 */
describe('訂正チェーン', () => {
  let db: Db
  let staffId: string
  let season: Season
  let applicationId: string

  before(async () => {
    db = await freshDb()
    const base = await baseFixture(db)
    staffId = base.staffId
    season = await makeSeason(db, { year: 2026 })
    const person = await makePerson(db, base.schoolId)
    applicationId = await makeApplication(db, person, season.id, jst('2025-11-05T10:00:00'))
  })

  after(async () => { await db.close() })

  const effectiveIds = async () => {
    const rows = await all<{ id: string }>(
      db,
      `SELECT id FROM v_effective_status_histories WHERE application_id = $1`,
      [applicationId],
    )
    return new Set(rows.map((r) => r.id))
  }

  test('訂正されていない行はそのまま有効', async () => {
    const h1 = await addHistory(db, {
      applicationId, type: 'advance', stepId: season.stepIds[0],
      staffId, occurredAt: jst('2025-11-10T10:00:00'),
    })
    assert.ok((await effectiveIds()).has(h1))
  })

  test('訂正された行は無効になり、訂正行が有効になる', async () => {
    const h1 = await addHistory(db, {
      applicationId, type: 'advance', stepId: season.stepIds[1],
      staffId, occurredAt: jst('2025-11-11T10:00:00'),
    })
    const h2 = await addHistory(db, {
      applicationId, type: 'reject', staffId,
      occurredAt: jst('2025-11-11T15:00:00'), correctsHistoryId: h1,
    })

    const eff = await effectiveIds()
    assert.equal(eff.has(h1), false, '訂正された元の行は無効')
    assert.equal(eff.has(h2), true, '訂正行は有効')
  })

  test('訂正を訂正すると元の記録が復活する（逆仕訳）', async () => {
    const h1 = await addHistory(db, {
      applicationId, type: 'advance', stepId: season.finalStepId,
      staffId, occurredAt: jst('2025-12-01T10:00:00'),
    })
    const h2 = await addHistory(db, {
      applicationId, type: 'reject', staffId,
      occurredAt: jst('2025-12-02T10:00:00'), correctsHistoryId: h1,
    })
    const h3 = await addHistory(db, {
      applicationId, type: 'advance', stepId: season.finalStepId,
      staffId, occurredAt: jst('2025-12-03T10:00:00'), correctsHistoryId: h2,
    })

    const eff = await effectiveIds()
    assert.equal(eff.has(h3), true, '深さ0：有効')
    assert.equal(eff.has(h2), false, '深さ1：無効')
    assert.equal(eff.has(h1), true, '深さ2：復活する')
  })

  test('4段の訂正チェーンでも偶数深度だけが有効', async () => {
    const mk = (day: string, corrects?: string) =>
      addHistory(db, {
        applicationId, type: 'reject', staffId,
        occurredAt: jst(`2026-01-0${day}T10:00:00`), correctsHistoryId: corrects,
      })
    const h1 = await mk('1')
    const h2 = await mk('2', h1)
    const h3 = await mk('3', h2)
    const h4 = await mk('4', h3)

    const eff = await effectiveIds()
    assert.deepEqual(
      [eff.has(h1), eff.has(h2), eff.has(h3), eff.has(h4)],
      [false, true, false, true],
      '末尾から数えて 0,1,2,3 → 有効,無効,有効,無効',
    )
  })
})

describe('訂正チェーンの構造的な健全性', () => {
  test('同じ行を打ち消す訂正行は2つ作れない', async () => {
    // 分岐すると、どちらの訂正が有効かが一意に決まらない。
    const db = await freshDb()
    const base = await baseFixture(db)
    const season = await makeSeason(db, { year: 2026 })
    const person = await makePerson(db, base.schoolId)
    const app = await makeApplication(db, person, season.id, jst('2025-11-05T10:00:00'))

    const h1 = await addHistory(db, {
      applicationId: app, type: 'advance', stepId: season.stepIds[0],
      staffId: base.staffId, occurredAt: jst('2025-11-10T10:00:00'),
    })
    await addHistory(db, {
      applicationId: app, type: 'reject', staffId: base.staffId,
      occurredAt: jst('2025-11-11T10:00:00'), correctsHistoryId: h1,
    })
    await assert.rejects(
      () => addHistory(db, {
        applicationId: app, type: 'withdraw', staffId: base.staffId,
        occurredAt: jst('2025-11-12T10:00:00'), correctsHistoryId: h1,
      }),
      /status_histories_corrects_key|duplicate key/,
    )
    await db.close()
  })

  test('自分自身を訂正する行は作れない', async () => {
    const db = await freshDb()
    const base = await baseFixture(db)
    const season = await makeSeason(db, { year: 2026 })
    const person = await makePerson(db, base.schoolId)
    const app = await makeApplication(db, person, season.id, jst('2025-11-05T10:00:00'))
    const h1 = await addHistory(db, {
      applicationId: app, type: 'advance', stepId: season.stepIds[0],
      staffId: base.staffId, occurredAt: jst('2025-11-10T10:00:00'),
    })
    await assert.rejects(
      () => db.query(
        `UPDATE status_histories SET corrects_history_id = id, is_correction = true WHERE id = $1`,
        [h1],
      ),
      /no_self_correction|append-only|更新できない/,
    )
    await db.close()
  })

  test('訂正の循環は作れない（作れると両方が集計から静かに消える）', async () => {
    // h1 が h2 を訂正し、h2 が h1 を訂正する状態を作ると、
    // どちらも「誰にも訂正されていない行」にならないため再帰の基底に現れず、
    // チェーンごと有効判定から脱落する。落ちるより悪い、静かに消える壊れ方。
    const db = await freshDb()
    const base = await baseFixture(db)
    const season = await makeSeason(db, { year: 2026 })
    const person = await makePerson(db, base.schoolId)
    const app = await makeApplication(db, person, season.id, jst('2025-11-05T10:00:00'))

    const h1 = await addHistory(db, {
      applicationId: app, type: 'advance', stepId: season.stepIds[0],
      staffId: base.staffId, occurredAt: jst('2025-11-10T10:00:00'),
    })
    const h2 = await addHistory(db, {
      applicationId: app, type: 'reject', staffId: base.staffId,
      occurredAt: jst('2025-11-11T10:00:00'), correctsHistoryId: h1,
    })

    await assert.rejects(
      () => db.query(
        `UPDATE status_histories SET corrects_history_id = $2, is_correction = true WHERE id = $1`,
        [h1, h2],
      ),
      /append-only|循環|cycle/,
    )
    await db.close()
  })

  test('状態遷移ログは追記のみ。UPDATE も DELETE も拒否される', async () => {
    // 原則5そのもの。訂正は打ち消し行の追記で表現し、元の行は不変。
    const db = await freshDb()
    const base = await baseFixture(db)
    const season = await makeSeason(db, { year: 2026 })
    const person = await makePerson(db, base.schoolId)
    const app = await makeApplication(db, person, season.id, jst('2025-11-05T10:00:00'))
    const h1 = await addHistory(db, {
      applicationId: app, type: 'advance', stepId: season.stepIds[0],
      staffId: base.staffId, occurredAt: jst('2025-11-10T10:00:00'),
    })

    await assert.rejects(
      () => db.query(`UPDATE status_histories SET note = 'あとから書き換え' WHERE id = $1`, [h1]),
      /append-only/,
    )
    await assert.rejects(
      () => db.query(`DELETE FROM status_histories WHERE id = $1`, [h1]),
      /append-only/,
    )
    await db.close()
  })

  test('corrects_history_id を持つのに is_correction が false の行は作れない', async () => {
    // v_effective_status_histories は corrects_history_id しか見ないため、
    // 食い違うとフラグの方が嘘になる。
    const db = await freshDb()
    const base = await baseFixture(db)
    const season = await makeSeason(db, { year: 2026 })
    const person = await makePerson(db, base.schoolId)
    const app = await makeApplication(db, person, season.id, jst('2025-11-05T10:00:00'))
    const h1 = await addHistory(db, {
      applicationId: app, type: 'advance', stepId: season.stepIds[0],
      staffId: base.staffId, occurredAt: jst('2025-11-10T10:00:00'),
    })
    await assert.rejects(
      () => db.query(
        `INSERT INTO status_histories
           (application_id, transition_type, occurred_at, changed_by_staff_id,
            is_correction, corrects_history_id)
         VALUES ($1, 'reject', $2, $3, false, $4)`,
        [app, jst('2025-11-12T10:00:00'), base.staffId, h1],
      ),
      /correction_pair_reverse/,
    )
    await db.close()
  })
})

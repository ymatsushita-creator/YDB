import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { all, type Db } from '../src/db/client.ts'
import {
  baseFixture, makeSeason, makePerson, makeApplication, addHistory,
  makeChannel, makeTouchpoint, makeVoidReason, voidApplication, jst,
} from './support/fixtures.ts'

/**
 * 0005 の書き直し（EXISTS → bool_or 付き集約）が、置き換える前と
 * 同じ結果を返すことを確かめる。
 *
 * 参照実装は 0002 の定義、つまり相関 EXISTS 版。原典 basic/ の
 * v_application_state / v_person_lifetime_summary から、A-2
 * （v_countable_applications）と C-1（v_final_selection_step）だけを
 * 差し替えた形にあたる。0005 が変えたのは EXISTS の書き方だけなので、
 * 突き合わせるべき相手はこれで正しい。
 *
 * 0004 には 07 があるのに 0005 には無い、という穴を塞ぐためのファイル。
 */
const REFERENCE = `
CREATE VIEW v_application_state_ref AS
SELECT
    a.id AS application_id, a.person_id, a.season_id, a.submitted_at,
    a.is_reapplication,
    (a.voided_at IS NOT NULL) AS is_voided,
    EXISTS (
        SELECT 1 FROM v_effective_status_histories sh
          JOIN v_final_selection_step fs ON fs.season_id = a.season_id
         WHERE sh.application_id = a.id
           AND sh.transition_type = 'advance'
           AND sh.selection_step_id = fs.selection_step_id) AS is_accepted,
    EXISTS (
        SELECT 1 FROM v_effective_status_histories sh
         WHERE sh.application_id = a.id AND sh.transition_type = 'reject') AS is_rejected,
    EXISTS (
        SELECT 1 FROM v_effective_status_histories sh
         WHERE sh.application_id = a.id AND sh.transition_type = 'withdraw') AS is_withdrawn
  FROM v_countable_applications a;

CREATE VIEW v_person_lifetime_summary_ref AS
SELECT
    p.id AS person_id,
    p.created_at AS identified_at,
    (SELECT max(t.occurred_at) FROM touchpoints t WHERE t.person_id = p.id) AS last_touch_at,
    EXISTS (SELECT 1 FROM v_application_state_ref s WHERE s.person_id = p.id)
        AS has_ever_applied,
    EXISTS (SELECT 1 FROM v_application_state_ref s
             WHERE s.person_id = p.id AND s.is_accepted) AS has_ever_been_accepted,
    (SELECT count(*) FROM v_application_state_ref s WHERE s.person_id = p.id)
        AS application_count
  FROM persons p
 WHERE p.deleted_at IS NULL;
`

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pad = (n: number) => String(n).padStart(2, '0')

/** ステップ0本の年度、遷移0件の応募、訂正、無効化、削除を混ぜる。 */
async function build(db: Db, seed: number) {
  const rand = rng(seed)
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))
  const base = await baseFixture(db)

  const withSteps = await makeSeason(db, { year: 2026 })
  // ステップが1本も無い年度。v_final_selection_step が行を返さない。
  const noSteps = await makeSeason(db, { year: 2027, steps: [] })
  const ch = await makeChannel(db, 'イベント')
  const vc = await makeVoidReason(db, 'withdrawn_before_screening', true)
  const vn = await makeVoidReason(db, 'identity_merge_error', false)

  const people: string[] = []
  for (let i = 0; i < 50; i++) {
    const p = await makePerson(db, base.schoolId, {
      createdAt: jst(`2025-${pad(int(9, 12))}-${pad(int(1, 28))}T10:00:00`),
    })
    people.push(p)
    for (let k = 0; k < int(0, 2); k++) {
      await makeTouchpoint(db, p, ch, jst(`2025-${pad(int(9, 12))}-${pad(int(1, 28))}T12:00:00`))
    }
  }

  for (const season of [withSteps, noSteps]) {
    for (const person of people) {
      if (rand() > 0.6) continue
      const app = await makeApplication(
        db, person, season.id, jst(`2025-11-${pad(int(1, 28))}T09:00:00`))

      if (rand() < 0.15) await voidApplication(db, app, rand() < 0.5 ? vc : vn,
        jst('2025-12-01T10:00:00'))

      const roll = rand()
      if (roll < 0.15) continue   // 遷移0件の応募

      if (season.stepIds.length > 0 && roll < 0.45) {
        const h = await addHistory(db, {
          applicationId: app, type: 'advance', stepId: season.finalStepId,
          staffId: base.staffId, occurredAt: jst(`2025-12-${pad(int(1, 20))}T10:00:00`),
        })
        if (rand() < 0.3) {
          const c = await addHistory(db, {
            applicationId: app, type: 'reject', staffId: base.staffId,
            occurredAt: jst('2025-12-22T10:00:00'), correctsHistoryId: h,
          })
          if (rand() < 0.5) {
            await addHistory(db, {
              applicationId: app, type: 'advance', stepId: season.finalStepId,
              staffId: base.staffId, occurredAt: jst('2025-12-24T10:00:00'),
              correctsHistoryId: c,
            })
          }
        }
      } else if (roll < 0.7) {
        await addHistory(db, {
          applicationId: app, type: 'reject', staffId: base.staffId,
          occurredAt: jst(`2025-12-${pad(int(1, 28))}T10:00:00`),
        })
      } else if (roll < 0.85) {
        await addHistory(db, {
          applicationId: app, type: 'withdraw', staffId: base.staffId,
          occurredAt: jst(`2025-12-${pad(int(1, 28))}T10:00:00`),
        })
      } else if (season.stepIds.length > 0) {
        // selection_step_id が NULL の advance。ステップ未指定の到達。
        await addHistory(db, {
          applicationId: app, type: 'advance', staffId: base.staffId,
          occurredAt: jst('2025-12-05T10:00:00'),
        })
      }
    }
  }

  await db.query(`UPDATE persons SET deleted_at = now() WHERE id = ANY($1::uuid[])`,
    [people.slice(0, 3)])
}

describe('状態ビューの書き直しは元と同じ結果を返す', () => {
  for (const seed of [3, 11, 29]) {
    test(`ランダムデータ seed=${seed} で全行が一致する`, async () => {
      const db = await freshDb()
      await db.exec(REFERENCE)
      await build(db, seed)

      const actual = await all(db,
        `SELECT * FROM v_application_state ORDER BY application_id`)
      const expected = await all(db,
        `SELECT * FROM v_application_state_ref ORDER BY application_id`)
      assert.ok(actual.length > 20, '突き合わせる行が十分にある')
      assert.deepEqual(
        JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)),
        'v_application_state',
      )

      const lifeActual = await all(db,
        `SELECT * FROM v_person_lifetime_summary ORDER BY person_id`)
      const lifeExpected = await all(db,
        `SELECT * FROM v_person_lifetime_summary_ref ORDER BY person_id`)
      assert.deepEqual(
        JSON.parse(JSON.stringify(lifeActual)), JSON.parse(JSON.stringify(lifeExpected)),
        'v_person_lifetime_summary',
      )
      await db.close()
    })
  }

  test('ステップが1本も無い年度でも落ちず、幹は0になる', async () => {
    const db = await freshDb()
    const base = await baseFixture(db)
    const season = await makeSeason(db, { year: 2026, steps: [] })
    const app = await makeApplication(
      db, await makePerson(db, base.schoolId), season.id, jst('2025-11-10T09:00:00'))
    await addHistory(db, {
      applicationId: app, type: 'advance', staffId: base.staffId,
      occurredAt: jst('2025-12-01T10:00:00'),
    })
    const rows = await all<{ is_accepted: boolean }>(
      db, `SELECT is_accepted FROM v_application_state`)
    assert.deepEqual(rows, [{ is_accepted: false }])
    await db.close()
  })
})

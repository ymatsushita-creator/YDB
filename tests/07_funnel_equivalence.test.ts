import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { all, scalar, type Db } from '../src/db/client.ts'
import {
  baseFixture, makeSeason, makePerson, makeApplication, addHistory,
  makeChannel, makeTouchpoint, makeVoidReason, voidApplication, jst,
} from './support/fixtures.ts'

/**
 * 書き直した f_funnel_daily が、原典の定義と同じ数字を返すことを確かめる。
 *
 * 性能のための書き直しは、速くなったかどうかは測れば分かるが、
 * 同じ答えを返しているかどうかは測っても分からない。
 * 原典の素朴な実装を参照として残し、1行ずつ突き合わせる。
 *
 * 参照実装は 0002 の定義そのまま（相関副問い合わせ版）。
 * 遅いのは承知のうえで、遅いほうが読んで正しさを確認しやすい。
 */
const REFERENCE_FUNCTION = `
CREATE FUNCTION f_funnel_reference(active_window_days integer)
RETURNS TABLE (
    season_id uuid, as_of date, relative_day integer,
    identified_person_cum bigint, applicant_cum bigint, accepted_cum bigint,
    net_accepted_cum bigint, rejected_cum bigint, withdrawn_cum bigint
) AS $fn$
    SELECT
        s.id,
        d.day,
        (d.day - s.application_open_date)::integer,

        (SELECT count(*) FROM persons p
          WHERE p.deleted_at IS NULL
            AND jst_date(p.created_at) <= d.day
            AND EXISTS (
                    SELECT 1 FROM touchpoints t
                     WHERE t.person_id = p.id
                       AND jst_date(t.occurred_at) <= d.day
                       AND jst_date(t.occurred_at) > d.day - guard.w
                )),

        (SELECT count(*) FROM v_application_state a
          WHERE a.season_id = s.id AND jst_date(a.submitted_at) <= d.day),

        (SELECT count(DISTINCT sh.application_id)
           FROM v_effective_status_histories sh
           JOIN v_countable_applications a ON a.id = sh.application_id
           JOIN v_final_selection_step fs  ON fs.season_id = a.season_id
          WHERE a.season_id = s.id
            AND sh.transition_type = 'advance'
            AND sh.selection_step_id = fs.selection_step_id
            AND jst_date(sh.occurred_at) <= d.day),

        (SELECT count(DISTINCT sh.application_id)
           FROM v_effective_status_histories sh
           JOIN v_countable_applications a ON a.id = sh.application_id
           JOIN v_final_selection_step fs  ON fs.season_id = a.season_id
          WHERE a.season_id = s.id
            AND sh.transition_type = 'advance'
            AND sh.selection_step_id = fs.selection_step_id
            AND jst_date(sh.occurred_at) <= d.day
            AND NOT EXISTS (
                    SELECT 1 FROM v_effective_status_histories w
                     WHERE w.application_id = sh.application_id
                       AND w.transition_type = 'withdraw'
                       AND jst_date(w.occurred_at) <= d.day)),

        (SELECT count(DISTINCT sh.application_id)
           FROM v_effective_status_histories sh
           JOIN v_countable_applications a ON a.id = sh.application_id
          WHERE a.season_id = s.id AND sh.transition_type = 'reject'
            AND jst_date(sh.occurred_at) <= d.day),

        (SELECT count(DISTINCT sh.application_id)
           FROM v_effective_status_histories sh
           JOIN v_countable_applications a ON a.id = sh.application_id
          WHERE a.season_id = s.id AND sh.transition_type = 'withdraw'
            AND jst_date(sh.occurred_at) <= d.day)

      FROM (SELECT require_positive(
                       f_funnel_reference.active_window_days, 'active_window_days') AS w) guard
     CROSS JOIN seasons s
     CROSS JOIN LATERAL generate_series(
         s.application_open_date::timestamp, s.selection_end_date::timestamp, interval '1 day'
     ) AS g(ts)
     CROSS JOIN LATERAL (SELECT g.ts::date) AS d(day);
$fn$ LANGUAGE sql STABLE;
`

/** mulberry32。テスト内でも乱数は固定シードにする。 */
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

/**
 * 意地の悪いデータを作る。正常系だけでは、書き直しで壊れる箇所が
 * ちょうど例外的なケースに集まるため意味がない。
 */
async function buildAwkwardDataset(db: Db, seed: number) {
  const rand = rng(seed)
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))
  const base = await baseFixture(db)

  // 期間が重なる2年度。年度をまたぐ集計のずれを出させる。
  const s1 = await makeSeason(db, {
    year: 2025, outreachStart: '2024-09-01', applicationOpen: '2024-11-01',
    applicationClose: '2024-12-10', selectionEnd: '2025-01-20',
  })
  const s2 = await makeSeason(db, {
    year: 2026, outreachStart: '2024-12-01', applicationOpen: '2025-01-05',
    applicationClose: '2025-02-10', selectionEnd: '2025-03-15',
  })
  const seasons = [s1, s2]

  const ch = await makeChannel(db, 'イベント')
  const voidCounts = await makeVoidReason(db, 'withdrawn_before_screening', true)
  const voidNotCounts = await makeVoidReason(db, 'identity_merge_error', false)

  const people: string[] = []
  for (let i = 0; i < 80; i++) {
    const m = int(9, 12)
    const createdAt = jst(`2024-${pad(m)}-${pad(int(1, 28))}T${pad(int(0, 23))}:${pad(int(0, 59))}:00`)
    const p = await makePerson(db, base.schoolId, { createdAt })
    people.push(p)

    // 接点は0〜3件。0件の人は林に入らない。
    for (let k = 0; k < int(0, 3); k++) {
      const mm = int(9, 12)
      await makeTouchpoint(db, p, ch, jst(`2024-${pad(mm)}-${pad(int(1, 28))}T${pad(int(0, 23))}:00:00`))
    }
    // 識別より前の接点はありえないが、境界の扱いを揃えるため一部で作る。
    if (rand() < 0.1) {
      await makeTouchpoint(db, p, ch, jst(`2024-08-${pad(int(1, 28))}T12:00:00`))
    }
  }

  for (const season of seasons) {
    const openMonth = season.year === 2025 ? 11 : 1
    const openYear = season.year === 2025 ? 2024 : 2025

    for (const person of people) {
      if (rand() > 0.5) continue
      const submittedAt = jst(
        `${openYear}-${pad(openMonth)}-${pad(int(1, 28))}T${pad(int(0, 23))}:00:00`)
      const app = await makeApplication(db, person, season.id, submittedAt)

      // 無効化。counts_as_application の両方を混ぜる。
      if (rand() < 0.12) {
        await voidApplication(db, app, rand() < 0.5 ? voidCounts : voidNotCounts,
          jst(`${openYear}-${pad(openMonth)}-28T10:00:00`))
      }

      const evtMonth = season.year === 2025 ? 12 : 2
      const evtYear = season.year === 2025 ? 2024 : 2025
      const evtAt = (d: number) => jst(`${evtYear}-${pad(evtMonth)}-${pad(Math.min(d, 28))}T10:00:00`)

      const roll = rand()
      if (roll < 0.25) {
        // 合格
        const h = await addHistory(db, {
          applicationId: app, type: 'advance', stepId: season.finalStepId,
          staffId: base.staffId, occurredAt: evtAt(int(1, 20)),
        })
        // 一部は辞退。合格より前に辞退する異常系も混ぜる。
        if (rand() < 0.3) {
          await addHistory(db, {
            applicationId: app, type: 'withdraw', staffId: base.staffId,
            occurredAt: evtAt(rand() < 0.2 ? 1 : int(21, 28)),
          })
        }
        // 一部は合格を訂正で取り消し、さらにその一部は訂正を訂正して戻す。
        if (rand() < 0.25) {
          const c1 = await addHistory(db, {
            applicationId: app, type: 'reject', staffId: base.staffId,
            occurredAt: evtAt(int(21, 26)), correctsHistoryId: h,
          })
          if (rand() < 0.5) {
            await addHistory(db, {
              applicationId: app, type: 'advance', stepId: season.finalStepId,
              staffId: base.staffId, occurredAt: evtAt(27), correctsHistoryId: c1,
            })
          }
        }
      } else if (roll < 0.6) {
        await addHistory(db, {
          applicationId: app, type: 'reject', staffId: base.staffId,
          occurredAt: evtAt(int(1, 28)),
        })
      } else if (roll < 0.7) {
        // 中間ステップまで進んで止まる。幹には数えない。
        await addHistory(db, {
          applicationId: app, type: 'advance', stepId: season.stepIds[0],
          staffId: base.staffId, occurredAt: evtAt(int(1, 15)),
        })
      } else if (roll < 0.78) {
        // 合格したあと差し戻し。到達した事実は消えない。
        await addHistory(db, {
          applicationId: app, type: 'advance', stepId: season.finalStepId,
          staffId: base.staffId, occurredAt: evtAt(int(1, 10)),
        })
        await addHistory(db, {
          applicationId: app, type: 'revert', stepId: season.stepIds[1],
          staffId: base.staffId, occurredAt: evtAt(int(11, 20)),
        })
      } else if (roll < 0.84) {
        // 選考終了より後に起きた出来事。年度の系列に載る日がない。
        await addHistory(db, {
          applicationId: app, type: 'reject', staffId: base.staffId,
          occurredAt: jst('2025-06-01T10:00:00'),
        })
      }
    }
  }

  // 個人情報削除。集計から完全に外れる。
  await db.query(
    `UPDATE persons SET deleted_at = now() WHERE id = ANY($1::uuid[])`, [people.slice(0, 4)])

  return seasons
}

describe('書き直したファネルは原典と同じ数字を返す', () => {
  for (const seed of [1, 7, 42]) {
    test(`ランダムデータ seed=${seed} で全行が一致する`, async () => {
      const db = await freshDb()
      await db.exec(REFERENCE_FUNCTION)
      await buildAwkwardDataset(db, seed)

      for (const window of [14, 90]) {
        const actual = await all<Record<string, unknown>>(
          db, `SELECT * FROM f_funnel_daily($1) ORDER BY season_id, as_of`, [window])
        const expected = await all<Record<string, unknown>>(
          db, `SELECT * FROM f_funnel_reference($1) ORDER BY season_id, as_of`, [window])

        assert.ok(actual.length > 100, '突き合わせる行が十分にある')
        assert.equal(actual.length, expected.length, `窓=${window}日 の行数`)

        for (const [i, row] of actual.entries()) {
          assert.deepEqual(
            JSON.parse(JSON.stringify(row)),
            JSON.parse(JSON.stringify(expected[i])),
            `窓=${window}日 の ${i} 行目（${String(row.as_of)}）が食い違う`,
          )
        }
      }
      await db.close()
    })
  }

  test('林の区間まとめが、接点の数に影響されない', async () => {
    // 同じ日に接点が10件あっても、その人は1人として数える。
    // 区間へ畳む書き直しで壊れるならここに出る。
    const db = await freshDb()
    await db.exec(REFERENCE_FUNCTION)
    const base = await baseFixture(db)
    const season = await makeSeason(db, {
      year: 2026, applicationOpen: '2025-11-01', applicationClose: '2025-12-15',
      selectionEnd: '2025-12-31',
    })
    const ch = await makeChannel(db, 'イベント')
    const p = await makePerson(db, base.schoolId, { createdAt: jst('2025-10-01T10:00:00') })
    for (let i = 0; i < 10; i++) {
      await makeTouchpoint(db, p, ch, jst(`2025-11-05T${String(i + 8).padStart(2, '0')}:00:00`))
    }

    const n = await scalar<string>(
      db, `SELECT identified_person_cum FROM f_funnel_daily(30)
            WHERE season_id = $1 AND as_of = '2025-11-10'::date`, [season.id])
    assert.equal(Number(n), 1)

    const ref = await scalar<string>(
      db, `SELECT identified_person_cum FROM f_funnel_reference(30)
            WHERE season_id = $1 AND as_of = '2025-11-10'::date`, [season.id])
    assert.equal(Number(n), Number(ref))
    await db.close()
  })

  test('GREATEST は NULL を無視するという罠を踏んでいない', async () => {
    // 節目に到達していないことを表す NULL を greatest() に通すと、
    // NULL が消えて応募開始日に化ける。全応募が初日に合格したことになる。
    // 書き直しの過程で実際に踏んだので、性質そのものをテストに残す。
    const db = await freshDb()
    const g = await scalar<Date | null>(db, `SELECT greatest(NULL::date, '2025-11-01'::date)`)
    assert.notEqual(g, null, 'greatest は NULL を伝播しない（PostgreSQL の仕様）')

    const base = await baseFixture(db)
    const season = await makeSeason(db, {
      year: 2026, applicationOpen: '2025-11-01', applicationClose: '2025-12-15',
      selectionEnd: '2025-12-31',
    })
    // 何の遷移も起きていない応募。合格・不合格・辞退のいずれでもない。
    await makeApplication(
      db, await makePerson(db, base.schoolId), season.id, jst('2025-11-10T09:00:00'))

    const row = await all<Record<string, string>>(
      db, `SELECT accepted_cum, rejected_cum, withdrawn_cum FROM f_funnel_daily(30)
            WHERE season_id = $1 AND as_of = '2025-12-31'::date`, [season.id])
    assert.deepEqual(
      Object.values(row[0]!).map(Number), [0, 0, 0],
      '遷移のない応募は、どの節目にも到達していない',
    )
    await db.close()
  })
})

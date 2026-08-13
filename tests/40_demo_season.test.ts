import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { maybeOne, scalar, all, type Db } from '../src/db/client.ts'
import {
  baseFixture, makeSeason, makePerson, makeChannel, makeTouchpoint, jst,
} from './support/fixtures.ts'
import { listSeasons, defaultSeason, isDemoSeason } from '../src/queries/dashboard.ts'
import { seasonLabel, backHref } from '../app/_components/labels.ts'
import { seedDemoSeason } from '../src/seed/demo_season.ts'

/**
 * 幻のデモ期（実行⑪。依頼者の指示）。
 *
 * 固定したいのは5つ ――
 *   ① 架空の人は**実在の期に1行も現れない**（帰属・応募・アプローチ）
 *   ② 日付が重なっても混ざらない。**窓の置き方に安全性を依存させない**
 *   ③ ファネルの林にも混ざらない（ここは年度で絞っていない場所）
 *   ④ デモ期は**既定にならない**。名前は「デモ期」としか出ない
 *   ⑤ 2回流しても増えない
 */

describe('デモ期の境界', () => {
  let db: Db
  let schoolId: string
  let staffId: string
  let channelId: string
  let realSeasonId: string
  let demoSeasonId: string
  let realPerson: string
  let demoPerson: string

  before(async () => {
    db = await freshDb()
    const base = await baseFixture(db)
    schoolId = base.schoolId
    staffId = base.staffId
    channelId = await makeChannel(db, 'イベント')

    // 実在の期とデモ期の窓を**わざと重ねる**。
    const real = await makeSeason(db, {
      year: 2026,
      outreachStart: '2026-01-01', applicationOpen: '2026-02-01',
      applicationClose: '2026-03-01', selectionEnd: '2026-12-31',
    })
    realSeasonId = real.id

    demoSeasonId = await scalar<string>(db, `
      INSERT INTO seasons
        (enrollment_year, outreach_start_date, application_open_date,
         application_close_date, selection_end_date, is_demo)
      VALUES (9999, DATE '2026-01-01', DATE '2026-02-01',
              DATE '2026-03-01', DATE '2026-12-31', true)
      RETURNING id`)

    realPerson = await makePerson(db, schoolId, { createdAt: jst('2026-01-05T09:00:00') })
    demoPerson = await scalar<string>(db, `
      INSERT INTO persons (family_name, given_name, birth_date, school_id, email,
                           created_at, is_demo)
      VALUES ('デモ', '候補者01', DATE '2005-01-01', $1, 'demo01@demo.invalid',
              TIMESTAMPTZ '2026-01-05 09:00+09', true)
      RETURNING id`, [schoolId])
  })

  after(async () => { await db.close() })

  // ① ②
  test('★ 日付が重なっていても、架空の接点は実在の期に帰属しない', async () => {
    await makeTouchpoint(db, realPerson, channelId, jst('2026-02-10T10:00:00'))
    await makeTouchpoint(db, demoPerson, channelId, jst('2026-02-10T10:00:00'))

    const rows = await all<{ person_id: string; season_id: string | null }>(db, `
      SELECT person_id, season_id FROM v_touchpoint_season ORDER BY person_id`)
    const real = rows.find((r) => r.person_id === realPerson)
    const demo = rows.find((r) => r.person_id === demoPerson)

    assert.equal(real?.season_id, realSeasonId, '実在の人は実在の期へ')
    assert.equal(demo?.season_id, demoSeasonId, '架空の人は架空の期へ')
  })

  test('★ 世界をまたぐ行は作れない（応募・アプローチ・番号）', async () => {
    await assert.rejects(
      db.query(`INSERT INTO applications (person_id, season_id, submitted_at)
                VALUES ($1, $2, now())`, [demoPerson, realSeasonId]),
      /デモ期と実在の期をまたぐ/, '架空の人 × 実在の期')

    await assert.rejects(
      db.query(`INSERT INTO applications (person_id, season_id, submitted_at)
                VALUES ($1, $2, now())`, [realPerson, demoSeasonId]),
      /デモ期と実在の期をまたぐ/, '実在の人 × デモ期')

    await assert.rejects(
      db.query(`
        INSERT INTO approach_events
          (person_id, season_id, approach_state_id, occurred_at, recorded_by_staff_id)
        SELECT $1, $2, s.id, now(), $3 FROM approach_states s LIMIT 1`,
      [demoPerson, realSeasonId, staffId]),
      /デモ期と実在の期をまたぐ/, 'アプローチの出来事')

    await assert.rejects(
      db.query(`INSERT INTO candidate_numbers (season_id, person_id, number)
                VALUES ($1, $2, 1)`, [realSeasonId, demoPerson]),
      /デモ期と実在の期をまたぐ/, '候補者番号')
  })

  // ③
  test('★★ ファネルの林にも混ざらない', async () => {
    // 林は「直近に接点がある人」を数える。**年度で絞っていない**ので、
    // ここだけは日付を離しても守れない（0029 の3節）。
    // 窓（90日）の内側の日で見る。最終日（12/31）では両方とも 0 になり、
    // **混ざっていても気づけない。**
    const groveOf = async (seasonId: string) => {
      const row = await maybeOne<{ n: string }>(db, `
        SELECT identified_person_cum AS n FROM f_funnel_daily(90)
         WHERE season_id = $1 AND as_of = DATE '2026-02-15'`, [seasonId])
      return Number(row?.n ?? 0)
    }

    assert.equal(await groveOf(realSeasonId), 1, '実在の期には実在の1人だけ')
    assert.equal(await groveOf(demoSeasonId), 1, 'デモ期には架空の1人だけ')

    // 架空の人を増やしても、実在の期の林は動かない。
    for (let i = 2; i <= 4; i += 1) {
      const p = await scalar<string>(db, `
        INSERT INTO persons (family_name, given_name, birth_date, school_id, email,
                             created_at, is_demo)
        VALUES ('デモ', $1, DATE '2005-01-01', $2, $3,
                TIMESTAMPTZ '2026-01-05 09:00+09', true)
        RETURNING id`, [`候補者0${i}`, schoolId, `demo0${i}@demo.invalid`])
      await makeTouchpoint(db, p, channelId, jst('2026-02-10T10:00:00'))
    }

    assert.equal(await groveOf(realSeasonId), 1, '★ 架空の人が実在の林を押し上げない')
    assert.equal(await groveOf(demoSeasonId), 4, 'デモ期の林だけが増える')
  })

  // ④
  test('★ デモ期は画面の期一覧に出ず、既定にもならない', async () => {
    const seasons = await listSeasons(db)
    assert.equal(seasons.some((s) => s.is_demo), false, '一覧に出さない')
    assert.equal(defaultSeason(seasons)?.id, realSeasonId)
    assert.equal(defaultSeason(seasons)?.is_demo, false)
  })

  test('デモ期しか無ければ、最後の手段としてデモ期を返す', () => {
    const only = [{ id: 'x', is_demo: true, is_live: false }] as never
    assert.equal((defaultSeason(only) as { id: string }).id, 'x')
  })

  test('★ 呼び名は「デモ期」。年（9999）を出さない', () => {
    assert.equal(seasonLabel({ cohort_number: null, enrollment_year: 9999, is_demo: true }),
      'デモ期')
    assert.equal(seasonLabel({ cohort_number: 2, enrollment_year: 2026 }), '2期')
    assert.equal(seasonLabel({ cohort_number: null, enrollment_year: 2026 }), '2026年度')
  })

  test('画面の札の判定は ID だけで決まる', async () => {
    assert.equal(await isDemoSeason(db, demoSeasonId), true)
    assert.equal(await isDemoSeason(db, realSeasonId), false)
    assert.equal(await isDemoSeason(db, 'こわれたID'), false)
  })
})

// ⑤
describe('デモ期の作り直し', () => {
  test('★ 2回流しても増えない（試した記録を消さない）', async () => {
    const db = await freshDb({ seeds: 'production' })
    const first = await seedDemoSeason(db, { asOf: '2026-08-10' })
    assert.equal(first.created, true)
    assert.ok(first.persons > 0)

    const second = await seedDemoSeason(db, { asOf: '2026-08-10' })
    assert.equal(second.created, false)
    assert.equal(second.seasonId, first.seasonId)

    assert.equal(await scalar<number>(db,
      `SELECT count(*)::int FROM persons WHERE is_demo`), first.persons)
    // 実在の期（本番シードの2期・3期）には1人も入れていない。
    assert.equal(await scalar<number>(db, `
      SELECT count(*)::int FROM applications a
        JOIN persons p ON p.id = a.person_id
        JOIN seasons s ON s.id = a.season_id
       WHERE NOT s.is_demo AND p.is_demo`), 0)
    await db.close()
  })
})

describe('戻る（実行⑪）', () => {
  test('★ 行き先は「現在地の1つ上で、押せる段」', () => {
    assert.equal(backHref([
      { label: '2期' },
      { label: '個人アプローチ', href: '/borderline?season=x' },
      { label: '木村 湊' },
    ]), '/borderline?season=x')
  })

  test('押せない段は飛ばして、さらに上を探す', () => {
    // 層で押せなくした段（`canOpen`）は href を落としてある。
    assert.equal(backHref([
      { label: '2期', href: '/a' },
      { label: 'ヘッドハンティング' },
      { label: '候補者追加' },
    ]), '/a')
  })

  test('★ 戻る先が無ければ null（押しても何も起きないボタンを出さない）', () => {
    assert.equal(backHref([{ label: '2期' }, { label: '個人アプローチ' }]), null)
    assert.equal(backHref([{ label: '個人アプローチ', href: '/borderline' }]), null,
      '現在地しか無い画面では、その href は戻る先ではない')
    assert.equal(backHref([]), null)
  })
})

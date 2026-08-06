import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { all, one, scalar, type Db } from '../src/db/client.ts'
import {
  baseFixture, makeSeason, makePerson, makeChannel, makeTouchpoint, jst,
} from './support/fixtures.ts'
import {
  getPartnerReach, getReachTotals, getChannelAttribution, getUnattributedTouchpoints,
} from '../src/queries/dashboard.ts'

/**
 * 森（partner_reaches）の集計。
 *
 * この関数は実装から一度も呼ばれていなかったため、引数ガード以外の
 * テストが無かった。画面に出す前に、何を数えているのかを固定する。
 *
 * 森は他の段と単位が違う。estimated_reach_total は推定値、
 * identified_count は実人数。同じ軸に並べないという判断は、
 * 数え方が違うことを前提にしている。
 */

const setup = async () => {
  const db = await freshDb()
  const base = await baseFixture(db)
  const season = await makeSeason(db, {
    year: 2026, outreachStart: '2025-09-01', applicationOpen: '2025-11-01',
    applicationClose: '2025-12-15', selectionEnd: '2026-02-28',
  })
  const channel = await makeChannel(db, '提携団体イベント')
  const partner = async (name: string) =>
    scalar<string>(db, `INSERT INTO partners (name) VALUES ($1) RETURNING id`, [name])
  const reach = (partnerId: string, on: string, estimated: number, seasonId?: string | null) =>
    db.query(
      `INSERT INTO partner_reaches (partner_id, season_id, occurred_on, estimated_reach)
       VALUES ($1, $2, $3, $4)`,
      [partnerId, seasonId === undefined ? season.id : seasonId, on, estimated],
    )
  return { db, base, season, channel, partner, reach }
}

interface ReachRow {
  partner_id: string
  season_id: string | null
  estimated_reach_total: number
  contact_occasions: number
  first_reach_on: Date
  last_reach_on: Date
  identified_count: number
}

const summary = (db: Db, windowDays = 90) =>
  all<ReachRow>(db, `SELECT * FROM f_partner_reach_summary($1)`, [windowDays])

const ymd = (d: Date) => d.toISOString().slice(0, 10)

describe('森の集計', () => {
  test('推定リーチは合計、接触機会は行数、期間は最初と最後', async () => {
    const { db, partner, reach } = await setup()
    const a = await partner('NPO あお')
    await reach(a, '2025-09-10', 100)
    await reach(a, '2025-09-20', 50)
    await reach(a, '2025-10-01', 30)

    const [row] = await summary(db)
    assert.equal(Number(row!.estimated_reach_total), 180)
    assert.equal(Number(row!.contact_occasions), 3)
    assert.equal(ymd(row!.first_reach_on), '2025-09-10')
    assert.equal(ymd(row!.last_reach_on), '2025-10-01')
    await db.close()
  })

  test('identified_count は実人数。同じ人の複数接点は1と数える', async () => {
    // 推定リーチは接触機会の合計、identified_count は人。
    // ここを行数で数えると、接点をよく残す団体ほど成果が大きく見える。
    const { db, base, partner, reach, channel } = await setup()
    const a = await partner('NPO あお')
    await reach(a, '2025-09-10', 100)

    const p = await makePerson(db, base.schoolId, { createdAt: jst('2025-09-11T10:00:00') })
    await makeTouchpoint(db, p, channel, jst('2025-09-11T10:00:00'), a)
    await makeTouchpoint(db, p, channel, jst('2025-09-25T10:00:00'), a)

    const [row] = await summary(db)
    assert.equal(Number(row!.identified_count), 1)
    await db.close()
  })

  test('観測窓は最初のリーチから最後のリーチ + N 日', async () => {
    const { db, base, partner, reach, channel } = await setup()
    const a = await partner('NPO あお')
    await reach(a, '2025-09-10', 100)
    await reach(a, '2025-09-20', 100)

    const before = await makePerson(db, base.schoolId, { createdAt: jst('2025-09-01T10:00:00') })
    const inside = await makePerson(db, base.schoolId, { createdAt: jst('2025-09-15T10:00:00') })
    const edge = await makePerson(db, base.schoolId, { createdAt: jst('2025-10-20T10:00:00') })
    const after = await makePerson(db, base.schoolId, { createdAt: jst('2025-10-21T10:00:00') })
    await makeTouchpoint(db, before, channel, jst('2025-09-09T10:00:00'), a)
    await makeTouchpoint(db, inside, channel, jst('2025-09-15T10:00:00'), a)
    // 窓 30 日なら 09-20 + 30 = 10-20 まで。境界日は含む
    await makeTouchpoint(db, edge, channel, jst('2025-10-20T23:00:00'), a)
    await makeTouchpoint(db, after, channel, jst('2025-10-21T00:30:00'), a)

    const [row] = await summary(db, 30)
    assert.equal(Number(row!.identified_count), 2, '最初のリーチより前と、窓の外は数えない')
    await db.close()
  })

  test('窓の境界は JST で判定する', async () => {
    // UTC で判定すると JST 09:00 前の接点が前日に寄り、窓の端で1人ずれる。
    const { db, base, partner, reach, channel } = await setup()
    const a = await partner('NPO あお')
    await reach(a, '2025-09-10', 100)

    const p = await makePerson(db, base.schoolId, { createdAt: jst('2025-09-10T02:00:00') })
    // JST では 09-10（窓の初日）、UTC では 09-09（窓の外）
    await makeTouchpoint(db, p, channel, jst('2025-09-10T02:00:00'), a)

    await db.query(`SET TIME ZONE 'UTC'`)
    const [row] = await summary(db, 30)
    assert.equal(Number(row!.identified_count), 1)
    await db.close()
  })

  test('削除済み Person は数えない', async () => {
    // 個人情報削除の依頼（資料9-2）が森から漏れないこと（DECISIONS E-5）。
    const { db, base, partner, reach, channel } = await setup()
    const a = await partner('NPO あお')
    await reach(a, '2025-09-10', 100)

    const p = await makePerson(db, base.schoolId, { createdAt: jst('2025-09-11T10:00:00') })
    await makeTouchpoint(db, p, channel, jst('2025-09-11T10:00:00'), a)
    await db.query(`UPDATE persons SET deleted_at = now() WHERE id = $1`, [p])

    const [row] = await summary(db)
    assert.equal(Number(row!.identified_count), 0)
    await db.close()
  })

  test('団体をまたいで混ざらない', async () => {
    const { db, base, partner, reach, channel } = await setup()
    const a = await partner('NPO あお')
    const b = await partner('NPO みどり')
    await reach(a, '2025-09-10', 100)
    await reach(b, '2025-09-10', 200)

    const pa = await makePerson(db, base.schoolId, { createdAt: jst('2025-09-11T10:00:00') })
    const pb = await makePerson(db, base.schoolId, { createdAt: jst('2025-09-11T10:00:00') })
    await makeTouchpoint(db, pa, channel, jst('2025-09-11T10:00:00'), a)
    await makeTouchpoint(db, pb, channel, jst('2025-09-12T10:00:00'), b)
    // 団体を経由しない接点は森に立たない
    const solo = await makePerson(db, base.schoolId, { createdAt: jst('2025-09-11T10:00:00') })
    await makeTouchpoint(db, solo, channel, jst('2025-09-11T10:00:00'))

    const rows = await summary(db)
    assert.equal(rows.length, 2)
    for (const r of rows) assert.equal(Number(r.identified_count), 1)
    await db.close()
  })

  test('年度に紐づかないリーチは、どの年度の行にも混ざらない', async () => {
    // partner_reaches.season_id は NULL 可。年度の画面で絞ると
    // これらは一行も出ない。出ないこと自体は正しいが、
    // 存在するのに見えないので画面側で件数を示す（(4)の未割当と同じ扱い）。
    const { db, season, partner, reach } = await setup()
    const a = await partner('NPO あお')
    await reach(a, '2025-09-10', 100)
    await reach(a, '2025-09-11', 10, null)

    const rows = await summary(db)
    assert.equal(rows.length, 2, '年度あり・年度なしで別の行になる')
    const orphan = rows.find((r) => r.season_id === null)!
    assert.equal(Number(orphan.estimated_reach_total), 10)
    const scoped = rows.filter((r) => r.season_id === season.id)
    assert.equal(scoped.length, 1)
    assert.equal(Number(scoped[0]!.estimated_reach_total), 100)
    await db.close()
  })

  test('identified_count は行をまたいで足せない', async () => {
    // 同じ人が2団体から接触されていれば、両方の行で1と数えられる。
    // 年度全体の実人数を出すつもりで合計すると、重複したまま増える。
    // これは欠陥ではなく、団体別の指標としては正しい。合計してはいけない。
    const { db, base, partner, reach, channel } = await setup()
    const a = await partner('NPO あお')
    const b = await partner('NPO みどり')
    await reach(a, '2025-09-10', 100)
    await reach(b, '2025-09-10', 200)

    const p = await makePerson(db, base.schoolId, { createdAt: jst('2025-09-11T10:00:00') })
    await makeTouchpoint(db, p, channel, jst('2025-09-11T10:00:00'), a)
    await makeTouchpoint(db, p, channel, jst('2025-09-12T10:00:00'), b)

    const rows = await summary(db)
    const summed = rows.reduce((n, r) => n + Number(r.identified_count), 0)
    assert.equal(summed, 2, '合計は 2 になるが、実在するのは 1 人')

    const actual = await one<{ n: number }>(db, `
      SELECT count(DISTINCT person_id) AS n FROM f_partner_reach_persons(90)`)
    assert.equal(Number(actual.n), 1)
    await db.close()
  })
})

describe('森の実人数は団体別の集計と一致する', () => {
  /**
   * f_partner_reach_persons は「どの人が数えられているか」を返す。
   * 定義が f_partner_reach_summary と分かれる以上、片方だけ直したときに
   * 気づけるよう、団体×年度ごとの人数が一致することを固定する。
   */
  const compare = async (db: Db, windowDays: number) => {
    const rows = await all<{ partner_id: string; season_id: string | null; a: number; b: number }>(
      db, `
      SELECT s.partner_id, s.season_id,
             s.identified_count AS a,
             (SELECT count(DISTINCT pp.person_id)
                FROM f_partner_reach_persons($1) pp
               WHERE pp.partner_id = s.partner_id
                 AND pp.season_id IS NOT DISTINCT FROM s.season_id) AS b
        FROM f_partner_reach_summary($1) s`, [windowDays])
    assert.ok(rows.length > 0, '比較する行が無い')
    for (const r of rows) assert.equal(Number(r.a), Number(r.b))
  }

  test('団体・年度・窓の組み合わせが変わっても一致する', async () => {
    const { db, base, season, partner, reach, channel } = await setup()
    const a = await partner('NPO あお')
    const b = await partner('NPO みどり')
    await reach(a, '2025-09-10', 100)
    await reach(a, '2025-10-01', 100)
    await reach(b, '2025-09-15', 50)
    await reach(b, '2025-09-16', 50, null)

    for (let i = 0; i < 12; i++) {
      const p = await makePerson(db, base.schoolId, { createdAt: jst('2025-09-01T10:00:00') })
      const day = 5 + i * 7
      const at = new Date(Date.UTC(2025, 8, day, 3, 0, 0)).toISOString()
      await makeTouchpoint(db, p, channel, at, i % 3 === 0 ? a : b)
      if (i % 4 === 0) await db.query(`UPDATE persons SET deleted_at = now() WHERE id = $1`, [p])
    }
    // 年度は使わないが、季節の存在で行が分かれることを確かめるため残す
    assert.ok(season.id)

    for (const w of [1, 7, 30, 90, 365]) await compare(db, w)
    await db.close()
  })
})

// -------------------------------------------------------------
// (4) 流入元の画面が読む問い合わせ
// -------------------------------------------------------------

describe('流入元の画面が読む数', () => {
  test('団体別の行は年度で絞られ、年度全体の実人数は重複排除される', async () => {
    // 同じ人が2団体から接触されている。団体別は両方で1、
    // 年度全体は1。画面で縦に足しても合わないので、
    // 合計は合計として別に数える。
    const { db, base, season, partner, reach, channel } = await setup()
    const a = await partner('NPO あお')
    const b = await partner('NPO みどり')
    await reach(a, '2025-09-10', 100)
    await reach(b, '2025-09-10', 200)
    // 別年度のリーチ。この年度の画面には出ない
    const other = await makeSeason(db, { year: 2027 })
    await reach(a, '2026-09-10', 999, other.id)

    const both = await makePerson(db, base.schoolId, { createdAt: jst('2025-09-11T10:00:00') })
    await makeTouchpoint(db, both, channel, jst('2025-09-11T10:00:00'), a)
    await makeTouchpoint(db, both, channel, jst('2025-09-12T10:00:00'), b)
    const only = await makePerson(db, base.schoolId, { createdAt: jst('2025-09-11T10:00:00') })
    await makeTouchpoint(db, only, channel, jst('2025-09-13T10:00:00'), a)

    const rows = await getPartnerReach(db, season.id)
    assert.deepEqual(
      rows.map((r) => [r.partner_name, Number(r.estimated_reach_total), Number(r.identified_count)]),
      [['NPO みどり', 200, 1], ['NPO あお', 100, 2]],
    )

    const totals = await getReachTotals(db, season.id)
    assert.equal(Number(totals!.estimated_reach_total), 300, '推定リーチは足せる')
    assert.equal(Number(totals!.contact_occasions), 2)
    assert.equal(Number(totals!.partners), 2)
    assert.equal(Number(totals!.identified_persons), 2, '団体別の合計 3 ではなく、実人数 2')
    await db.close()
  })

  test('年度に紐づかないリーチは件数として見えるところに出す', async () => {
    // 年度で絞ると表から消える。消えたことが分かる形で残さないと、
    // 推定リーチの合計が実際より小さいことに誰も気づけない。
    const { db, season, partner, reach } = await setup()
    const a = await partner('NPO あお')
    await reach(a, '2025-09-10', 100)
    await reach(a, '2025-09-11', 40, null)
    await reach(a, '2025-09-12', 10, null)

    const totals = await getReachTotals(db, season.id)
    assert.equal(Number(totals!.estimated_reach_total), 100)
    assert.equal(Number(totals!.season_less_occasions), 2)
    assert.equal(Number(totals!.season_less_reach), 50)
    await db.close()
  })

  test('リーチが1件も無い年度でも0で返る', async () => {
    const { db, season } = await setup()
    const totals = await getReachTotals(db, season.id)
    assert.equal(Number(totals!.contact_occasions), 0)
    assert.equal(Number(totals!.identified_persons), 0)
    assert.equal(Number(totals!.estimated_reach_total), 0, 'NULL ではなく 0')
    assert.deepEqual(await getPartnerReach(db, season.id), [])
    await db.close()
  })

  test('アトリビューション3方式は合計が一致し、内訳だけが違う', async () => {
    // 3方式は同じ実人数を違う配り方で割り当てる。合計が食い違うなら
    // どれかが人を落としているか二重に数えている。
    const { db, base, season, channel } = await setup()
    const event = channel
    const sns = await makeChannel(db, 'SNS')

    // 2つのチャネルに接点を持つ人。初回=イベント、最終=SNS、線形=半々
    const p = await makePerson(db, base.schoolId, { createdAt: jst('2025-09-05T10:00:00') })
    await makeTouchpoint(db, p, event, jst('2025-09-05T10:00:00'))
    await makeTouchpoint(db, p, sns, jst('2025-09-20T10:00:00'))
    // SNS だけの人
    const q = await makePerson(db, base.schoolId, { createdAt: jst('2025-09-06T10:00:00') })
    await makeTouchpoint(db, q, sns, jst('2025-09-06T10:00:00'))
    // 削除済みはどの方式にも出ない
    const gone = await makePerson(db, base.schoolId, { createdAt: jst('2025-09-07T10:00:00') })
    await makeTouchpoint(db, gone, event, jst('2025-09-07T10:00:00'))
    await db.query(`UPDATE persons SET deleted_at = now() WHERE id = $1`, [gone])

    const rows = await getChannelAttribution(db, season.id)
    const byName = Object.fromEntries(rows.map((r) => [r.channel, r]))
    assert.deepEqual(
      [Number(byName['提携団体イベント']!.first_touch), Number(byName['SNS']!.first_touch)],
      [1, 1],
    )
    assert.deepEqual(
      [Number(byName['提携団体イベント']!.last_touch), Number(byName['SNS']!.last_touch)],
      [0, 2],
    )
    assert.deepEqual(
      [Number(byName['提携団体イベント']!.linear), Number(byName['SNS']!.linear)],
      [0.5, 1.5],
    )

    for (const key of ['first_touch', 'last_touch', 'linear'] as const) {
      const total = rows.reduce((n, r) => n + Number(r[key]), 0)
      assert.equal(total, 2, `${key} の合計は実人数と一致する`)
    }
    await db.close()
  })

  test('どの年度にも属さない接点を未割当として数える', async () => {
    const { db, base, channel } = await setup()
    const p = await makePerson(db, base.schoolId, { createdAt: jst('2025-01-01T10:00:00') })
    await makeTouchpoint(db, p, channel, jst('2025-03-01T10:00:00'))  // 年度の範囲外
    await makeTouchpoint(db, p, channel, jst('2025-03-02T10:00:00'))
    await makeTouchpoint(db, p, channel, jst('2025-09-10T10:00:00'))  // 2026年度の範囲内

    const un = await getUnattributedTouchpoints(db)
    assert.equal(Number(un!.touchpoints), 2)
    assert.equal(Number(un!.persons), 1)
    await db.close()
  })
})

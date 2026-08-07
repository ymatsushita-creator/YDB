import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { scalar, type Db } from '../src/db/client.ts'
import {
  baseFixture, makeSeason, makePerson, makeChannel, makeTouchpoint,
  makeApplication, jst, type Fixture, type Season,
} from './support/fixtures.ts'
import {
  getOpenTasks, getTaskTotals, getWaitingPersons, getForests,
  getForest, getCommunities, getForestPersons,
} from '../src/queries/cockpit.ts'

/**
 * コックピットが「5秒で4つの問いに答える」ための問い合わせの検証。
 *
 * 特に見ているのは**件と人を混ぜていないこと**である。
 * 1人が2件のやることを持つ日に「20人が待っている」と出すと、
 * 催促の相手を数え間違える。単位の違うものを同じ数として扱わない。
 */

let db: Db
let fx: Fixture
let season: Season
let channelId: string
let forestId: string
let communityId: string
/** 2件のやることを持つ人。件と人の差を作る。 */
let busyPersonId: string

before(async () => {
  db = await freshDb()
  fx = await baseFixture(db)
  // **終わった年度に置く。** 進行中の年度の期間は今日より後に伸びているため、
  // その中に接点を置くと最終接触日が未来になり、経過日数が負になる。
  // 休眠（最終接触から N 日）はその形では一度も立たない。
  // 「どこに置くかも経路の一部である」（実行④で踏んだ失敗）。
  season = await makeSeason(db, { year: 2026 })
  channelId = await makeChannel(db, '提携団体イベント')

  forestId = await scalar<string>(db,
    `INSERT INTO partners (name, category) VALUES ('検証の森','university') RETURNING id`)
  communityId = await scalar<string>(db,
    `INSERT INTO partners (name, category, parent_partner_id)
     VALUES ('検証の林','community',$1) RETURNING id`, [forestId])

  /**
   * 判断待ちの評価を1件作る。
   *
   * `assignedAt` に null を渡すと now()。期限を超えていないやることを、
   * 実行日に依存せずに作るための逃げ道である。固定の日付で「まだ超過して
   * いない」を作ると、その日付を追い越した日にテストが意味を変える。
   */
  const evaluation = async (
    applicationId: string, stepIndex: number, assignedAt: string | null,
    interviewer: string | null,
  ) => db.query(
    `INSERT INTO evaluations (application_id, selection_step_id, interviewer_staff_id,
                              state, assigned_at)
     VALUES ($1,$2,$3,'pending',coalesce($4::timestamptz, now()))`,
    [applicationId, season.stepIds[stepIndex], interviewer, assignedAt])

  // 1人で2件のやることを持つ人。接点は林に付ける（森へ畳む経路）。
  busyPersonId = await makePerson(db, fx.schoolId, { familyName: '重複', givenName: '待ち' })
  await makeTouchpoint(db, busyPersonId, channelId, jst('2025-10-01T10:00:00'), communityId)
  const busyApp = await makeApplication(db, busyPersonId, season.id, jst('2025-11-01T20:00:00'))
  // 期限を大きく超えたもの（sla_days は 7）と、超えていないもの。
  await evaluation(busyApp, 0, jst('2025-01-05T10:00:00'), fx.staffId)
  await evaluation(busyApp, 1, null, null)

  // 接点が森に直付けの人。やることは1件。
  const calm = await makePerson(db, fx.schoolId, { familyName: '直付', givenName: '一件' })
  await makeTouchpoint(db, calm, channelId, jst('2025-10-02T10:00:00'), forestId)
  const calmApp = await makeApplication(db, calm, season.id, jst('2025-11-03T20:00:00'))
  await evaluation(calmApp, 0, null, fx.staffId)

  // 個人情報削除を受けた人。接点もやることも持つが、どこにも出てはいけない。
  const removed = await makePerson(db, fx.schoolId, { familyName: '削除', givenName: '済' })
  await makeTouchpoint(db, removed, channelId, jst('2025-10-03T10:00:00'), communityId)
  const removedApp = await makeApplication(db, removed, season.id, jst('2025-11-05T20:00:00'))
  await evaluation(removedApp, 0, null, fx.staffId)
  await db.query(`UPDATE persons SET deleted_at = now() WHERE id = $1`, [removed])
})

after(async () => { await db.close() })

describe('いま何をすべきか', () => {
  test('期限を超えたものが先頭に来る', async () => {
    const tasks = await getOpenTasks(db, season.id)
    assert.ok(tasks.length >= 3)
    assert.equal(tasks[0]!.is_overdue, true, '期限超過が先頭でないと、5秒で読めない')
    // 超過が先、その中では待ちの長い順。
    const flags = tasks.map((t) => t.is_overdue)
    assert.deepEqual(flags, [...flags].sort((a, b) => Number(b) - Number(a)))
  })

  test('担当のいないやることは、担当が null で出る', async () => {
    const tasks = await getOpenTasks(db, season.id)
    const assign = tasks.find((t) => t.kind === 'assign')
    assert.ok(assign, '担当未割当のやることが無い')
    assert.equal(assign.owner, null)
  })

  test('個人情報削除を受けた人は、氏名の見える窓に出ない', async () => {
    const tasks = await getOpenTasks(db, season.id)
    assert.equal(tasks.filter((t) => t.person_name.startsWith('削除')).length, 0)
  })
})

describe('件と人を混ぜない', () => {
  test('やることの件数と、待っている人数は別の数である', async () => {
    const totals = await getTaskTotals(db, season.id)
    assert.ok(totals)
    // 重複待ちが2件、直付一件が1件 = 3件。人は2人。
    assert.equal(Number(totals.open_tasks), 3)
    assert.equal(Number(totals.waiting_persons), 2)
    assert.notEqual(Number(totals.open_tasks), Number(totals.waiting_persons),
      'この2つが常に一致するデータでは、混同していても気づけない')
  })

  test('待っている人は、1人1行に畳まれる', async () => {
    const waiting = await getWaitingPersons(db, season.id)
    assert.equal(waiting.length, 2)
    const ids = waiting.map((w) => w.person_id)
    assert.equal(new Set(ids).size, ids.length, '同じ人が2行に出ている')

    const busy = waiting.find((w) => w.person_id === busyPersonId)
    assert.ok(busy)
    assert.equal(Number(busy.tasks), 2, '持っているやることの件数は残す')
    assert.equal(busy.overdue, true)
    // 代表する行は最も長く待っているもの。
    assert.ok(busy.waiting_days > 300)
  })

  test('待っている人の合計件数は、やることの件数に一致する', async () => {
    const [waiting, totals] = await Promise.all([
      getWaitingPersons(db, season.id), getTaskTotals(db, season.id),
    ])
    const summed = waiting.reduce((n, w) => n + Number(w.tasks), 0)
    assert.equal(summed, Number(totals!.open_tasks),
      '人で畳んだときに、やることを落としても増やしてもいけない')
  })
})

describe('どの森が要注意か', () => {
  test('滞留している森に stalled の旗が立ち、先頭に来る', async () => {
    const forests = await getForests(db, season.id)
    assert.ok(forests.length >= 1)
    assert.equal(forests[0]!.forest_id, forestId)
    assert.ok(forests[0]!.flags.includes('stalled'))
    // 林経由の人も森に数えられている（削除済みは除く）。
    assert.equal(Number(forests[0]!.persons_touched), 2)
    assert.equal(Number(forests[0]!.overdue_tasks), 1)
  })

  test('接点が1件も無い森は untouched で、休眠とは区別する', async () => {
    const empty = await scalar<string>(db,
      `INSERT INTO partners (name, category) VALUES ('未接触の森','school') RETURNING id`)
    const forests = await getForests(db, season.id)
    const row = forests.find((f) => f.forest_id === empty)
    assert.ok(row)
    assert.deepEqual(row.flags, ['untouched'])
    assert.equal(row.days_since_touch, null,
      '接点が無いことを「0日前」と表すと、今日接触したのと区別が付かない')
  })

  test('休眠の閾値は引数で変えられる（運用で決める仮の値）', async () => {
    // 検証の森の最終接触は 2025-10-02。実行日によって日数は変わるので、
    // 閾値のほうを動かして、旗が入れ替わることだけを固定する。
    const loose = await getForests(db, season.id, 100_000)
    const strict = await getForests(db, season.id, 1)
    assert.equal(loose.find((f) => f.forest_id === forestId)!.flags.includes('dormant'), false)
    assert.equal(strict.find((f) => f.forest_id === forestId)!.flags.includes('dormant'), true)
  })
})

describe('森を1つ開く', () => {
  test('壊れた id は「見つからない」で返る（500 にしない）', async () => {
    assert.equal(await getForest(db, 'not-a-uuid'), null)
  })

  test('林の一覧に、森直付けの接点は混ざらない', async () => {
    const communities = await getCommunities(db, forestId)
    assert.equal(communities.length, 1)
    assert.equal(communities[0]!.community_id, communityId)
    // 林に接点があるのは「重複待ち」と「削除済」の2人だが、削除済みは外れる。
    assert.equal(Number(communities[0]!.persons_touched), 1)
  })

  test('森に接点がある人は、待っている人から先に出る', async () => {
    const persons = await getForestPersons(db, forestId, season.id)
    assert.equal(persons.length, 2, '削除を受けた人が混ざっている')
    assert.equal(persons[0]!.person_id, busyPersonId)
    assert.equal(persons[0]!.overdue, true)
    assert.equal(Number(persons[0]!.open_tasks), 2)
    // どこ経由かは、その森に属する団体の名前で出る（林なら林の名前）。
    assert.equal(persons[0]!.via, '検証の林')
    assert.equal(persons[1]!.via, '検証の森')
  })
})

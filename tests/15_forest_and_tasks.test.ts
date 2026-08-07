import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { scalar, all, one, type Db } from '../src/db/client.ts'
import {
  baseFixture, makeSeason, makePerson, makeChannel, makeTouchpoint,
  makeApplication, addHistory, jst, type Fixture, type Season,
} from './support/fixtures.ts'

/**
 * 0012 で足した記録層と集計定義の検証。
 *
 *   団体の階層（森 > 林）が2段に閉じているか
 *   林に付いた接点が、森へ畳まれているか
 *   いまやること（v_open_tasks）の母集団が「動いている応募」か
 *   未識別（推定リーチ）と識別済み（実人数）が、別の列として独立に出るか
 *
 * 森の集計は「行をまたいで足せない」性質を持つ。同じ人が2つの森から
 * 接触されていれば両方の行で1と数えられる。これは欠陥ではなく定義だが、
 * あとから合計を出す変更が入ったときに気づけるよう、性質そのものを固定する。
 */

let db: Db
let fx: Fixture
let season: Season
let channelId: string

/** 森を1つ作る。 */
const makeForest = (name: string) =>
  scalar<string>(db, `INSERT INTO partners (name, category) VALUES ($1,'university')
                      RETURNING id`, [name])

/** 林を1つ作る（親は森）。 */
const makeCommunity = (name: string, forestId: string) =>
  scalar<string>(db, `INSERT INTO partners (name, category, parent_partner_id)
                      VALUES ($1,'community',$2) RETURNING id`, [name, forestId])

before(async () => {
  db = await freshDb()
  fx = await baseFixture(db)
  season = await makeSeason(db, { year: 2027 })
  channelId = await makeChannel(db, '提携団体イベント')
})

after(async () => { await db.close() })

describe('団体の階層', () => {
  test('林の下に林は作れない（3段目を拒否する）', async () => {
    const forest = await makeForest('三段の森')
    const community = await makeCommunity('三段の林', forest)
    await assert.rejects(
      () => makeCommunity('孫', community),
      /2段まで/,
      '3段目が通ってしまうと、森の集計に孫が入るかどうかが未定義になる',
    )
  })

  test('子を持つ団体を、他の団体の子にはできない', async () => {
    const parent = await makeForest('親になった森')
    await makeCommunity('その林', parent)
    const other = await makeForest('別の森')
    await assert.rejects(
      () => db.query(`UPDATE partners SET parent_partner_id = $2 WHERE id = $1`,
        [parent, other]),
      /子を持つ団体/,
    )
  })

  test('自分を親にはできない', async () => {
    const forest = await makeForest('自己参照の森')
    await assert.rejects(
      () => db.query(`UPDATE partners SET parent_partner_id = id WHERE id = $1`, [forest]),
      /partners_parent_not_self/,
    )
  })

  test('森は自分を指し、林は親を指す', async () => {
    const forest = await makeForest('畳みの森')
    const community = await makeCommunity('畳みの林', forest)
    const rows = await all<{ partner_id: string; forest_id: string; is_community: boolean }>(
      db, `SELECT * FROM v_partner_forest WHERE partner_id = ANY($1::uuid[])`,
      [[forest, community]])
    const byId = new Map(rows.map((r) => [r.partner_id, r]))
    assert.equal(byId.get(forest)!.forest_id, forest)
    assert.equal(byId.get(forest)!.is_community, false)
    assert.equal(byId.get(community)!.forest_id, forest)
    assert.equal(byId.get(community)!.is_community, true)
  })
})

describe('森の活動', () => {
  test('林に付いた接点が、森の数に畳まれる', async () => {
    const forest = await makeForest('畳まれる森')
    const community = await makeCommunity('畳まれる林', forest)
    const direct = await makePerson(db, fx.schoolId)
    const viaCommunity = await makePerson(db, fx.schoolId)
    // 森に直付けの接点と、林に付いた接点。両方が森の数に入る。
    await makeTouchpoint(db, direct, channelId, jst('2026-05-01T10:00:00'), forest)
    await makeTouchpoint(db, viaCommunity, channelId, jst('2026-06-01T10:00:00'), community)

    const row = await one<{ persons_touched: string; touchpoints: string; communities: string }>(
      db, `SELECT persons_touched, touchpoints, communities
             FROM v_forest_activity WHERE forest_id = $1`, [forest])
    assert.equal(Number(row.persons_touched), 2, '林の接点が森から漏れている')
    assert.equal(Number(row.touchpoints), 2)
    assert.equal(Number(row.communities), 1)

    // 林は森として現れない。
    const asForest = await scalar<string>(db,
      `SELECT count(*) FROM v_forest_activity WHERE forest_id = $1`, [community])
    assert.equal(Number(asForest), 0, '林が森の一覧に出てはいけない')
  })

  test('接点が1件も無い森は、推定リーチだけを持てる', async () => {
    // リーチはあるのに誰も識別できていない形。**この2つを割ってはならない**
    // （domain.md 8節。未識別と識別済みの境界をまたぐ）。
    // 割り算を作らせないために、列が独立していることを固定する。
    const forest = await makeForest('リーチだけの森')
    await db.query(
      `INSERT INTO partner_reaches (partner_id, season_id, occurred_on, estimated_reach)
       VALUES ($1,$2,'2026-05-10',400)`, [forest, season.id])

    const row = await one<{
      persons_touched: string; days_since_touch: number | null; estimated_reach: string
    }>(db, `SELECT persons_touched, days_since_touch, estimated_reach
              FROM v_forest_activity WHERE forest_id = $1`, [forest])
    assert.equal(Number(row.persons_touched), 0)
    assert.equal(row.days_since_touch, null, '接点が無い森の経過日数は 0 ではなく未定義')
    assert.equal(Number(row.estimated_reach), 400)
  })

  test('個人情報削除を受けた人は、森の実人数に数えない', async () => {
    const forest = await makeForest('削除のある森')
    const alive = await makePerson(db, fx.schoolId)
    const removed = await makePerson(db, fx.schoolId)
    await makeTouchpoint(db, alive, channelId, jst('2026-05-02T10:00:00'), forest)
    await makeTouchpoint(db, removed, channelId, jst('2026-05-03T10:00:00'), forest)
    await db.query(`UPDATE persons SET deleted_at = now() WHERE id = $1`, [removed])

    const row = await one<{ persons_touched: string; touchpoints: string }>(db,
      `SELECT persons_touched, touchpoints FROM v_forest_activity WHERE forest_id = $1`,
      [forest])
    assert.equal(Number(row.persons_touched), 1)
    assert.equal(Number(row.touchpoints), 1, '削除済みの接点は森の件数からも外す')
  })
})

describe('年度を1つ絞っても、全件と同じ桁で返る', () => {
  /**
   * 計算量の防波堤。**時計では測らない。**
   *
   * このプロジェクトは「作り物のデータから出た数字をドキュメントに残さない」
   * を規律にしている。実行時間はデータ量とマシンに依存するので、
   * 固定するのは**プランが崩れない形のほう**である。
   *
   * 何が起きたか。v_forest_season_activity を素の WITH で書いたところ、
   * 全件（WHERE なし）は速いのに、年度を1つ指定した瞬間に 9000 倍
   * 遅くなった。`season_id = X` が CTE の内側へ降りると、プランナが
   * 入れ子ループを選び、その内側に居る再帰 CTE
   * （v_effective_status_histories）が外側の行ごとに回り直すためである。
   *
   * A-11 と同じ形だが**向きが逆**で、あちらは絞ると速く見えた。
   * 「一覧は絞り込みなしで開いて確かめる」（実行③）だけでは見つからない。
   *
   * MATERIALIZED はそのプッシュダウンを禁じる指定である。外されると
   * 静かに元の壊れ方へ戻り、しかも小さなデータでは誰も気づけない。
   * だから定義そのものを見張る。
   */
  test('森×年度の集計は、供給元を1回だけ走る形を保っている', async () => {
    const def = await scalar<string>(db,
      `SELECT pg_get_viewdef('v_forest_season_activity'::regclass, true)`)
    for (const cte of ['forest_person', 'countable', 'open_tasks']) {
      assert.match(def, new RegExp(`${cte} AS MATERIALIZED`),
        `${cte} の MATERIALIZED が外れている。年度で絞ると計算量が爆発する`)
    }
  })

  test('やることの年度は、選考ステップ側から取っている', async () => {
    // 応募側（a.season_id）から取ると、呼び出し側の絞り込みが
    // v_active_applications を通って再帰 CTE まで降りる。
    // 値は同じでも計算量が変わる。
    const def = await scalar<string>(db, `SELECT pg_get_viewdef('v_open_tasks'::regclass, true)`)
    assert.match(def, /ss\.season_id/,
      'v_open_tasks の season_id は selection_steps から取る')
  })

  test('どちらから取っても、年度の値そのものは変わらない', async () => {
    // 上の判断は計算量のためのものであって、意味を変えていない。
    // 選考ステップの年度と応募の年度がずれる行があれば、ここで落ちる。
    const mismatched = await scalar<string>(db, `
      SELECT count(*) FROM evaluations e
        JOIN selection_steps ss ON ss.id = e.selection_step_id
        JOIN applications a ON a.id = e.application_id
       WHERE ss.season_id <> a.season_id`)
    assert.equal(Number(mismatched), 0, '応募と違う年度のステップに評価が付いている')
  })
})

describe('森×年度は、行をまたいで足せない', () => {
  test('同じ人が2つの森に接点を持つと、両方の行に1と数えられる', async () => {
    // 0009 の f_partner_reach_summary と同じ性質。欠陥ではなく定義である。
    // 合計を出す変更が入ったときに、ここで気づけるようにしておく。
    const a = await makeForest('重複の森A')
    const b = await makeForest('重複の森B')
    const person = await makePerson(db, fx.schoolId)
    // 接点は年度の期間内（2026-09-01 〜 2027-02-28）に置く。外に置くと
    // v_touchpoint_season が年度を付けず、この表そのものに行が立たない。
    await makeTouchpoint(db, person, channelId, jst('2026-10-04T10:00:00'), a)
    await makeTouchpoint(db, person, channelId, jst('2026-10-05T10:00:00'), b)
    await makeApplication(db, person, season.id, jst('2026-11-10T20:00:00'))

    const rows = await all<{ forest_id: string; persons_touched: string; applications: string }>(
      db, `SELECT forest_id, persons_touched, applications
             FROM v_forest_season_activity
            WHERE forest_id = ANY($1::uuid[]) AND season_id = $2`, [[a, b], season.id])
    assert.equal(rows.length, 2)
    for (const r of rows) {
      assert.equal(Number(r.persons_touched), 1)
      assert.equal(Number(r.applications), 1)
    }
    // 足すと 2 人 2 応募になるが、実体は1人1応募である。
    const summed = rows.reduce((n, r) => n + Number(r.persons_touched), 0)
    assert.equal(summed, 2, '合計してはいけないことの根拠。画面に合計を出さない')
  })
})

describe('いまやること', () => {
  /** 応募して第1ステップまで進んだ状態を作る。 */
  const applyAndAssign = async (opts: {
    interviewerStaffId?: string | null
    state?: 'pending' | 'held'
    assignedAt: string
    stepIndex?: number
    holdReason?: string
    referrerPersonId?: string
  }) => {
    const person = await makePerson(db, fx.schoolId,
      opts.referrerPersonId ? { referrerPersonId: opts.referrerPersonId } : {})
    const app = await makeApplication(db, person, season.id, jst('2026-07-01T20:00:00'))
    await db.query(
      `INSERT INTO evaluations (application_id, selection_step_id, interviewer_staff_id,
                                state, assigned_at, hold_reason)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [app, season.stepIds[opts.stepIndex ?? 0], opts.interviewerStaffId ?? null,
       opts.state ?? 'pending', opts.assignedAt, opts.holdReason ?? null])
    return { person, app }
  }

  const kindsFor = (applicationId: string) =>
    all<{ kind: string }>(db,
      `SELECT kind FROM v_open_tasks WHERE application_id = $1 ORDER BY kind`,
      [applicationId]).then((rows) => rows.map((r) => r.kind))

  test('担当が決まっていれば「評価する」、いなければ「担当を決める」', async () => {
    const withOwner = await applyAndAssign({
      interviewerStaffId: fx.staffId, assignedAt: jst('2026-07-05T10:00:00'),
    })
    const withoutOwner = await applyAndAssign({ assignedAt: jst('2026-07-05T10:00:00') })
    assert.deepEqual(await kindsFor(withOwner.app), ['evaluate'])
    assert.deepEqual(await kindsFor(withoutOwner.app), ['assign'])
  })

  test('保留は「保留を解く」として出て、理由が読める', async () => {
    const held = await applyAndAssign({
      interviewerStaffId: fx.staffId, state: 'held',
      assignedAt: jst('2026-07-05T10:00:00'), holdReason: '追加提出を依頼して返答待ち',
    })
    const row = await one<{ kind: string; detail: string }>(db,
      `SELECT kind, detail FROM v_open_tasks WHERE application_id = $1`, [held.app])
    assert.equal(row.kind, 'unhold')
    assert.equal(row.detail, '追加提出を依頼して返答待ち')
  })

  test('SLA を超えていれば is_overdue が立つ', async () => {
    // ステップの sla_days は 7（fixtures）。1年前に割り当てたものは必ず超過。
    const old = await applyAndAssign({
      interviewerStaffId: fx.staffId, assignedAt: jst('2025-01-10T10:00:00'),
    })
    const row = await one<{ is_overdue: boolean; waiting_days: number; sla_days: number }>(db,
      `SELECT is_overdue, waiting_days, sla_days FROM v_open_tasks
        WHERE application_id = $1`, [old.app])
    assert.equal(row.is_overdue, true)
    assert.equal(row.sla_days, 7)
    assert.ok(row.waiting_days > 7)
  })

  test('取り下げ済みの応募（数えるが、動いていない）は出ない', async () => {
    // A-14 で直した分岐そのもの。母集団を v_countable_applications に
    // すると、選考前に取り下げられた応募を催促し続ける。
    const reason = await scalar<string>(db,
      `INSERT INTO void_reasons (code, label, counts_as_application)
       VALUES ('withdrawn_before_screening_15','選考前の取り下げ',true) RETURNING id`)
    const cancelled = await applyAndAssign({ assignedAt: jst('2026-07-05T10:00:00') })
    await db.query(
      `UPDATE applications SET voided_at = $2, void_reason_id = $3 WHERE id = $1`,
      [cancelled.app, jst('2026-07-12T10:00:00'), reason])

    assert.deepEqual(await kindsFor(cancelled.app), [], '動いていない応募にやることは無い')
    // 木には数え続けている（両者が別の述語であることの確認）。
    const countable = await scalar<string>(db,
      `SELECT count(*) FROM v_countable_applications WHERE id = $1`, [cancelled.app])
    assert.equal(Number(countable), 1)
  })

  test('合格・不合格の済んだ応募は出ない', async () => {
    const done = await applyAndAssign({
      interviewerStaffId: fx.staffId, assignedAt: jst('2026-07-05T10:00:00'),
    })
    await addHistory(db, {
      applicationId: done.app, type: 'reject', staffId: fx.staffId,
      occurredAt: jst('2026-07-20T19:00:00'),
    })
    assert.deepEqual(await kindsFor(done.app), [])
  })

  test('個人情報削除を受けた人は出ない', async () => {
    const removed = await applyAndAssign({
      interviewerStaffId: fx.staffId, assignedAt: jst('2026-07-05T10:00:00'),
    })
    await db.query(`UPDATE persons SET deleted_at = now() WHERE id = $1`, [removed.person])
    assert.deepEqual(await kindsFor(removed.app), [],
      '運用の画面に、削除を受けた人の見える窓を残さない')
  })

  test('利益相反は「担当を替える」に出て、「評価する」には出ない', async () => {
    // 同じ評価を2種類のタスクとして出すと件数が二重に見える。
    // そこでやるべきことは担当の差し替えであって、評価ではない。
    const mentorPerson = await makePerson(db, fx.schoolId)
    const mentorStaff = await scalar<string>(db,
      `INSERT INTO staffs (person_id, display_name, email)
       VALUES ($1,'紹介者スタッフ','ref15@example.test') RETURNING id`, [mentorPerson])
    const conflicted = await applyAndAssign({
      interviewerStaffId: mentorStaff, assignedAt: jst('2026-07-05T10:00:00'),
      referrerPersonId: mentorPerson,
    })
    const row = await one<{ kind: string; detail: string }>(db,
      `SELECT kind, detail FROM v_open_tasks WHERE application_id = $1`, [conflicted.app])
    assert.equal(row.kind, 'reassign')
    assert.equal(row.detail, '紹介者が面接官')
  })

  test('判断が下りた評価の利益相反は出ない（替えても戻らない）', async () => {
    const mentorPerson = await makePerson(db, fx.schoolId)
    const mentorStaff = await scalar<string>(db,
      `INSERT INTO staffs (person_id, display_name, email)
       VALUES ($1,'提出済みスタッフ','ref15b@example.test') RETURNING id`, [mentorPerson])
    const person = await makePerson(db, fx.schoolId, { referrerPersonId: mentorPerson })
    const app = await makeApplication(db, person, season.id, jst('2026-07-01T20:00:00'))
    await db.query(
      `INSERT INTO evaluations (application_id, selection_step_id, interviewer_staff_id,
                                state, assigned_at, submitted_at)
       VALUES ($1,$2,$3,'submitted',$4,$5)`,
      [app, season.stepIds[0], mentorStaff,
       jst('2026-07-05T10:00:00'), jst('2026-07-08T10:00:00')])

    assert.deepEqual(await kindsFor(app), [])
    // 検出そのものは残っている。/operations の検証に使う。
    const detected = await scalar<string>(db,
      `SELECT count(*) FROM v_conflict_of_interest WHERE application_id = $1`, [app])
    assert.equal(Number(detected), 1)
  })

  test('やることは、森×年度の未処理件数に乗る', async () => {
    // 森 → 林 → 人 → やること が、集計として一本につながっているか。
    const forest = await makeForest('やることの森')
    const community = await makeCommunity('やることの林', forest)
    const person = await makePerson(db, fx.schoolId)
    // 接点は林に付ける。年度の期間内（2026-09-01〜2027-02-28）に置く。
    await makeTouchpoint(db, person, channelId, jst('2026-10-05T10:00:00'), community)
    const app = await makeApplication(db, person, season.id, jst('2026-11-10T20:00:00'))
    await db.query(
      `INSERT INTO evaluations (application_id, selection_step_id, interviewer_staff_id,
                                state, assigned_at)
       VALUES ($1,$2,$3,'pending',$4)`,
      [app, season.stepIds[0], fx.staffId, jst('2025-01-10T10:00:00')])

    const row = await one<{ open_tasks: string; overdue_tasks: string; applications: string }>(
      db, `SELECT open_tasks, overdue_tasks, applications FROM v_forest_season_activity
             WHERE forest_id = $1 AND season_id = $2`, [forest, season.id])
    assert.equal(Number(row.open_tasks), 1, '林経由の人のやることが森に上がっていない')
    assert.equal(Number(row.overdue_tasks), 1)
    assert.equal(Number(row.applications), 1)
  })
})

describe('やることを二重に数えない', () => {
  /**
   * 同じ評価が2種類のタスクとして出ると、件数が二重に見える。
   *
   * 0012 では「評価する」から利益相反を除いた。そこでやるべきは担当の
   * 差し替えであって評価ではないからである。**「保留を解く」に同じ手当てを
   * していなかった。** 保留中の評価に利益相反が出ていると、
   * `unhold` と `reassign` の2行になる。
   *
   * 「担当を替える」を画面から実行できるようにする作業中に気づいた。
   * デモに保留＋利益相反の組み合わせが無かったため表に出ていなかった。
   */
  test('保留中の評価に利益相反があっても、やることは1件だけ出る', async () => {
    const mentorPerson = await makePerson(db, fx.schoolId)
    const mentorStaff = await scalar<string>(db,
      `INSERT INTO staffs (person_id, display_name, email)
       VALUES ($1,'保留の紹介者','ref15c@example.test') RETURNING id`, [mentorPerson])
    const person = await makePerson(db, fx.schoolId, { referrerPersonId: mentorPerson })
    const app = await makeApplication(db, person, season.id, jst('2026-07-01T20:00:00'))
    await db.query(
      `INSERT INTO evaluations (application_id, selection_step_id, interviewer_staff_id,
                                state, assigned_at, hold_reason)
       VALUES ($1,$2,$3,'held',$4,'本人の都合で日程を再調整中')`,
      [app, season.stepIds[0], mentorStaff, jst('2026-07-05T10:00:00')])

    const kinds = await all<{ kind: string }>(db,
      `SELECT kind FROM v_open_tasks WHERE application_id = $1 ORDER BY kind`, [app])
    assert.deepEqual(kinds.map((k) => k.kind), ['reassign'],
      '保留と利益相反で2行になっている。先にやるべきは担当の差し替えのほう')
  })
})

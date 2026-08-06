import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { all, scalar } from '../src/db/client.ts'
import {
  baseFixture, makeSeason, makePerson, makeApplication, addHistory, accept,
  makeChannel, makeTouchpoint, makeVoidReason, voidApplication,
  unconfirmedWithdrawReason, jst,
} from './support/fixtures.ts'
import {
  getPerson, getPersonSeasonStates, getPersonApplications, getPersonTouchpoints,
  getApplication, getApplicationTimeline, getApplicationEvaluations, searchPersons,
} from '../src/queries/drilldown.ts'

/**
 * 個人・応募のドリルダウン。
 *
 * ここが答えるのは CLAUDE.md の問い①（誰がどんな状態か）と
 * ②（誰が何を評価したか）。年度単位の集計では答えられない。
 *
 * 個別の画面は、年度サマリと同じ事実から作られていなければならない。
 * 同じ人について、一覧の数字と個別の表示が食い違うのが最悪の壊れ方で、
 * それは目視では見つからない。等価性をテストで固定する。
 */

// -------------------------------------------------------------
// 個人×年度の状態と、年度サマリの林との関係
// -------------------------------------------------------------

describe('個人の年度別状態と、年度サマリの林', () => {
  test('「林」と表示される人が、年度サマリの林に数えられているとは限らない', async () => {
    // v_person_season_state の 'identified_person' は
    // 「その年度に応募していない識別済みの人」でしかなく、窓を持たない。
    // 一方ダッシュボードの林は「基準日から遡って N 日以内に接点がある人」。
    // 個人画面がこれをそのまま「林」と出すと、①の答えが画面ごとに変わる。
    const db = await freshDb()
    const base = await baseFixture(db)
    const s = await makeSeason(db, { year: 2026 })   // 選考終了 2026-02-28
    const ch = await makeChannel(db, 'イベント')

    const fresh = await makePerson(db, base.schoolId, { createdAt: jst('2025-09-05T10:00:00') })
    const stale = await makePerson(db, base.schoolId, { createdAt: jst('2025-09-05T10:00:00') })
    await makeTouchpoint(db, fresh, ch, jst('2026-02-20T10:00:00'))   // 窓の内
    await makeTouchpoint(db, stale, ch, jst('2025-09-10T10:00:00'))   // 窓の外

    const levels = await all<{ person_id: string; current_level: string }>(
      db, `SELECT person_id, current_level FROM v_person_season_state WHERE season_id = $1`,
      [s.id])
    assert.equal(levels.length, 2)
    assert.ok(levels.every((r) => r.current_level === 'identified_person'),
      '既存のビューでは2人とも同じ「林」')

    const rows = await all<{ person_id: string; in_active_window: boolean }>(
      db, `SELECT person_id, in_active_window FROM f_person_season_state(90)
            WHERE season_id = $1 ORDER BY person_id`, [s.id])
    const byId = new Map(rows.map((r) => [r.person_id, r.in_active_window]))
    assert.equal(byId.get(fresh), true, '直近に接点があるので年度サマリの林に入る')
    assert.equal(byId.get(stale), false, '接点が窓より前なので年度サマリの林には入らない')
    await db.close()
  })

  test('段を問わず窓に入っている人の数は、ファネルの林と一致する', async () => {
    // これが個人画面と年度サマリをつなぐ唯一の約束。
    // 木や幹になった人も接点を持てば林に数えられている（林は段ではなく鮮度の話）。
    // 段ごとに数えて足すのではなく、段を問わず窓の内側を数えると一致する。
    const db = await freshDb()
    const base = await baseFixture(db)
    const s = await makeSeason(db, { year: 2026 })   // 2025-09-01 〜 2026-02-28
    const ch = await makeChannel(db, 'イベント')
    const born = jst('2025-09-05T10:00:00')

    // 林・窓の内
    const a = await makePerson(db, base.schoolId, { createdAt: born })
    await makeTouchpoint(db, a, ch, jst('2026-02-20T10:00:00'))
    // 林・窓の外
    const b = await makePerson(db, base.schoolId, { createdAt: born })
    await makeTouchpoint(db, b, ch, jst('2025-09-10T10:00:00'))
    // 木・窓の内
    const c = await makePerson(db, base.schoolId, { createdAt: born })
    await makeTouchpoint(db, c, ch, jst('2026-02-01T10:00:00'))
    await makeApplication(db, c, s.id, jst('2025-11-10T09:00:00'))
    // 幹・窓の外
    const d = await makePerson(db, base.schoolId, { createdAt: born })
    await makeTouchpoint(db, d, ch, jst('2025-10-01T10:00:00'))
    const dApp = await makeApplication(db, d, s.id, jst('2025-11-10T09:00:00'))
    await accept(db, { applicationId: dApp, season: s, staffId: base.staffId,
      occurredAt: jst('2026-01-20T10:00:00') })
    // 削除済み・窓の内（どちらの数え方からも外れる）
    const e = await makePerson(db, base.schoolId, { createdAt: born })
    await makeTouchpoint(db, e, ch, jst('2026-02-20T10:00:00'))
    await db.query(`UPDATE persons SET deleted_at = now() WHERE id = $1`, [e])
    // 選考終了後に識別された人（年度に現れない）
    const f = await makePerson(db, base.schoolId, { createdAt: jst('2026-03-05T10:00:00') })
    await makeTouchpoint(db, f, ch, jst('2026-03-06T10:00:00'))

    const inWindow = await scalar<string>(
      db, `SELECT count(*) FROM f_person_season_state(90)
            WHERE season_id = $1 AND in_active_window`, [s.id])
    const funnel = await scalar<string>(db, `
      SELECT f.identified_person_cum
        FROM f_funnel_daily(90) f
        JOIN seasons se ON se.id = f.season_id
       WHERE se.id = $1 AND f.as_of = least(se.selection_end_date, jst_today())`, [s.id])

    assert.equal(Number(inWindow), 2, '窓の内側は 林1人 + 木1人')
    assert.equal(Number(inWindow), Number(funnel),
      '個人画面の1行1行を数えると、年度サマリの林に一致する')
    await db.close()
  })

  test('基準日は選考終了日と今日の早いほう', async () => {
    // 終わった年度で「今日」を基準にすると、選考終了後に付いた接点で
    // 過去の林が動く。進行中の年度で選考終了日を基準にすると、
    // まだ来ていない日の値を出すことになる。
    const db = await freshDb()
    const base = await baseFixture(db)
    const past = await makeSeason(db, { year: 2026 })                       // 終了済み
    const live = await makeSeason(db, { year: 2400, selectionEnd: '2400-02-28' })
    await makePerson(db, base.schoolId, { createdAt: jst('2025-09-05T10:00:00') })

    const rows = await all<{ enrollment_year: number; as_of: Date }>(
      db, `SELECT enrollment_year, as_of FROM f_person_season_state(90)`)
    const asOf = new Map(rows.map((r) => [r.enrollment_year, new Date(r.as_of).toISOString().slice(0, 10)]))
    assert.equal(asOf.get(2026), '2026-02-28', '終わった年度は選考終了日')
    const today = await scalar<Date>(db, `SELECT jst_today()`)
    assert.equal(asOf.get(2400), new Date(today).toISOString().slice(0, 10),
      '進行中の年度は今日')
    assert.ok(past.id && live.id)
    await db.close()
  })

  test('窓に 0 や NULL を渡すと落ちる', async () => {
    // f_funnel_daily と同じガード。黙って0人になるほうが悪い（A-4）。
    const db = await freshDb()
    await assert.rejects(
      () => db.query(`SELECT * FROM f_person_season_state(NULL)`),
      /active_window_days/)
    await assert.rejects(
      () => db.query(`SELECT * FROM f_person_season_state(0)`),
      /active_window_days/)
    await db.close()
  })
})

// -------------------------------------------------------------
// 個人1人を引く
// -------------------------------------------------------------

describe('個人を1人引く', () => {
  test('個人情報削除済みの Person は引けない', async () => {
    // 削除の依頼（資料9-2）を受けた人は、集計から外すだけでは足りない。
    // 個別に引ける窓が1つでも残っていれば、氏名も学校も見えてしまう。
    const db = await freshDb()
    const base = await baseFixture(db)
    const p = await makePerson(db, base.schoolId)
    assert.ok(await getPerson(db, p), '削除前は引ける')

    await db.query(`UPDATE persons SET deleted_at = now() WHERE id = $1`, [p])
    assert.equal(await getPerson(db, p), null)
    assert.deepEqual(await getPersonSeasonStates(db, p), [])
    assert.deepEqual(await getPersonApplications(db, p), [])
    assert.deepEqual(await getPersonTouchpoints(db, p), [])
    await db.close()
  })

  test('URL に UUID でない文字列が来ても落ちない', async () => {
    // /people/<id> の id はユーザが自由に書ける。生のまま WHERE に渡すと
    // invalid input syntax で 500 になる。「知らない人」と「壊れた入力」は
    // どちらも「見つからない」でよい（getSeason と同じ扱い）。
    const db = await freshDb()
    assert.equal(await getPerson(db, 'not-a-uuid'), null)
    assert.equal(await getPerson(db, undefined), null)
    assert.equal(await getPerson(db, '00000000-0000-0000-0000-000000000000'), null)
    assert.deepEqual(await getPersonApplications(db, 'not-a-uuid'), [])
    await db.close()
  })

  test('絞り込みに空文字が来ても、絞り込まない', async () => {
    // フォームの <select> は「すべての段」を空文字で送る。空文字を
    // そのまま WHERE current_level = '' に渡すと、該当0件になる。
    // 一覧を開いただけで「該当する人がいない」と出た。
    // 「指定なし」と「空文字という指定」を区別する。
    const db = await freshDb()
    const base = await baseFixture(db)
    const s = await makeSeason(db, { year: 2026 })
    const p = await makePerson(db, base.schoolId, { createdAt: jst('2025-09-05T10:00:00') })

    assert.deepEqual(
      (await searchPersons(db, { q: '', seasonId: s.id, level: '' })).map((h) => h.person_id),
      [p])
    assert.deepEqual(
      (await searchPersons(db, { q: '   ', seasonId: '', level: '' })).map((h) => h.person_id),
      [p])
    assert.deepEqual(
      await searchPersons(db, { seasonId: s.id, level: 'accepted' }), [],
      '段を実際に指定したときは絞る')
    await db.close()
  })

  test('年度を指定すると、その年度の母集団に入る人だけが返る', async () => {
    // 段の付与は f_person_season_state を1回だけ評価する CTE に切り出してある。
    // 切り出しで絞り込みが緩むと、年度の母集団に入らない人まで並ぶ。
    const db = await freshDb()
    const base = await baseFixture(db)
    const s = await makeSeason(db, { year: 2026 })          // 選考終了 2026-02-28
    const inside = await makePerson(db, base.schoolId, { createdAt: jst('2025-09-05T10:00:00') })
    const after = await makePerson(db, base.schoolId, { createdAt: jst('2026-03-05T10:00:00') })

    assert.deepEqual(
      (await searchPersons(db, { seasonId: s.id })).map((h) => h.person_id), [inside])
    assert.deepEqual(
      (await searchPersons(db, {})).map((h) => h.person_id).sort(),
      [inside, after].sort(), '年度を指定しなければ両方返る')
    assert.equal((await searchPersons(db, { seasonId: s.id }))[0]!.current_level,
      'identified_person', '段が付く')
    assert.equal((await searchPersons(db, {}))[0]!.current_level, null,
      '年度を指定しなければ段は付かない')
    await db.close()
  })

  test('検索は削除済みを返さない', async () => {
    const db = await freshDb()
    const base = await baseFixture(db)
    const alive = await makePerson(db, base.schoolId, { familyName: '検索', givenName: '対象' })
    const gone = await makePerson(db, base.schoolId, { familyName: '検索', givenName: '削除済' })
    await db.query(`UPDATE persons SET deleted_at = now() WHERE id = $1`, [gone])

    const hits = await searchPersons(db, { q: '検索' })
    assert.deepEqual(hits.map((h) => h.person_id), [alive])
    await db.close()
  })
})

// -------------------------------------------------------------
// 応募の一覧（個人画面）
// -------------------------------------------------------------

describe('個人の応募一覧', () => {
  test('無効化された応募も返し、集計に数えるかを列で示す', async () => {
    // v_application_state で作ると、代替が生まれる無効化（名寄せ誤り）の
    // 応募が消える。消えた応募に評価と遷移がぶら下がっていると、
    // 「記録はあるのに画面のどこにも無い」状態になる。
    // 個別の画面は集計ではないので、事実は落とさず、数えるかどうかを列で示す。
    const db = await freshDb()
    const base = await baseFixture(db)
    const s = await makeSeason(db, { year: 2026 })
    const p = await makePerson(db, base.schoolId, { createdAt: jst('2025-09-05T10:00:00') })

    const mergeError = await makeVoidReason(db, 'identity_merge_error', false)
    const wrong = await makeApplication(db, p, s.id, jst('2025-11-01T09:00:00'))
    await db.query(
      `INSERT INTO evaluations (application_id, selection_step_id) VALUES ($1, $2)`,
      [wrong, s.stepIds[0]])
    await addHistory(db, { applicationId: wrong, type: 'advance', stepId: s.stepIds[0],
      staffId: base.staffId, occurredAt: jst('2025-11-20T10:00:00') })
    await voidApplication(db, wrong, mergeError, jst('2025-11-25T10:00:00'))

    const right = await makeApplication(db, p, s.id, jst('2025-11-26T09:00:00'))

    const counted = await all<{ application_id: string }>(
      db, `SELECT application_id FROM v_application_state WHERE person_id = $1`, [p])
    assert.deepEqual(counted.map((r) => r.application_id), [right],
      '集計は無効化された応募を数えない（A-2）')

    const rows = await getPersonApplications(db, p)
    assert.equal(rows.length, 2, '個別の画面には両方出す')
    const voided = rows.find((r) => r.application_id === wrong)!
    assert.equal(voided.is_countable, false)
    assert.equal(voided.void_reason_label, 'identity_merge_error')
    assert.equal(Number(voided.evaluation_count), 1, '評価がぶら下がっていることが見える')
    assert.equal(rows.find((r) => r.application_id === right)!.is_countable, true)
    await db.close()
  })

  test('取り下げて出し直した年度は、応募2件がどちらも集計対象になる', async () => {
    // A-2 の分岐。counts_as_application = true の無効化は木に残る。
    // 0007 で v_person_season_state を応募またぎの最高到達点にしたのは
    // この形が原因で、それを個人の画面で確かめられるようにする。
    const db = await freshDb()
    const base = await baseFixture(db)
    const s = await makeSeason(db, { year: 2026 })
    const p = await makePerson(db, base.schoolId, { createdAt: jst('2025-09-05T10:00:00') })

    const withdrawn = await makeVoidReason(db, 'withdrawn_before_screening', true)
    const first = await makeApplication(db, p, s.id, jst('2025-11-01T09:00:00'))
    await voidApplication(db, first, withdrawn, jst('2025-11-10T10:00:00'))
    const second = await makeApplication(db, p, s.id, jst('2025-11-12T09:00:00'))
    await accept(db, { applicationId: second, season: s, staffId: base.staffId,
      occurredAt: jst('2026-01-20T10:00:00') })

    const rows = await getPersonApplications(db, p)
    assert.equal(rows.length, 2)
    assert.ok(rows.every((r) => r.is_countable), 'どちらも木に数える')

    const states = await getPersonSeasonStates(db, p)
    assert.equal(states.length, 1, 'Person × Season で1行')
    assert.equal(states[0]!.current_level, 'accepted', '年度内の最高到達点を取る')
    assert.equal(Number(states[0]!.application_count), 2)
    assert.ok(first && second)
    await db.close()
  })
})

// -------------------------------------------------------------
// 応募1件を引く
// -------------------------------------------------------------

describe('応募の履歴', () => {
  test('訂正で無効になった遷移も履歴に残り、有効かどうかが分かる', async () => {
    // 有効な行だけを出すと「なぜ不合格の連絡をしたのに合格しているのか」を
    // 説明できない。②（誰が何を根拠に判断したか）に効くのは経緯そのもの。
    const db = await freshDb()
    const base = await baseFixture(db)
    const s = await makeSeason(db, { year: 2026 })
    const p = await makePerson(db, base.schoolId, { createdAt: jst('2025-09-05T10:00:00') })
    const app = await makeApplication(db, p, s.id, jst('2025-11-10T09:00:00'))

    const rejected = await addHistory(db, { applicationId: app, type: 'reject',
      staffId: base.staffId, occurredAt: jst('2025-12-01T10:00:00') })
    const corrected = await addHistory(db, { applicationId: app, type: 'advance',
      stepId: s.stepIds[1], staffId: base.staffId, occurredAt: jst('2025-12-02T10:00:00'),
      correctsHistoryId: rejected })

    const rows = await getApplicationTimeline(db, app)
    assert.deepEqual(rows.map((r) => r.history_id), [rejected, corrected], '時系列で返す')
    assert.deepEqual(rows.map((r) => r.is_effective), [false, true])
    assert.equal(rows[1]!.corrects_history_id, rejected, 'どの記録を打ち消したかが分かる')
    await db.close()
  })

  test('訂正の訂正まで戻ると、元の記録が有効に戻る', async () => {
    // 会計の逆仕訳と同じ。深さが偶数の行が有効（v_effective_status_histories）。
    // 深さ2の行が有効に戻ることは集計側でテスト済みだが、
    // 画面がそれを「取り消し線を引いたまま」出すと記録と食い違う。
    const db = await freshDb()
    const base = await baseFixture(db)
    const s = await makeSeason(db, { year: 2026 })
    const p = await makePerson(db, base.schoolId, { createdAt: jst('2025-09-05T10:00:00') })
    const app = await makeApplication(db, p, s.id, jst('2025-11-10T09:00:00'))

    const h1 = await addHistory(db, { applicationId: app, type: 'reject',
      staffId: base.staffId, occurredAt: jst('2025-12-01T10:00:00') })
    const h2 = await addHistory(db, { applicationId: app, type: 'advance',
      stepId: s.stepIds[1], staffId: base.staffId, occurredAt: jst('2025-12-02T10:00:00'),
      correctsHistoryId: h1 })
    const h3 = await addHistory(db, { applicationId: app, type: 'reject',
      staffId: base.staffId, occurredAt: jst('2025-12-03T10:00:00'), correctsHistoryId: h2 })

    const rows = await getApplicationTimeline(db, app)
    assert.deepEqual(rows.map((r) => r.history_id), [h1, h2, h3])
    assert.deepEqual(rows.map((r) => r.is_effective), [true, false, true],
      '深さ偶数が有効。元の不合格が復活している')
    await db.close()
  })

  test('不合格と辞退はステップを持たない。画面が推測で埋めない', async () => {
    // status_histories.selection_step_id は reject / withdraw では NULL。
    // 「直前に割り当てられた評価のステップ」で埋めると、根拠のない数字が
    // 一人歩きする（getStepFlow と同じ判断）。事実として NULL のまま返す。
    const db = await freshDb()
    const base = await baseFixture(db)
    const s = await makeSeason(db, { year: 2026 })
    const p = await makePerson(db, base.schoolId, { createdAt: jst('2025-09-05T10:00:00') })
    const app = await makeApplication(db, p, s.id, jst('2025-11-10T09:00:00'))
    await db.query(
      `INSERT INTO evaluations (application_id, selection_step_id) VALUES ($1, $2)`,
      [app, s.stepIds[0]])
    await addHistory(db, { applicationId: app, type: 'reject',
      staffId: base.staffId, occurredAt: jst('2025-12-01T10:00:00') })

    const rows = await getApplicationTimeline(db, app)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]!.step_name, null)
    await db.close()
  })

  test('辞退は理由が読める形で出る', async () => {
    const db = await freshDb()
    const base = await baseFixture(db)
    const s = await makeSeason(db, { year: 2026 })
    const p = await makePerson(db, base.schoolId, { createdAt: jst('2025-09-05T10:00:00') })
    const app = await makeApplication(db, p, s.id, jst('2025-11-10T09:00:00'))
    const reason = await unconfirmedWithdrawReason(db)
    await addHistory(db, { applicationId: app, type: 'withdraw', withdrawReasonId: reason,
      staffId: base.staffId, occurredAt: jst('2026-01-20T10:00:00') })

    const rows = await getApplicationTimeline(db, app)
    assert.equal(rows[0]!.withdraw_reason_label, '未確認')
    assert.equal(rows[0]!.changed_by, '運営 太郎', '誰が記録したかが分かる')
    await db.close()
  })
})

describe('応募の評価', () => {
  test('評価は軸ごとの点と根拠エピソードを伴って返る', async () => {
    // rationale は必須（資料5-3）。②に答えるのはここ。
    const db = await freshDb()
    const base = await baseFixture(db)
    const s = await makeSeason(db, { year: 2026 })
    const p = await makePerson(db, base.schoolId, { createdAt: jst('2025-09-05T10:00:00') })
    const app = await makeApplication(db, p, s.id, jst('2025-11-10T09:00:00'))

    const crit = await scalar<string>(db,
      `INSERT INTO evaluation_criteria (selection_step_id, name, scale_max, sort_order)
       VALUES ($1, '主体性', 5, 1) RETURNING id`, [s.stepIds[0]])
    const ev = await scalar<string>(db,
      `INSERT INTO evaluations (application_id, selection_step_id, interviewer_staff_id,
                                state, assigned_at, submitted_at)
       VALUES ($1, $2, $3, 'submitted', $4, $5) RETURNING id`,
      [app, s.stepIds[0], base.staffId, jst('2025-11-12T10:00:00'), jst('2025-11-15T10:00:00')])
    await db.query(
      `INSERT INTO evaluation_scores (evaluation_id, criteria_id, score, rationale)
       VALUES ($1, $2, 4, '文化祭の運営を自分で立ち上げた話に裏づけがあった')`, [ev, crit])

    const rows = await getApplicationEvaluations(db, app)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]!.interviewer, '運営 太郎')
    assert.equal(rows[0]!.state, 'submitted')
    assert.equal(rows[0]!.scores.length, 1)
    assert.equal(rows[0]!.scores[0]!.criteria_name, '主体性')
    assert.equal(Number(rows[0]!.scores[0]!.score), 4)
    assert.equal(Number(rows[0]!.scores[0]!.scale_max), 5)
    assert.match(rows[0]!.scores[0]!.rationale, /文化祭/)
    await db.close()
  })

  test('判断がまだ下りていない評価は、点が無いまま返る', async () => {
    // pending の評価を落とすと、③（いま何が起きているか）が応募画面から消える。
    const db = await freshDb()
    const base = await baseFixture(db)
    const s = await makeSeason(db, { year: 2026 })
    const p = await makePerson(db, base.schoolId, { createdAt: jst('2025-09-05T10:00:00') })
    const app = await makeApplication(db, p, s.id, jst('2025-11-10T09:00:00'))
    await db.query(
      `INSERT INTO evaluations (application_id, selection_step_id, state, hold_reason)
       VALUES ($1, $2, 'held', '追加提出を依頼して返答待ち')`, [app, s.stepIds[0]])

    const rows = await getApplicationEvaluations(db, app)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]!.interviewer, null, '担当未割当')
    assert.equal(rows[0]!.hold_reason, '追加提出を依頼して返答待ち')
    assert.deepEqual(rows[0]!.scores, [])
    await db.close()
  })

  test('個人情報削除済みの応募は引けない', async () => {
    const db = await freshDb()
    const base = await baseFixture(db)
    const s = await makeSeason(db, { year: 2026 })
    const p = await makePerson(db, base.schoolId, { createdAt: jst('2025-09-05T10:00:00') })
    const app = await makeApplication(db, p, s.id, jst('2025-11-10T09:00:00'))
    assert.ok(await getApplication(db, app))

    await db.query(`UPDATE persons SET deleted_at = now() WHERE id = $1`, [p])
    assert.equal(await getApplication(db, app), null, '氏名が見える窓を残さない')
    assert.deepEqual(await getApplicationTimeline(db, app), [])
    assert.deepEqual(await getApplicationEvaluations(db, app), [])
    await db.close()
  })
})

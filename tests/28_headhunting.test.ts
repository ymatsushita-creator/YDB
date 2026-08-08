import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { all, maybeOne, scalar, type Db } from '../src/db/client.ts'
import {
  baseFixture, makeSeason, makePerson, makeChannel, makeTouchpoint, deletePerson, jst,
  type Season,
} from './support/fixtures.ts'

/**
 * ヘッドハンティング（実行⑨。0016 / 0017）の検証。
 *
 * 画面の見た目ではなく、**記録層と集計定義**を固定する。
 * 「見た目が良くなった」は検証ではない（HANDOFF 12節）。
 */

const stateId = (db: Db, code: string) =>
  scalar<string>(db, `SELECT id FROM approach_states WHERE code = $1`, [code])

async function addApproach(db: Db, args: {
  personId: string; seasonId: string; code: string; staffId: string
  occurredAt: string; correctsId?: string
}): Promise<string> {
  return scalar<string>(db, `
    INSERT INTO approach_events
      (person_id, season_id, approach_state_id, occurred_at, recorded_by_staff_id,
       is_correction, corrects_event_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
  [args.personId, args.seasonId, await stateId(db, args.code), args.occurredAt,
    args.staffId, args.correctsId !== undefined, args.correctsId ?? null])
}

const currentState = (db: Db, personId: string, seasonId: string) =>
  maybeOne<{ approach_code: string }>(db, `
    SELECT approach_code FROM v_person_approach_state
     WHERE person_id = $1 AND season_id = $2`, [personId, seasonId])

const onList = async (db: Db, personId: string, seasonId: string) =>
  (await scalar<number>(db, `
    SELECT count(*)::int FROM v_headhunting_list
     WHERE person_id = $1 AND season_id = $2`, [personId, seasonId])) > 0

describe('アプローチの記録層（0016）', () => {
  let db: Db
  let staffId: string
  let schoolId: string
  let season: Season
  let personId: string

  before(async () => {
    db = await freshDb()
    const base = await baseFixture(db)
    staffId = base.staffId
    schoolId = base.schoolId
    season = await makeSeason(db, { year: 2026 })
  })

  after(async () => { await db.close() })

  beforeEach(async () => { personId = await makePerson(db, schoolId) })

  test('現在の状態は最新の出来事から導かれる（上書きカラムを持たない）', async () => {
    await addApproach(db, {
      personId, seasonId: season.id, code: 'not_approached',
      staffId, occurredAt: jst('2025-10-01T10:00:00'),
    })
    await addApproach(db, {
      personId, seasonId: season.id, code: 'approaching',
      staffId, occurredAt: jst('2025-10-08T10:00:00'),
    })

    assert.equal((await currentState(db, personId, season.id))?.approach_code, 'approaching')
    // 前の状態も残っている。上書きなら消えている（C-22 で踏んだ形）。
    const events = await all<{ n: number }>(db,
      `SELECT count(*)::int AS n FROM approach_events WHERE person_id = $1`, [personId])
    assert.equal(events[0]!.n, 2)
  })

  test('人×年度の現在の状態は高々1行（ビュー全体の性質）', async () => {
    for (const [i, code] of ['not_approached', 'considering', 'approaching'].entries()) {
      await addApproach(db, {
        personId, seasonId: season.id, code,
        staffId, occurredAt: jst(`2025-10-0${i + 1}T10:00:00`),
      })
    }
    // 種別ごとに読んでも抜ける。ビュー全体の性質で検査する（A-18 の教訓）。
    const dup = await all(db, `
      SELECT person_id, season_id FROM v_person_approach_state
       GROUP BY person_id, season_id HAVING count(*) > 1`)
    assert.deepEqual(dup, [])
  })

  test('更新も削除もできない（追記専用）', async () => {
    const id = await addApproach(db, {
      personId, seasonId: season.id, code: 'considering',
      staffId, occurredAt: jst('2025-10-01T10:00:00'),
    })
    await assert.rejects(
      () => db.query(`UPDATE approach_events SET note = 'x' WHERE id = $1`, [id]),
      /append-only/)
    await assert.rejects(
      () => db.query(`DELETE FROM approach_events WHERE id = $1`, [id]),
      /append-only/)
  })

  test('打ち消しの追記で訂正でき、訂正を訂正すると元に戻る', async () => {
    await addApproach(db, {
      personId, seasonId: season.id, code: 'considering',
      staffId, occurredAt: jst('2025-10-01T10:00:00'),
    })
    // 「見送り」を押し間違えた。
    const wrong = await addApproach(db, {
      personId, seasonId: season.id, code: 'declined',
      staffId, occurredAt: jst('2025-10-05T10:00:00'),
    })
    assert.equal((await currentState(db, personId, season.id))?.approach_code, 'declined')
    assert.equal(await onList(db, personId, season.id), false)

    // 打ち消して「検討中」に直す。
    const fix = await addApproach(db, {
      personId, seasonId: season.id, code: 'considering',
      staffId, occurredAt: jst('2025-10-05T10:00:00'), correctsId: wrong,
    })
    assert.equal((await currentState(db, personId, season.id))?.approach_code, 'considering')
    assert.equal(await onList(db, personId, season.id), true)

    // 訂正のほうが誤りだった。打ち消すと元の「見送り」が復活する（逆仕訳）。
    await addApproach(db, {
      personId, seasonId: season.id, code: 'declined',
      staffId, occurredAt: jst('2025-10-05T10:00:00'), correctsId: fix,
    })
    assert.equal((await currentState(db, personId, season.id))?.approach_code, 'declined')
  })

  test('自分で自分を打ち消す行は作れない', async () => {
    const id = await addApproach(db, {
      personId, seasonId: season.id, code: 'considering',
      staffId, occurredAt: jst('2025-10-01T10:00:00'),
    })
    await assert.rejects(() => db.query(`
      INSERT INTO approach_events
        (id, person_id, season_id, approach_state_id, occurred_at,
         recorded_by_staff_id, is_correction, corrects_event_id)
      SELECT $1, person_id, season_id, approach_state_id, occurred_at,
             recorded_by_staff_id, true, $1
        FROM approach_events WHERE id = $1`, [id]))
  })

  test('1つの行を打ち消す訂正行は1つだけ', async () => {
    const id = await addApproach(db, {
      personId, seasonId: season.id, code: 'considering',
      staffId, occurredAt: jst('2025-10-01T10:00:00'),
    })
    await addApproach(db, {
      personId, seasonId: season.id, code: 'approaching',
      staffId, occurredAt: jst('2025-10-01T10:00:00'), correctsId: id,
    })
    await assert.rejects(() => addApproach(db, {
      personId, seasonId: season.id, code: 'scheduling',
      staffId, occurredAt: jst('2025-10-01T10:00:00'), correctsId: id,
    }))
  })

  test('終端状態に達した人はリストから外れる', async () => {
    await addApproach(db, {
      personId, seasonId: season.id, code: 'approaching',
      staffId, occurredAt: jst('2025-10-01T10:00:00'),
    })
    assert.equal(await onList(db, personId, season.id), true)
    await addApproach(db, {
      personId, seasonId: season.id, code: 'declined',
      staffId, occurredAt: jst('2025-10-09T10:00:00'),
    })
    assert.equal(await onList(db, personId, season.id), false)
  })

  test('個人情報の削除依頼を受けた人はリストから外れる（状態は残る）', async () => {
    await addApproach(db, {
      personId, seasonId: season.id, code: 'approaching',
      staffId, occurredAt: jst('2025-10-01T10:00:00'),
    })
    await deletePerson(db, personId, jst('2025-10-10T10:00:00'))

    assert.equal(await onList(db, personId, season.id), false)
    // 記録そのものは消さない。集計から外すだけである。
    assert.equal((await currentState(db, personId, season.id))?.approach_code, 'approaching')
  })

  test('年度が違えば状態も別（人×年度で持つ）', async () => {
    const other = await makeSeason(db, { year: 2027 })
    await addApproach(db, {
      personId, seasonId: season.id, code: 'approaching',
      staffId, occurredAt: jst('2025-10-01T10:00:00'),
    })
    assert.equal(await onList(db, personId, season.id), true)
    assert.equal(await onList(db, personId, other.id), false)
  })
})

describe('確度スコア（0017）', () => {
  let db: Db
  let staffId: string
  let schoolId: string
  let channelId: string

  /**
   * 年度はテストごとに新しく作る。
   *
   * 同じ年度を使い回すと、前のテストが作った候補者と凍結が残り、
   * 順位も母集団も混ざる。最初にそれで3件落ちた ―― 落ちてくれたおかげで
   * 気づけたが、通ってしまえば「母集団を絞れている」と誤認したままになる。
   */
  let seasonSeq = 2030
  const freshSeason = () => makeSeason(db, { year: ++seasonSeq })

  before(async () => {
    db = await freshDb()
    const base = await baseFixture(db)
    staffId = base.staffId
    schoolId = base.schoolId
    channelId = await makeChannel(db, '説明会')
  })

  after(async () => { await db.close() })

  const makeRuleSet = async (version: number) => scalar<string>(db, `
    INSERT INTO scoring_rule_sets (version, created_by_staff_id)
    VALUES ($1, $2) RETURNING id`, [version, staffId])

  const addRule = (ruleSetId: string, r: {
    type: string; key: string; comparator?: string; threshold?: number
    points: number; halfLife?: number; order: number
  }) => db.query(`
    INSERT INTO scoring_rules
      (rule_set_id, condition_type, target_key, comparator, threshold, points,
       decay_half_life_days, sort_order)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
  [ruleSetId, r.type, r.key, r.comparator ?? null, r.threshold ?? null,
    r.points, r.halfLife ?? null, r.order])

  /**
   * リストに載っていて、接点が n 件ある人。
   *
   * 接点は年度の窓（募集開始〜選考終了）の中に置く。外に置くと
   * v_touchpoint_season がその年度に帰属させず、接点0件の人になる。
   */
  const makeCandidate = async (season: Season, touchpoints: number, lastDay: string) => {
    const personId = await makePerson(db, schoolId)
    for (let i = 0; i < touchpoints; i++) {
      await makeTouchpoint(db, personId, channelId, jst(`${lastDay}T1${i}:00:00`))
    }
    await addApproach(db, {
      personId, seasonId: season.id, code: 'considering',
      staffId, occurredAt: jst(`${season.year - 1}-10-01T10:00:00`),
    })
    return personId
  }

  /** その年度の窓に入る日。makeSeason は前年9月〜当年2月で作る。 */
  const dayIn = (season: Season, mmdd: string) => `${season.year - 1}-${mmdd}`

  test('規則が0件なら1行も凍結しない（全員0%にしない）', async () => {
    const season = await freshSeason()
    const rs = await makeRuleSet(90)
    await makeCandidate(season, 2, dayIn(season, '10-02'))
    const written = await scalar<number>(db,
      `SELECT compute_score_snapshots($1, $2, $3::date, $3::date)`,
      [rs, season.id, dayIn(season, '11-01')])
    assert.equal(written, 0)
  })

  test('規則が指せる事実は語彙で閉じている（綴り違いを黙って0点にしない）', async () => {
    const rs = await makeRuleSet(91)
    await assert.rejects(
      () => addRule(rs, { type: 'existence', key: 'has_referal', points: 10, order: 1 }),
      /target_key/)
    // 条件種別に合わない語彙も通さない。存在の有無に「直近何日」は無い。
    await assert.rejects(
      () => addRule(rs, { type: 'existence', key: 'touchpoint_count', points: 10, order: 2 }),
      /target_key/)
  })

  test('減衰は recency_days にしか付けられない', async () => {
    const rs = await makeRuleSet(92)
    await assert.rejects(
      () => addRule(rs, {
        type: 'existence', key: 'has_referral', points: 10, halfLife: 30, order: 1,
      }),
      /decay/)
  })

  test('確度は満点を超えない。分母は正の点の合計', async () => {
    const season = await freshSeason()
    const rs = await makeRuleSet(93)
    await addRule(rs, { type: 'count_threshold', key: 'touchpoint_count', comparator: '>=', threshold: 1, points: 30, order: 1 })
    await addRule(rs, { type: 'count_threshold', key: 'touchpoint_count', comparator: '>=', threshold: 2, points: 70, order: 2 })
    await makeCandidate(season, 5, dayIn(season, '10-02'))

    await db.query(`SELECT compute_score_snapshots($1, $2, $3::date, $3::date)`,
      [rs, season.id, dayIn(season, '11-01')])
    const row = await maybeOne<{ confidence_ratio: string; max_points: number }>(db, `
      SELECT confidence_ratio, max_points FROM v_candidate_confidence_latest
       WHERE season_id = $1`, [season.id])
    assert.equal(Number(row!.max_points), 100)
    assert.equal(Number(row!.confidence_ratio), 1)
  })

  test('母集団はヘッドハンティング対象者だけ（見送りは凍結されない）', async () => {
    const season = await freshSeason()
    const rs = await makeRuleSet(94)
    await addRule(rs, { type: 'count_threshold', key: 'touchpoint_count', comparator: '>=', threshold: 1, points: 10, order: 1 })

    const kept = await makeCandidate(season, 1, dayIn(season, '10-02'))
    const dropped = await makeCandidate(season, 1, dayIn(season, '10-02'))
    await addApproach(db, {
      personId: dropped, seasonId: season.id, code: 'declined',
      staffId, occurredAt: jst(`${season.year - 1}-10-20T10:00:00`),
    })
    // リストに一度も載っていない人。
    await makePerson(db, schoolId)

    await db.query(`SELECT compute_score_snapshots($1, $2, $3::date, $3::date)`,
      [rs, season.id, dayIn(season, '11-02')])
    const rows = await all<{ person_id: string }>(db, `
      SELECT person_id FROM score_snapshots WHERE season_id = $1`, [season.id])
    assert.deepEqual(rows.map((r) => r.person_id), [kept])
  })

  test('同じ算出日で2度凍結すると落ちる（黙って上書きしない）', async () => {
    const season = await freshSeason()
    const rs = await makeRuleSet(95)
    await addRule(rs, { type: 'count_threshold', key: 'touchpoint_count', comparator: '>=', threshold: 1, points: 10, order: 1 })
    await makeCandidate(season, 1, dayIn(season, '10-02'))

    await db.query(`SELECT compute_score_snapshots($1, $2, $3::date, $3::date)`,
      [rs, season.id, dayIn(season, '11-03')])
    await assert.rejects(() => db.query(
      `SELECT compute_score_snapshots($1, $2, $3::date, $3::date)`,
      [rs, season.id, dayIn(season, '11-03')]))
  })

  test('基準日が離れるほど減衰する', async () => {
    const season = await freshSeason()
    const rs = await makeRuleSet(96)
    await addRule(rs, {
      type: 'recency_days', key: 'last_touchpoint_on', threshold: 400,
      points: 100, halfLife: 30, order: 1,
    })
    await makeCandidate(season, 1, dayIn(season, '10-02'))

    await db.query(`SELECT compute_score_snapshots($1, $2, $3::date, $4::date)`,
      [rs, season.id, dayIn(season, '11-04'), dayIn(season, '11-01')])
    await db.query(`SELECT compute_score_snapshots($1, $2, $3::date, $4::date)`,
      [rs, season.id, dayIn(season, '11-05'), dayIn(season, '12-01')])

    const rows = await all<{ total_points: number }>(db, `
      SELECT total_points FROM score_snapshots
       WHERE season_id = $1 ORDER BY calculated_on`, [season.id])
    assert.equal(rows.length, 2)
    assert.ok(Number(rows[1]!.total_points) < Number(rows[0]!.total_points),
      '基準日が後ろなら点は減るはず')
  })

  test('前回が無い年度では「変動なし」ではなく「前回なし」', async () => {
    const season = await freshSeason()
    const rs = await makeRuleSet(97)
    await addRule(rs, { type: 'count_threshold', key: 'touchpoint_count', comparator: '>=', threshold: 0, points: 10, order: 1 })
    const personId = await makePerson(db, schoolId)
    await addApproach(db, {
      personId, seasonId: season.id, code: 'considering',
      staffId, occurredAt: jst(`${season.year - 1}-10-01T10:00:00`),
    })
    await db.query(`SELECT compute_score_snapshots($1, $2, $3::date, $3::date)`,
      [rs, season.id, dayIn(season, '11-01')])

    const row = await maybeOne<{ has_previous_run: boolean; rank_delta: number | null }>(db, `
      SELECT has_previous_run, rank_delta FROM v_candidate_confidence_latest
       WHERE season_id = $1`, [season.id])
    assert.equal(row!.has_previous_run, false)
    assert.equal(row!.rank_delta, null)
  })
})

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { all, scalar, maybeOne, type Db } from '../src/db/client.ts'
import {
  addCandidate, addPartnerReach, ingestFormResponse, autoMatchFormResponse,
  nextCandidateNumber,
} from '../src/commands/intake.ts'
import {
  listUnmatchedResponses, listChannelResponses, listCandidateNumbers,
} from '../src/queries/intake.ts'

/**
 * 候補者追加・アプローチ追加・フォーム回答（実行⑩。依頼者の指示）。
 *
 * 固定したいのは5つ ――
 *   ① 番号は期ごとに1から。**欠番を詰めない**
 *   ② 1回の保存で、人・番号・接点・アプローチ状態が**同時に**立つ
 *   ③ 途中で落ちたら**何も残らない**
 *   ④ フォーム回答は**書き換えられない**。変えてよいのは結び付けだけ
 *   ⑤ 自動接合は**1人に絞れたときだけ**。氏名では結び付けない
 */

const EMPTY_CANDIDATE = {
  familyName: '', givenName: '', familyNameKana: '', givenNameKana: '',
  birthDate: '', faculty: '', email: '', phone: '', lineUserId: '',
  note: '', contactedOn: '', formResponseId: '',
}

const EMPTY_RESPONSE = {
  source: 'google_forms', formKey: 'F1',
  submittedAt: '2026-03-01T10:00:00+09:00',
  respondentName: '', respondentKana: '', respondentEmail: '',
  respondentPhone: '', respondentLine: '', channelAnswer: '',
  raw: {} as Record<string, unknown>,
}

describe('候補者追加とフォーム回答', () => {
  let db: Db
  let seasonId: string
  let otherSeasonId: string
  let schoolId: string
  let staffId: string
  let lineChannel: string

  before(async () => {
    db = await freshDb({ seeds: 'production' })
    seasonId = await scalar<string>(db, `SELECT id FROM seasons WHERE cohort_number = 2`)
    otherSeasonId = await scalar<string>(db, `SELECT id FROM seasons WHERE cohort_number = 3`)
    schoolId = await scalar<string>(db,
      `INSERT INTO schools (name) VALUES ('架空追加高校') RETURNING id`)
    staffId = await scalar<string>(db, `
      INSERT INTO staffs (display_name, email)
      VALUES ('架空 受付', 'intake@example.test') RETURNING id`)
    lineChannel = await scalar<string>(db, `SELECT id FROM channels WHERE name = 'LINE'`)
  })

  after(async () => { await db.close() })

  let seq = 0
  const add = (over: Partial<Parameters<typeof addCandidate>[1]> = {}) => {
    seq += 1
    return addCandidate(db, {
      ...EMPTY_CANDIDATE,
      seasonId, schoolId, staffId, channelId: lineChannel,
      familyName: `架空${seq}`,
      ...over,
    })
  }

  test('★ 1回の保存で、人・番号・接点・アプローチ状態が同時に立つ', async () => {
    const r = await add()
    assert.equal(r.ok, true)
    if (!r.ok) return

    const person = await maybeOne(db, `SELECT 1 FROM persons WHERE id = $1`, [r.personId])
    assert.ok(person, '人')
    const number = await maybeOne<{ number: number }>(db, `
      SELECT number FROM candidate_numbers WHERE person_id = $1 AND season_id = $2`,
    [r.personId, seasonId])
    assert.equal(number?.number, r.number, '番号')
    const tp = await maybeOne(db,
      `SELECT 1 FROM touchpoints WHERE person_id = $1`, [r.personId])
    assert.ok(tp, '接点')
    const ap = await maybeOne(db, `
      SELECT 1 FROM approach_events WHERE person_id = $1 AND season_id = $2`,
    [r.personId, seasonId])
    assert.ok(ap, 'アプローチ状態')

    // ★ 一覧に載る（`v_headhunting_list` はアプローチ状態がある人だけを出す）。
    const listed = await maybeOne(db, `
      SELECT 1 FROM v_headhunting_list WHERE person_id = $1 AND season_id = $2`,
    [r.personId, seasonId])
    assert.ok(listed, '一覧に載る')
  })

  test('★ 番号は期ごとに1から。期が違えば別に振る', async () => {
    const fresh = await freshDb({ seeds: 'production' })
    const s2 = await scalar<string>(fresh, `SELECT id FROM seasons WHERE cohort_number = 2`)
    const s3 = await scalar<string>(fresh, `SELECT id FROM seasons WHERE cohort_number = 3`)
    const sc = await scalar<string>(fresh,
      `INSERT INTO schools (name) VALUES ('架空') RETURNING id`)
    const st = await scalar<string>(fresh, `
      INSERT INTO staffs (display_name, email) VALUES ('架空','a@example.test') RETURNING id`)
    const ch = await scalar<string>(fresh, `SELECT id FROM channels WHERE name = 'LINE'`)
    const mk = (season: string, name: string) => addCandidate(fresh, {
      ...EMPTY_CANDIDATE, seasonId: season, schoolId: sc, staffId: st,
      channelId: ch, familyName: name,
    })

    const a = await mk(s2, 'あ')
    const b = await mk(s2, 'い')
    const c = await mk(s3, 'う')
    assert.equal(a.ok && a.number, 1)
    assert.equal(b.ok && b.number, 2)
    assert.equal(c.ok && c.number, 1, '期が違えば1から')
    await fresh.close()
  })

  test('★ 欠番を詰めない', async () => {
    const before = await nextCandidateNumber(db, seasonId)
    const r = await add()
    assert.equal(r.ok && r.number, before)

    // 番号を消しても、次は詰めずに進む。
    await db.query(`DELETE FROM candidate_numbers WHERE season_id = $1 AND number = $2`,
      [seasonId, before])
    const after = await nextCandidateNumber(db, seasonId)
    assert.equal(after, before, '最大値+1で振るので、消した番号は欠番のまま埋まらない')
  })

  test('同じ期に同じ番号は2つ置けない', async () => {
    const personId = await scalar<string>(db, `
      INSERT INTO persons (family_name, given_name, school_id)
      VALUES ('架空', '重複', $1) RETURNING id`, [schoolId])
    const n = await nextCandidateNumber(db, seasonId)
    await db.query(`
      INSERT INTO candidate_numbers (season_id, person_id, number) VALUES ($1, $2, $3)`,
    [seasonId, personId, n])
    await assert.rejects(() => db.query(`
      INSERT INTO candidate_numbers (season_id, person_id, number)
      VALUES ($1, gen_random_uuid(), $2)`, [seasonId, n]))
  })

  test('★ 途中で落ちたら何も残らない', async () => {
    const before = await scalar<number>(db, 'SELECT count(*)::int FROM persons')
    // 記録した人が居ないので、アプローチ状態の書き込みで落ちる。
    const r = await add({ staffId: '00000000-0000-0000-0000-000000000000' })
    assert.equal(r.ok, false)
    const after = await scalar<number>(db, 'SELECT count(*)::int FROM persons')
    assert.equal(after, before, '人だけが残る、ということが起きない')
  })

  test('姓が無ければ登録できない', async () => {
    const r = await add({ familyName: '   ' })
    assert.equal(r.ok, false)
    assert.equal(!r.ok && r.reason, 'required')
  })

  test('生年月日もメールも無いまま登録できる（0023）', async () => {
    const r = await add({ birthDate: '', email: '' })
    assert.equal(r.ok, true)
  })

  /**
   * ★ 必須は姓だけである（0054。依頼者の指示 2026-08-24）。
   *
   *   固定したいのは「通ること」だけではない ――
   *   **未選択が非活性のプレースホルダへ寄り、人が一覧から消えないこと。**
   *   NULL 可にしていたら、ここで内部結合に落ちて消えていた（0023）。
   */
  test('学校も流入元も入力者も未選択で登録できる（0054）', async () => {
    const r = await add({ schoolId: '', channelId: '', staffId: '' })
    assert.equal(r.ok, true)
  })

  test('★ 未選択は非活性のプレースホルダへ寄る。人は消えない（0054）', async () => {
    const r = await add({ schoolId: '', channelId: '', staffId: '' })
    assert.equal(r.ok, true)
    const personId = r.ok ? r.personId : ''

    const school = await maybeOne<{ name: string; is_active: boolean }>(db, `
      SELECT s.name, s.is_active FROM persons p
        JOIN schools s ON s.id = p.school_id
       WHERE p.id = $1`, [personId])
    assert.equal(school?.name, '学校未記録')
    assert.equal(school?.is_active, false)

    const channel = await maybeOne<{ name: string; is_active: boolean }>(db, `
      SELECT c.name, c.is_active FROM touchpoints t
        JOIN channels c ON c.id = t.channel_id
       WHERE t.person_id = $1`, [personId])
    assert.equal(channel?.name, '流入元不明')
    assert.equal(channel?.is_active, false)

    // ★ 入力者だけは寄せ先を作らない。**NULL のまま記録する**（0054）。
    //   「入力者未記録」という職員を1人置くと、本番シードが職員を持たない
    //   という壁（tests/22）と 0007 の引き継ぎ（tests/52）が壊れる。
    const staff = await maybeOne<{ recorded_by_staff_id: string | null }>(db,
      `SELECT recorded_by_staff_id FROM approach_events WHERE person_id = $1`,
      [personId])
    assert.equal(staff?.recorded_by_staff_id, null)

    // ★ 一覧から消えないこと。ここが 0023 が守った点である。
    const listed = await maybeOne(db,
      `SELECT 1 FROM v_headhunting_list WHERE person_id = $1`, [personId])
    assert.ok(listed, '未選択で登録した人が一覧から消えている')
  })

  test('寄せ先は選択肢に出ない（非活性）（0054）', async () => {
    const active = await all<{ name: string }>(db,
      `SELECT name FROM channels WHERE is_active`)
    assert.ok(!active.some((c) => c.name === '流入元不明'))
    // 入力者の寄せ先は**そもそも作っていない**（0054）。
    const staffs = await all<{ display_name: string }>(db,
      `SELECT display_name FROM staffs`)
    assert.ok(!staffs.some((s) => s.display_name === '入力者未記録'))
  })

  /**
   * ★ 未選択と「形が違う値」は別である。
   *   未選択は寄せるが、UUID でない値や実在しない UUID は今まで通り落とす ――
   *   黙って別の行へ入れない。
   */
  test('選ばれた値が実在しなければ、今まで通り落ちる（0054）', async () => {
    const gone = '00000000-0000-4000-8000-000000000000'
    const bad = await add({ schoolId: 'not-a-uuid' })
    assert.equal(!bad.ok && bad.reason, 'school_not_found')
    const a = await add({ schoolId: gone })
    assert.equal(!a.ok && a.reason, 'school_not_found')
    const b = await add({ channelId: gone })
    assert.equal(!b.ok && b.reason, 'channel_not_found')
    const c = await add({ staffId: gone })
    assert.equal(!c.ok && c.reason, 'staff_not_found')
  })

  test('★ フォーム回答は2回届いても1件', async () => {
    const a = await ingestFormResponse(db, { ...EMPTY_RESPONSE, responseKey: 'R1' })
    const b = await ingestFormResponse(db, { ...EMPTY_RESPONSE, responseKey: 'R1' })
    assert.equal(a.id, b.id)
    const n = await scalar<number>(db,
      `SELECT count(*)::int FROM form_responses WHERE response_key = 'R1'`)
    assert.equal(n, 1)
  })

  test('★ 届いた回答そのものは書き換えられない', async () => {
    const r = await ingestFormResponse(db, {
      ...EMPTY_RESPONSE, responseKey: 'R2', respondentName: '架空 太郎',
    })
    await assert.rejects(
      () => db.query(`UPDATE form_responses SET respondent_name = '別人' WHERE id = $1`, [r.id]),
      /書き換え|届いた回答/,
    )
    // 結び付けだけは変えられる。
    const personId = await scalar<string>(db, `
      INSERT INTO persons (family_name, given_name, school_id)
      VALUES ('架空', '接合', $1) RETURNING id`, [schoolId])
    await db.query(`
      UPDATE form_responses
         SET person_id = $2, matched_at = now(), match_method = 'manual'
       WHERE id = $1`, [r.id, personId])
    const after = await maybeOne<{ person_id: string }>(db,
      `SELECT person_id FROM form_responses WHERE id = $1`, [r.id])
    assert.equal(after?.person_id, personId)
  })

  test('結び付けの3つは、そろうか、そろわないか', async () => {
    const r = await ingestFormResponse(db, { ...EMPTY_RESPONSE, responseKey: 'R3' })
    await assert.rejects(() => db.query(
      `UPDATE form_responses SET matched_at = now() WHERE id = $1`, [r.id]))
  })

  test('★ 自動接合は、1人に絞れたときだけ', async () => {
    const mail = 'only.one@example.test'
    await db.query(`
      INSERT INTO persons (family_name, given_name, school_id, email)
      VALUES ('架空', '一意', $1, $2)`, [schoolId, mail])
    const hit = await ingestFormResponse(db, {
      ...EMPTY_RESPONSE, responseKey: 'R4', respondentEmail: mail,
    })
    assert.equal(hit.matched, true)

    // 同じメールの人が2人居たら、結び付けない。
    const dup = 'two@example.test'
    await db.query(`
      INSERT INTO persons (family_name, given_name, school_id, email)
      VALUES ('架空', '双子A', $1, $2), ('架空', '双子B', $1, $2)`, [schoolId, dup])
    const miss = await ingestFormResponse(db, {
      ...EMPTY_RESPONSE, responseKey: 'R5', respondentEmail: dup,
    })
    assert.equal(miss.matched, false, '2人に当たったら手で選ばせる')
  })

  test('★ 氏名では結び付けない（同姓同名で取り違える）', async () => {
    await db.query(`
      INSERT INTO persons (family_name, given_name, school_id)
      VALUES ('同姓', '同名', $1)`, [schoolId])
    const r = await ingestFormResponse(db, {
      ...EMPTY_RESPONSE, responseKey: 'R6', respondentName: '同姓 同名',
    })
    assert.equal(r.matched, false)
    assert.equal(await autoMatchFormResponse(db, r.id), false)
  })

  test('チャネルは名前が完全に一致したときだけ写す', async () => {
    const ok = await ingestFormResponse(db, {
      ...EMPTY_RESPONSE, responseKey: 'R7', channelAnswer: 'LINE',
    })
    const okRow = await maybeOne<{ channel_id: string | null }>(db,
      `SELECT channel_id FROM form_responses WHERE id = $1`, [ok.id])
    assert.equal(okRow?.channel_id, lineChannel)

    const ng = await ingestFormResponse(db, {
      ...EMPTY_RESPONSE, responseKey: 'R8', channelAnswer: 'ライン（友だちから）',
    })
    const ngRow = await maybeOne<{ channel_id: string | null; channel_answer: string }>(db,
      `SELECT channel_id, channel_answer FROM form_responses WHERE id = $1`, [ng.id])
    assert.equal(ngRow?.channel_id, null, '似ている名前へ寄せない')
    assert.equal(ngRow?.channel_answer, 'ライン（友だちから）', '生の文字列は残す')
  })

  test('チャネル別の集計は、写せなかった回答も落とさない', async () => {
    const rows = await listChannelResponses(db, undefined)
    const unmapped = rows.find((r) => r.channel_name === null)
    assert.ok(unmapped, '写せなかった回答も1行として出る')
  })

  test('結び付いていない回答だけが、候補者追加の一覧に出る', async () => {
    const rows = await listUnmatchedResponses(db)
    assert.equal(rows.every((r) => r.form_response_id), true)
    const matchedShown = await scalar<number>(db, `
      SELECT count(*)::int FROM form_responses WHERE person_id IS NOT NULL`)
    assert.ok(matchedShown > 0, '結び付いた回答も存在する（＝一覧が絞れている証拠）')
  })

  test('フォーム回答から登録すると、その回答が結び付く', async () => {
    const r = await ingestFormResponse(db, {
      ...EMPTY_RESPONSE, responseKey: 'R9', respondentName: '架空 接合先',
    })
    const added = await add({ formResponseId: r.id })
    assert.equal(added.ok, true)
    const row = await maybeOne<{ person_id: string; match_method: string }>(db,
      `SELECT person_id, match_method FROM form_responses WHERE id = $1`, [r.id])
    assert.equal(row?.person_id, added.ok ? added.personId : null)
    assert.equal(row?.match_method, 'manual')
  })

  test('すでに結び付いている回答は、黙って付け替えない', async () => {
    const r = await ingestFormResponse(db, { ...EMPTY_RESPONSE, responseKey: 'R10' })
    await add({ formResponseId: r.id })
    const again = await add({ formResponseId: r.id })
    assert.equal(again.ok, false)
    assert.equal(!again.ok && again.reason, 'form_response_taken')
  })

  test('番号の一覧は、その期のものだけ', async () => {
    const rows = await listCandidateNumbers(db, seasonId)
    const other = await listCandidateNumbers(db, otherSeasonId)
    assert.ok(rows.length > 0)
    assert.equal(other.length, 0)
  })
})

describe('アプローチ追加', () => {
  let db: Db
  let seasonId: string

  before(async () => {
    db = await freshDb({ seeds: 'production' })
    seasonId = await scalar<string>(db, `SELECT id FROM seasons WHERE cohort_number = 2`)
  })
  after(async () => { await db.close() })

  test('団体が無ければ、その場で作る', async () => {
    const r = await addPartnerReach(db, {
      partnerId: '', partnerName: '架空大学', category: '大学',
      contactName: '架空 窓口', contactEmail: 'w@example.test',
      occurredOn: '2026-03-01', method: 'メール', estimatedReach: '120', note: '説明会の依頼',
    })
    assert.equal(r.ok, true)
    const n = await scalar<number>(db,
      `SELECT count(*)::int FROM partner_reaches WHERE partner_id = $1`,
      [r.ok ? r.partnerId : null])
    assert.equal(n, 1)
  })

  test('同じ名前の団体を2つ作らない', async () => {
    const a = await addPartnerReach(db, {
      partnerId: '', partnerName: '架空大学', category: '', contactName: '',
      contactEmail: '', occurredOn: '2026-03-02', method: '', estimatedReach: '', note: '',
    })
    const rows = await all<{ id: string }>(db,
      `SELECT id FROM partners WHERE name = '架空大学'`)
    assert.equal(rows.length, 1)
    assert.equal(a.ok && a.partnerId, rows[0]!.id)
  })

  test('★ 推定リーチは空のままにできる（0 は「届かなかった」）', async () => {
    const r = await addPartnerReach(db, {
      partnerId: '', partnerName: '架空高専', category: '', contactName: '',
      contactEmail: '', occurredOn: '2026-03-03', method: '', estimatedReach: '', note: '',
    })
    assert.equal(r.ok, true)
    const row = await maybeOne<{ estimated_reach: number | null }>(db, `
      SELECT estimated_reach FROM partner_reaches
       WHERE partner_id = $1 ORDER BY occurred_on DESC LIMIT 1`,
    [r.ok ? r.partnerId : null])
    assert.equal(row?.estimated_reach, null)
  })

  test('年度は日付から決める。期の外なら紐づかないまま', async () => {
    const inside = await addPartnerReach(db, {
      partnerId: '', partnerName: '架空商業', category: '', contactName: '',
      contactEmail: '', occurredOn: '2026-03-01', method: '', estimatedReach: '', note: '',
    })
    const outside = await addPartnerReach(db, {
      partnerId: '', partnerName: '架空商業', category: '', contactName: '',
      contactEmail: '', occurredOn: '2020-01-01', method: '', estimatedReach: '', note: '',
    })
    assert.equal(inside.ok && outside.ok, true)
    const rows = await all<{ occurred_on: Date; season_id: string | null }>(db, `
      SELECT occurred_on, season_id FROM partner_reaches
       WHERE partner_id = $1 ORDER BY occurred_on`, [inside.ok ? inside.partnerId : null])
    assert.equal(rows[0]!.season_id, null, '期の外は紐づかない')
    assert.equal(rows[1]!.season_id, seasonId)
  })

  test('日付が日付の形をしていなければ入らない', async () => {
    const r = await addPartnerReach(db, {
      partnerId: '', partnerName: '架空', category: '', contactName: '',
      contactEmail: '', occurredOn: '3/1', method: '', estimatedReach: '', note: '',
    })
    assert.equal(r.ok, false)
    assert.equal(!r.ok && r.reason, 'bad_date')
  })

  test('推定リーチに数でない値は入らない', async () => {
    const r = await addPartnerReach(db, {
      partnerId: '', partnerName: '架空', category: '', contactName: '',
      contactEmail: '', occurredOn: '2026-03-01', method: '', estimatedReach: '多数', note: '',
    })
    assert.equal(r.ok, false)
    assert.equal(!r.ok && r.reason, 'bad_estimate')
  })
})

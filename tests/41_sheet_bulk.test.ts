import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { all, maybeOne, scalar, type Db } from '../src/db/client.ts'
import {
  saveCandidateSheet, savePartnerSheet, saveReachSheet, saveStaffSheet,
} from '../src/commands/sheet.ts'
import { listCandidateSheetRows, listPartnerSheetRows } from '../src/queries/sheet.ts'
import { addStaff } from '../src/commands/staff.ts'

/**
 * 表（スプシ形式）のまとめて保存（実行⑫。依頼者の指示）。
 *
 * 依頼者が決めたこと ―― **1行＝1件、追加も表の上で、まとめて保存。**
 * **通る行だけ入れて、不正行は表に残す。**
 *
 * 固定したいのは8つ ――
 *   ① 通る行だけ入る。**不正行は入らず、理由が返る**（10行中9行を捨てない）
 *   ② 空行は無視する（表に空行が残っているのは普通の状態）
 *   ③ 既存行を直すと**プロフィールの変更履歴が1版積まれる**（一括でも省かない）
 *   ④ 何も変えていない行は触らない（**押すたびに版が増えない**）
 *   ⑤ 表に出していない列（紹介者）を**空で消さない**
 *   ⑥ 一覧に居ない人の行を受け取らない（出した母集団と保存できる母集団を揃える）
 *   ⑦ アプローチ状態を変えた行だけ、新しい状態を積む
 *   ⑧ 団体と接触の表も同じ規則（通る行だけ・履歴は積む）
 */

const EMPTY_ROW = {
  personId: '', familyName: '', givenName: '', familyNameKana: '', givenNameKana: '',
  birthDate: '', schoolId: '', faculty: '', email: '', phone: '', lineUserId: '',
  note: '', channelId: '', contactedOn: '', approachStateId: '', staffId: '',
  archive: '',
}

describe('表のまとめて保存', () => {
  let db: Db
  let seasonId: string
  let schoolId: string
  let staffId: string
  let channelId: string

  const revisionCount = (personId: string) => scalar<string>(db, `
    SELECT count(*) FROM person_profile_revisions WHERE person_id = $1`, [personId])
    .then(Number)

  before(async () => {
    db = await freshDb({ seeds: 'production' })
    seasonId = await scalar<string>(db, `SELECT id FROM seasons WHERE cohort_number = 2`)
    schoolId = await scalar<string>(db,
      `INSERT INTO schools (name) VALUES ('架空表高校') RETURNING id`)
    channelId = await scalar<string>(db, `SELECT id FROM channels WHERE name = 'LINE'`)

    // ★ 入力者を足す画面が無かったので、コマンドから作れることも一緒に確かめる。
    const staff = await addStaff(db, { displayName: '架空 入力者' })
    assert.equal(staff.ok, true)
    if (!staff.ok) throw new Error('unreachable')
    staffId = staff.staffId
  })

  after(async () => { await db.close() })


  // -----------------------------------------------------------
  // ①② 部分失敗と空行
  // -----------------------------------------------------------
  test('通る行だけ入り、不正行は入らずに理由が返る。空行は無視する', async () => {
    const result = await saveCandidateSheet(db, {
      seasonId,
      rows: [
        // 通る
        { ...EMPTY_ROW, familyName: '架空一', givenName: '太郎', schoolId, channelId, staffId },
        // 姓が空（`addCandidate` の規則で落ちる）
        { ...EMPTY_ROW, givenName: '名だけ', schoolId, channelId, staffId },
        // メールの形が違う
        {
          ...EMPTY_ROW, familyName: '架空三', schoolId, channelId, staffId,
          email: 'これはメールではない',
        },
        // 空行（打っていない行）
        { ...EMPTY_ROW },
        // 通る
        { ...EMPTY_ROW, familyName: '架空五', givenName: '五郎', schoolId, channelId, staffId },
      ],
    })

    assert.equal(result.created, 2, '通る2行だけ入る')
    assert.equal(result.failed, 2)
    assert.equal(result.rows.length, 4, '空行は結果にも出さない')

    const failed = result.rows.filter((r) => !r.ok)
    assert.deepEqual(failed.map((r) => r.index), [1, 2],
      '失敗した行は、打った位置のまま返す（表に貼り直せること）')
    assert.equal(failed[0]?.ok === false && failed[0].message, '姓は空にできない。')
    assert.equal(failed[1]?.ok === false && failed[1].message, 'メールの形が違う。')

    const names = await all<{ family_name: string }>(db, `
      SELECT p.family_name FROM candidate_numbers n
        JOIN persons p ON p.id = n.person_id
       WHERE n.season_id = $1 AND p.family_name LIKE '架空%'
       ORDER BY n.number`, [seasonId])
    assert.deepEqual(names.map((n) => n.family_name), ['架空一', '架空五'],
      '落ちた行は1件も入っていない')
  })

  // -----------------------------------------------------------
  // ③④⑤ 既存行の更新
  // -----------------------------------------------------------
  test('既存行を直すと履歴が1版積まれ、変えていない行は触らない', async () => {
    const rows = await listCandidateSheetRows(db, seasonId)
    const target = rows.find((r) => r.family_name === '架空一')!
    const untouched = rows.find((r) => r.family_name === '架空五')!

    // 表に出していない列（紹介者）を持っている状態にしておく。
    await db.query(`UPDATE persons SET referrer_person_id = $2 WHERE id = $1`,
      [target.person_id, untouched.person_id])

    const before = await revisionCount(target.person_id)
    const beforeUntouched = await revisionCount(untouched.person_id)

    const toRow = (r: typeof target, over: Partial<typeof EMPTY_ROW> = {}) => ({
      ...EMPTY_ROW,
      personId: r.person_id,
      familyName: r.family_name, givenName: r.given_name,
      familyNameKana: r.family_name_kana ?? '', givenNameKana: r.given_name_kana ?? '',
      birthDate: r.birth_date ?? '', schoolId: r.school_id, faculty: r.faculty ?? '',
      email: r.email ?? '', phone: r.phone ?? '', lineUserId: r.line_user_id ?? '',
      note: r.note ?? '', approachStateId: r.approach_state_id ?? '', staffId,
      ...over,
    })

    const result = await saveCandidateSheet(db, {
      seasonId,
      rows: [
        toRow(target, { phone: '090-0000-0000' }),  // 直す
        toRow(untouched),                            // そのまま
      ],
    })

    assert.equal(result.updated, 1)
    assert.equal(result.failed, 0)
    assert.equal(await revisionCount(target.person_id), before + 1,
      '一括でも履歴は1行ずつ積む')
    assert.equal(await revisionCount(untouched.person_id), beforeUntouched,
      '変えていない行で版を増やさない')

    const saved = await maybeOne<{ phone: string; referrer_person_id: string | null }>(db,
      `SELECT phone, referrer_person_id FROM persons WHERE id = $1`, [target.person_id])
    assert.equal(saved?.phone, '090-0000-0000')
    assert.equal(saved?.referrer_person_id, untouched.person_id,
      '表に出していない列を、空で上書きして消さない')
  })

  // -----------------------------------------------------------
  // ⑥ 母集団（番号が無い人も出る）
  // -----------------------------------------------------------
  test('★ 候補者番号が無くても、その期のアプローチ状態があれば表に出る', async () => {
    // 番号は実行⑩で足した仕組みで、それ以前の記録は持っていない。
    // 番号だけを母集団にしたら、**デモの2期で既存行が1件も出なかった。**
    const personId = await scalar<string>(db, `
      INSERT INTO persons (family_name, given_name, school_id)
      VALUES ('架空番号なし', '子', $1) RETURNING id`, [schoolId])
    await db.query(`
      INSERT INTO approach_events
        (person_id, season_id, approach_state_id, occurred_at, recorded_by_staff_id)
      SELECT $1, $2, s.id, now(), $3 FROM approach_states s WHERE s.code = 'not_approached'`,
    [personId, seasonId, staffId])

    const rows = await listCandidateSheetRows(db, seasonId)
    const row = rows.find((r) => r.person_id === personId)
    assert.ok(row, '番号が無くても表に出る')
    assert.equal(row?.number, null)

    // 出しているなら直せること（出す母集団と操作できる母集団を一致させる）。
    const saved = await saveCandidateSheet(db, {
      seasonId,
      rows: [{
        ...EMPTY_ROW, personId, familyName: '架空番号なし', givenName: '子',
        schoolId, phone: '090-1111-2222', staffId,
      }],
    })
    assert.equal(saved.updated, 1)
    assert.equal(saved.failed, 0)
  })

  // -----------------------------------------------------------
  // ⑥ 母集団の外
  // -----------------------------------------------------------
  test('この期の一覧に居ない人の行は受け取らない', async () => {
    const outsider = await scalar<string>(db, `
      INSERT INTO persons (family_name, given_name, school_id)
      VALUES ('架空外', '部', $1) RETURNING id`, [schoolId])

    const result = await saveCandidateSheet(db, {
      seasonId,
      rows: [{
        ...EMPTY_ROW, personId: outsider, familyName: '架空外', givenName: '部',
        schoolId, staffId,
      }],
    })
    assert.equal(result.failed, 1)
    assert.equal(result.rows[0]?.ok === false && result.rows[0].message,
      'その候補者はこの期の一覧に居ない。')
  })

  // -----------------------------------------------------------
  // ⑦ アプローチ状態
  // -----------------------------------------------------------
  test('アプローチ状態を変えた行だけ、新しい状態を積む', async () => {
    const rows = await listCandidateSheetRows(db, seasonId)
    const target = rows.find((r) => r.family_name === '架空一')!
    const nextState = await scalar<string>(db, `
      SELECT id FROM approach_states WHERE code <> 'not_approached' AND is_active
       ORDER BY sort_order LIMIT 1`)

    const events = () => scalar<string>(db, `
      SELECT count(*) FROM approach_events WHERE person_id = $1`, [target.person_id])
      .then(Number)
    const before = await events()

    const base = {
      ...EMPTY_ROW,
      personId: target.person_id,
      familyName: target.family_name, givenName: target.given_name,
      familyNameKana: target.family_name_kana ?? '',
      givenNameKana: target.given_name_kana ?? '',
      birthDate: target.birth_date ?? '', schoolId: target.school_id,
      faculty: target.faculty ?? '', email: target.email ?? '',
      phone: target.phone ?? '', lineUserId: target.line_user_id ?? '',
      note: target.note ?? '', staffId,
    }

    // 同じ状態で保存し直しても積まない。
    await saveCandidateSheet(db, {
      seasonId, rows: [{ ...base, approachStateId: target.approach_state_id ?? '' }],
    })
    assert.equal(await events(), before, '同じ状態なら記録を積まない')

    // 変えたら積む。
    const changed = await saveCandidateSheet(db, {
      seasonId, rows: [{ ...base, approachStateId: nextState }],
    })
    assert.equal(changed.updated, 1)
    assert.equal(await events(), before + 1)
  })

  // -----------------------------------------------------------
  // 既存の人にも接点を積める（C-183。依頼者の指示）
  // -----------------------------------------------------------
  test('★ 既存行に流入元と日を入れると、接点が1件積まれる（上書きしない）', async () => {
    const first = await saveCandidateSheet(db, {
      seasonId,
      rows: [{ ...EMPTY_ROW, familyName: '架空接', givenName: '点', schoolId,
        channelId, contactedOn: '2026-01-10', staffId }],
    })
    const r0 = first.rows[0]!
    const personId = r0.ok ? (r0.id ?? '') : ''
    assert.notEqual(personId, '')
    const count = () => scalar<string>(db,
      `SELECT count(*) FROM touchpoints WHERE person_id = $1`, [personId]).then(Number)
    assert.equal(await count(), 1)

    // 既存行として、別の日で積む。**前の接点は消えない。**
    const again = await saveCandidateSheet(db, {
      seasonId,
      rows: [{ ...EMPTY_ROW, personId, familyName: '架空接', givenName: '点',
        schoolId, channelId, contactedOn: '2026-02-20', staffId }],
    })
    assert.equal(again.rows[0]!.ok, true)
    assert.equal(await count(), 2, '接点が積まれていない（上書きしている）')

    // 同じチャネル・同じ日は二度積まない。
    await saveCandidateSheet(db, {
      seasonId,
      rows: [{ ...EMPTY_ROW, personId, familyName: '架空接', givenName: '点',
        schoolId, channelId, contactedOn: '2026-02-20', staffId }],
    })
    assert.equal(await count(), 2, '同じ接点を二度積んでいる')
  })

  test('★ アーカイブを選ぶと一覧から外れるが、記録は消えない（C-184）', async () => {
    const made = await saveCandidateSheet(db, {
      seasonId,
      rows: [{ ...EMPTY_ROW, familyName: '架空棚', givenName: '入', schoolId,
        channelId, staffId }],
    })
    const m0 = made.rows[0]!
    const personId = m0.ok ? (m0.id ?? '') : ''
    assert.notEqual(personId, '')

    const r = await saveCandidateSheet(db, {
      seasonId,
      rows: [{ ...EMPTY_ROW, personId, familyName: '架空棚', givenName: '入',
        schoolId, archive: 'archive', staffId }],
    })
    assert.equal(r.rows[0]!.ok, true)

    // 行は残っている。消えたのではなく、しまわれた。
    const alive = await scalar<string>(db,
      `SELECT count(*) FROM persons WHERE id = $1`, [personId]).then(Number)
    assert.equal(alive, 1, '行ごと消している')
    const archived = await scalar<string>(db,
      `SELECT count(*) FROM persons WHERE id = $1 AND deleted_at IS NOT NULL`,
      [personId]).then(Number)
    assert.equal(archived, 1, 'アーカイブされていない')
  })

  // -----------------------------------------------------------
  // ⑧ 団体と接触の表
  // -----------------------------------------------------------
  test('団体の表：関わり方は履歴を積み、窓口のメールの形は見る', async () => {
    const partnerId = await scalar<string>(db,
      `INSERT INTO partners (name) VALUES ('架空表団体') RETURNING id`)

    const bad = await savePartnerSheet(db, {
      rows: [{
        partnerId, category: '大学', contactName: '窓口 太郎',
        contactEmail: 'メールではない', contactDepartment: '', internalOwner: '',
        engagement: '共催先', recommendationSeats: '', partneredOn: '', bestContactPeriod: '', location: '',
      recommendationStateId: '', staffId,
      }],
    })
    assert.equal(bad.failed, 1, '窓口のメールが読めない行は保存しない')

    const good = await savePartnerSheet(db, {
      rows: [{
        partnerId, category: '大学', contactName: '窓口 太郎',
        contactEmail: 'mado@example.test',
        // 0034（応募管理表 011 にあってDBに無かった2列）。
        contactDepartment: '企画部社会共創課', internalOwner: '架空 職員',
        engagement: '共催先', recommendationSeats: '', partneredOn: '', bestContactPeriod: '', location: '',
      recommendationStateId: '', staffId,
      }],
    })
    assert.equal(good.updated, 1)

    const sheet = (await listPartnerSheetRows(db)).find((p) => p.partner_id === partnerId)
    assert.equal(sheet?.engagement, '共催先')
    assert.equal(sheet?.category, '大学')
    assert.equal(sheet?.contact_department, '企画部社会共創課')
    assert.equal(sheet?.internal_owner, '架空 職員')
    assert.equal(sheet?.engagement_revisions, 1, '関わり方の変更は版に残る')
  })

  test('担当部署・社内担当だけ直しても保存される（0034）', async () => {
    // ★ 足した列が「表には出るが保存されない」ことが無いよう、
    //   **その列だけを変えた行**で確かめる（他の列の変更に相乗りさせない）。
    const partnerId = await scalar<string>(db,
      `INSERT INTO partners (name) VALUES ('架空部署団体') RETURNING id`)
    const r = await savePartnerSheet(db, {
      rows: [{
        partnerId, category: '', contactName: '', contactEmail: '',
        contactDepartment: 'QREC', internalOwner: '', engagement: '', recommendationSeats: '', partneredOn: '', bestContactPeriod: '', location: '',
      recommendationStateId: '', staffId,
      }],
    })
    assert.equal(r.updated, 1)
    const sheet = (await listPartnerSheetRows(db)).find((p) => p.partner_id === partnerId)
    assert.equal(sheet?.contact_department, 'QREC')
    // 空白だけの値は入れない（0015 の形）。
    const blank = await savePartnerSheet(db, {
      rows: [{
        partnerId, category: '', contactName: '', contactEmail: '',
        contactDepartment: '　', internalOwner: '', engagement: '', recommendationSeats: '', partneredOn: '', bestContactPeriod: '', location: '',
      recommendationStateId: '', staffId,
      }],
    })
    assert.equal(blank.failed, 0)
    const after = (await listPartnerSheetRows(db)).find((p) => p.partner_id === partnerId)
    assert.equal(after?.contact_department, null, '空白だけなら空にする（空文字を残さない）')
  })

  test('接触の表：新しい行は足し、既存行は直して版を積む', async () => {
    const partnerId = await scalar<string>(db,
      `INSERT INTO partners (name) VALUES ('架空接触表団体') RETURNING id`)

    const added = await saveReachSheet(db, {
      partnerId,
      rows: [
        { reachId: '', occurredOn: '2026-03-01', method: '訪問', estimatedReach: '120', note: '説明会', staffId },
        { reachId: '', occurredOn: '', method: '', estimatedReach: '', note: '', staffId },
        { reachId: '', occurredOn: '2026/03/02', method: '電話', estimatedReach: '', note: '', staffId },
      ],
    })
    assert.equal(added.created, 1)
    assert.equal(added.failed, 1, '日付が読めない行は入らない')
    assert.equal(added.rows.length, 2, '空行は無視する')

    const reachId = await scalar<string>(db,
      `SELECT id FROM partner_reaches WHERE partner_id = $1`, [partnerId])

    const fixed = await saveReachSheet(db, {
      partnerId,
      rows: [{
        reachId, occurredOn: '2026-03-01', method: '訪問',
        estimatedReach: '90', note: '説明会', staffId,
      }],
    })
    assert.equal(fixed.updated, 1)
    assert.equal(
      await scalar<string>(db,
        `SELECT count(*) FROM partner_reach_revisions WHERE reach_id = $1`, [reachId])
        .then(Number),
      1, '直したら版が残る')
  })
})

// -----------------------------------------------------------
// ⑨ 入力者の表（実行⑬。依頼者の指示でスプシ形式にした）
// -----------------------------------------------------------
describe('入力者の表', () => {
  let db: Db

  test('まとめて足せて、打ち間違いを直せる', async () => {
    db = await freshDb({ seeds: 'production' })

    // ★ まとめて足す ―― 素のフォームでは1件ずつしか足せなかった。
    const added = await saveStaffSheet(db, {
      rows: [
        { staffId: '', displayName: '架空 一郎' },
        { staffId: '', displayName: '架空 二郎' },
        { staffId: '', displayName: '   ' },   // 空白だけ ＝ 空行。無視する
      ],
    })
    assert.equal(added.created, 2)
    assert.equal(added.failed, 0, '空白だけの行は「失敗」ではなく空行として飛ばす')

    const ids = added.rows.filter((r) => r.ok).map((r) => (r as { id: string }).id)
    assert.equal(ids.length, 2)

    // ★ 打ち間違いを直せる（直す道が無いと、間違った名前が選択肢に残り続ける）。
    const renamed = await saveStaffSheet(db, {
      rows: [{ staffId: ids[0]!, displayName: '架空 壱郎' }],
    })
    assert.equal(renamed.updated, 1)
    const name = await scalar<string>(db,
      `SELECT display_name FROM staffs WHERE id = $1`, [ids[0]!])
    assert.equal(name, '架空 壱郎')

    // ★ 変わっていない行は触らない（意味の無い更新をしない）。
    const again = await saveStaffSheet(db, {
      rows: [{ staffId: ids[0]!, displayName: '架空 壱郎' }],
    })
    assert.equal(again.updated, 0)

    // ★ 空の名前は入れない。行は失敗として残り、理由が出る。
    const empty = await saveStaffSheet(db, {
      rows: [{ staffId: ids[0]!, displayName: '' }],
    })
    assert.equal(empty.failed, 1)
    assert.equal(await scalar<string>(db,
      `SELECT display_name FROM staffs WHERE id = $1`, [ids[0]!]), '架空 壱郎',
    '失敗した行は記録を変えない')

    // ★ 同姓同名は**止めない**（C-96 の判断のまま）。既に居ることは伝える。
    const dup = await saveStaffSheet(db, {
      rows: [{ staffId: '', displayName: '架空 壱郎' }],
    })
    assert.equal(dup.created, 1, '実在の同姓同名を登録できなくしない')
    assert.equal((dup.rows[0] as { lead?: string }).lead, '同じ名前が既に居る')

    await db.close()
  })


})

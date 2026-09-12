import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { one, scalar, type Db } from '../src/db/client.ts'
import { baseFixture, makePerson, makeSeason } from './support/fixtures.ts'
import { setPersonApproachState, updatePersonProfile } from '../src/commands/profile.ts'

describe('候補者プロフィール編集（0018）', () => {
  let db: Db
  let personId: string
  let schoolId: string
  let staffId: string

  before(async () => {
    db = await freshDb()
    const base = await baseFixture(db)
    schoolId = base.schoolId
    staffId = base.staffId
    personId = await makePerson(db, schoolId, {
      familyName: '編集前', givenName: '候補者', email: 'before@example.test',
    })
  })

  after(async () => { await db.close() })

  const input = (changes: Partial<Parameters<typeof updatePersonProfile>[1]> = {}) => ({
    personId,
    familyName: '編集後',
    givenName: '候補者',
    familyNameKana: 'へんしゅうご',
    givenNameKana: 'こうほしゃ',
    birthDate: '2006-04-05',
    schoolId,
    faculty: '経営学部',
    email: 'after@example.test',
    phone: '090-1234-5678',
    lineUserId: '',
    referrerPersonId: '',
    note: '担当者メモ',
    ...changes,
  })

  test('現在値と変更後スナップショットを同時に保存する', async () => {
    const photo = 'data:image/png;base64,aGVsbG8='
    assert.deepEqual(await updatePersonProfile(db, input({ photoDataUrl: photo })), { ok: true })

    const person = await one<{
      family_name: string; email: string; photo_data_url: string; faculty: string
    }>(db, `SELECT family_name, email, photo_data_url, faculty FROM persons WHERE id = $1`, [personId])
    assert.deepEqual(person, {
      family_name: '編集後',
      email: 'after@example.test',
      photo_data_url: photo,
      faculty: '経営学部',
    })

    const revision = await one<{
      revision_number: number; family_name: string; photo_data_url: string
    }>(db, `SELECT revision_number, family_name, photo_data_url
             FROM person_profile_revisions WHERE person_id = $1`, [personId])
    assert.equal(Number(revision.revision_number), 1)
    assert.equal(revision.family_name, '編集後')
    assert.equal(revision.photo_data_url, photo)
  })

  test('2回目の編集は履歴を上書きせず2版目を追記する', async () => {
    assert.deepEqual(await updatePersonProfile(db, input({
      familyName: '再編集', email: 'second@example.test', photoDataUrl: undefined,
    })), { ok: true })
    assert.equal(Number(await scalar(db,
      `SELECT count(*) FROM person_profile_revisions WHERE person_id = $1`, [personId])), 2)
    assert.deepEqual((await db.query<{ revision_number: number; family_name: string }>(
      `SELECT revision_number, family_name FROM person_profile_revisions
        WHERE person_id = $1 ORDER BY revision_number`, [personId])).rows, [
      { revision_number: 1, family_name: '編集後' },
      { revision_number: 2, family_name: '再編集' },
    ])
  })

  test('履歴は更新も削除もできない', async () => {
    await assert.rejects(
      db.query(`UPDATE person_profile_revisions SET family_name = '改ざん'
                 WHERE person_id = $1`, [personId]),
      /append-only/,
    )
    await assert.rejects(
      db.query(`DELETE FROM person_profile_revisions WHERE person_id = $1`, [personId]),
      /append-only/,
    )
  })

  test('必須値・メール・写真形式を検証する', async () => {
    assert.deepEqual(await updatePersonProfile(db, input({ familyName: '' })),
      { ok: false, reason: 'required' })
    assert.deepEqual(await updatePersonProfile(db, input({ email: 'not-an-email' })),
      { ok: false, reason: 'bad_email' })
    assert.deepEqual(await updatePersonProfile(db, input({ photoDataUrl: 'data:text/plain;base64,eA==' })),
      { ok: false, reason: 'bad_photo' })
  })

  /**
   * ★ 0054（姓だけ必須）は**登録だけ**に効いていて、編集は取り残されていた。
   *   学校が未記録の候補者は、表で名前を1文字直すだけで
   *   `school_not_found` に落ちて保存できなかった（2026-09-12 の指摘）。
   *   寄せ先は登録と同じ「学校未記録」である。
   */
  test('学校を未選択にしたまま編集できる。寄せ先は登録と同じ（0054）', async () => {
    assert.deepEqual(await updatePersonProfile(db, input({ schoolId: '' })), { ok: true })
    const school = await one<{ name: string; is_active: boolean }>(db, `
      SELECT s.name, s.is_active FROM persons p
        JOIN schools s ON s.id = p.school_id WHERE p.id = $1`, [personId])
    assert.equal(school.name, '学校未記録')
    assert.equal(school.is_active, false)
  })

  test('学校未記録の人を、そのプレースホルダのまま編集できる（0054）', async () => {
    const placeholder = await scalar<string>(db,
      `SELECT id FROM schools WHERE name = '学校未記録'`)
    assert.deepEqual(
      await updatePersonProfile(db, input({ schoolId: placeholder, familyName: '再編集' })),
      { ok: true })
    assert.equal(await scalar(db,
      `SELECT family_name FROM persons WHERE id = $1`, [personId]), '再編集')
  })

  test('実在しない学校は今まで通り落とす', async () => {
    assert.deepEqual(
      await updatePersonProfile(db, input({ schoolId: '00000000-0000-0000-0000-000000000000' })),
      { ok: false, reason: 'school_not_found' })
    assert.deepEqual(await updatePersonProfile(db, input({ schoolId: 'not-a-uuid' })),
      { ok: false, reason: 'school_not_found' })
  })

  test('アプローチ状態の編集は担当者付きイベントとして追記する', async () => {
    const season = await makeSeason(db, { year: 2031 })
    // sort_order は 0016 が初期値5件で 10〜90 を使っている。
    // マスタは「追加と非活性化で運用する」ので追加自体は正しいが、
    // 既存の並び順とぶつからない値を選ぶ（UNIQUE 制約がある）。
    const stateId = await scalar<string>(db, `
      INSERT INTO approach_states (code, label, sort_order)
      VALUES ('contactable', '連絡可能', 15) RETURNING id`)

    assert.deepEqual(await setPersonApproachState(db, {
      personId, seasonId: season.id, stateId, staffId, note: '面談後に更新',
    }), { ok: true })
    assert.deepEqual(await one<{ approach_state_id: string; recorded_by_staff_id: string; note: string }>(db, `
      SELECT approach_state_id, recorded_by_staff_id, note
        FROM approach_events WHERE person_id = $1`, [personId]), {
      approach_state_id: stateId,
      recorded_by_staff_id: staffId,
      note: '面談後に更新',
    })
  })

  test('削除済み候補者は編集できない', async () => {
    await db.query(`UPDATE persons SET deleted_at = now() WHERE id = $1`, [personId])
    assert.deepEqual(await updatePersonProfile(db, input()),
      { ok: false, reason: 'person_not_found' })
  })
})

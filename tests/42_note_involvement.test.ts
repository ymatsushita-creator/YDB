import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { maybeOne, scalar, type Db } from '../src/db/client.ts'
import { addCandidate } from '../src/commands/intake.ts'
import { addPersonNote, INVOLVEMENT_MAX } from '../src/commands/note.ts'
import { listPersonNotes } from '../src/queries/borderline.ts'

/**
 * 候補者メモの「どう関わったか」（実行⑫。依頼者の指示）。
 *
 * 依頼者が決めたこと ―― **自由入力の1行・任意・書いた人＝関わった人。**
 *
 * ★ マスタにしていない。したがって**集計できない。**
 *   `staff_roles.role`（D-5）と同じ性質の列がもう1つ増えることを承知の判断である。
 *   表記が揺れたまま溜まるので、後から数えたくなったら語を受け取ってマスタ化する。
 *
 * 固定したいのは5つ ――
 *   ① 任意。書かなくてもメモは入る（未記入は NULL。空文字を入れない）
 *   ② 書けば残り、画面が読む経路（有効なメモのビュー）にも出る
 *   ③ 空白だけは「書いていない」と読む。**改行・タブ・全角スペースも空白**（0015）
 *   ④ 記録層は空白だけの関わり方を受け取らない（コマンドを通らない書き込みへの最後の砦）
 *   ⑤ 長すぎる関わり方は弾く。1行に収まる長さを超えたら保存しない
 */

const EMPTY_CANDIDATE = {
  familyName: '', givenName: '', familyNameKana: '', givenNameKana: '',
  birthDate: '', faculty: '', email: '', phone: '', lineUserId: '',
  note: '', contactedOn: '', formResponseId: '',
}

describe('メモの関わり方', () => {
  let db: Db
  let personId: string

  before(async () => {
    db = await freshDb({ seeds: 'production' })
    const seasonId = await scalar<string>(db, `SELECT id FROM seasons WHERE cohort_number = 2`)
    const schoolId = await scalar<string>(db,
      `INSERT INTO schools (name) VALUES ('架空関わり高校') RETURNING id`)
    const staffId = await scalar<string>(db, `
      INSERT INTO staffs (display_name, email)
      VALUES ('架空 運営', 'involvement@example.test') RETURNING id`)
    const channelId = await scalar<string>(db, `SELECT id FROM channels WHERE name = 'LINE'`)

    const r = await addCandidate(db, {
      ...EMPTY_CANDIDATE,
      seasonId, schoolId, staffId, channelId,
      familyName: '架空', givenName: '関わり',
    })
    assert.equal(r.ok, true)
    if (!r.ok) throw new Error('unreachable')
    personId = r.personId
  })

  after(async () => { await db.close() })

  // -----------------------------------------------------------
  // ① 任意
  // -----------------------------------------------------------
  test('関わり方を書かなくてもメモは入る（未記入は NULL）', async () => {
    const r = await addPersonNote(db, {
      personId, authorName: '架空 運営',
      notedAt: '2026-03-01T10:00', body: '関わり方は書かない',
    })
    assert.equal(r.ok, true)
    if (!r.ok) throw new Error('unreachable')

    const row = await maybeOne<{ involvement: string | null }>(db,
      `SELECT involvement FROM person_notes WHERE id = $1`, [r.noteId])
    assert.equal(row?.involvement, null, '未記入は NULL。空文字を入れない')
  })

  // -----------------------------------------------------------
  // ② 書けば残る
  // -----------------------------------------------------------
  test('書いた関わり方は、画面が読む経路にも出る', async () => {
    const r = await addPersonNote(db, {
      personId, authorName: '架空 運営',
      notedAt: '2026-03-02T10:00', body: '学校で立ち話した',
      involvement: 'イベントで会って、その場で話した',
    })
    assert.equal(r.ok, true)
    if (!r.ok) throw new Error('unreachable')

    // 画面は「有効なメモ」のビューを読む。列を足したときに
    // ビューを作り直し忘れると、保存はできるのに画面に出ない。
    const notes = await listPersonNotes(db, personId)
    const saved = notes.find((n) => n.note_id === r.noteId)
    assert.equal(saved?.involvement, 'イベントで会って、その場で話した')
  })

  // -----------------------------------------------------------
  // ③ 空白だけは「書いていない」
  // -----------------------------------------------------------
  test('空白だけの関わり方は未記入として読む（改行・タブ・全角スペースも空白）', async () => {
    for (const blank of ['   ', '\n', '\t', '　']) {
      const r = await addPersonNote(db, {
        personId, authorName: '架空 運営',
        notedAt: '2026-03-03T10:00', body: `空白の種類: ${JSON.stringify(blank)}`,
        involvement: blank,
      })
      assert.equal(r.ok, true, `空白だけで落としてはいけない: ${JSON.stringify(blank)}`)
      if (!r.ok) throw new Error('unreachable')

      const row = await maybeOne<{ involvement: string | null }>(db,
        `SELECT involvement FROM person_notes WHERE id = $1`, [r.noteId])
      assert.equal(row?.involvement, null,
        `空白だけは NULL にする: ${JSON.stringify(blank)}`)
    }
  })

  // -----------------------------------------------------------
  // ④ 記録層の最後の砦
  // -----------------------------------------------------------
  test('記録層は、空白だけの関わり方を受け取らない', async () => {
    for (const blank of [' ', '\n', '\t', '　']) {
      await assert.rejects(
        () => db.query(`
          INSERT INTO person_notes (person_id, author_name, noted_at, body, involvement)
          VALUES ($1, '架空 運営', TIMESTAMPTZ '2026-03-04 10:00+09', '制約の確認', $2)`,
        [personId, blank]),
        `空白だけを通してはいけない: ${JSON.stringify(blank)}`,
      )
    }
  })

  // -----------------------------------------------------------
  // ⑤ 長さ
  // -----------------------------------------------------------
  test('1行に収まらない長さの関わり方は弾く', async () => {
    const r = await addPersonNote(db, {
      personId, authorName: '架空 運営',
      notedAt: '2026-03-05T10:00', body: '長すぎる関わり方',
      involvement: 'あ'.repeat(INVOLVEMENT_MAX + 1),
    })
    assert.equal(r.ok, false)
    if (r.ok) throw new Error('unreachable')
    assert.equal(r.reason, 'involvement_too_long')

    const ok = await addPersonNote(db, {
      personId, authorName: '架空 運営',
      notedAt: '2026-03-05T10:01', body: '上限ちょうど',
      involvement: 'あ'.repeat(INVOLVEMENT_MAX),
    })
    assert.equal(ok.ok, true, '上限ちょうどは通る')
  })
})

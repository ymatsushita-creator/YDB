import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { freshDb } from '../src/db/testing.ts'
import { scalar, all, maybeOne, type Db } from '../src/db/client.ts'
import { baseFixture, makeSeason, makePerson } from './support/fixtures.ts'
import { setConfidence, listConfidenceGrades } from '../src/commands/confidence.ts'

/**
 * 確度は記入するもの（0039。C-151。依頼者の指示）。
 *
 * 固定したいのは5つ ――
 *   ① 段階と**基準の原文**が、依頼者の文面のまま入っている
 *   ② 記入できる。記入者は必須（自己申告でよい）
 *   ③ **いつでも書き直せる**。書き直すと現在値が変わる
 *   ④ ★ 書き直しても**前の記入は消えない**（打ち消し行が積まれる）
 *   ⑤ 期ごとに別。2期がBでも3期はSでいられる
 */

const ROOT = fileURLToPath(new URL('../', import.meta.url))

describe('確度の記入（C-151）', () => {
  let db: Db
  let personId: string
  let season2: string
  let season3: string

  before(async () => {
    db = await freshDb()
    const base = await baseFixture(db)
    season2 = (await makeSeason(db, { year: 2026 })).id
    season3 = (await makeSeason(db, { year: 2027 })).id
    personId = await makePerson(db, base.schoolId, { familyName: '架空', givenName: '確度' })
  })

  test('段階は S/A/B/C の4つ。基準は依頼者の文面のまま', async () => {
    const grades = await listConfidenceGrades(db)
    assert.deepEqual(grades.map((g) => g.code), ['S', 'A', 'B', 'C'])
    const s = grades.find((g) => g.code === 'S')!
    assert.equal(s.definition, 'イベント参加or2期説明会参加/3期応募口頭内諾',
      '基準を要約・翻訳しない')
    const c = grades.find((g) => g.code === 'C')!
    assert.equal(c.definition, 'まだNEOイベント未参加/NEOに入ると良いと思う人')
  })

  test('記入すると、現在の確度になる', async () => {
    const r = await setConfidence(db, {
      personId, seasonId: season2, gradeCode: 'B', recordedBy: '運営 太郎',
    })
    assert.equal(r.ok, true)
    const now = await maybeOne<{ grade_code: string; graded_by: string }>(db,
      `SELECT grade_code, graded_by FROM v_person_confidence
        WHERE person_id = $1 AND season_id = $2`, [personId, season2])
    assert.equal(now?.grade_code, 'B')
    assert.equal(now?.graded_by, '運営 太郎')
  })

  test('記入者が空なら記入できない（自己申告でも、誰かは残す）', async () => {
    const r = await setConfidence(db, {
      personId, seasonId: season2, gradeCode: 'S', recordedBy: '   ',
    })
    assert.equal(r.ok, false)
    assert.equal(r.ok === false ? r.reason : '', 'recorded_by_required')
  })

  test('定義に無い段階は記入できない', async () => {
    const r = await setConfidence(db, {
      personId, seasonId: season2, gradeCode: 'X', recordedBy: '運営 太郎',
    })
    assert.equal(r.ok, false)
    assert.equal(r.ok === false ? r.reason : '', 'grade_not_found')
  })

  test('★ 書き直せる。そして前の記入は消えない（打ち消し行が積まれる）', async () => {
    const before = Number(await scalar(db,
      `SELECT count(*) FROM person_confidence_events WHERE person_id = $1`, [personId]))

    const r = await setConfidence(db, {
      personId, seasonId: season2, gradeCode: 'S', recordedBy: '運営 花子',
      note: '説明会に来た',
    })
    assert.equal(r.ok, true)
    assert.notEqual(r.ok === true ? r.previousEventId : null, null, '前の記入を打ち消していない')

    const now = await maybeOne<{ grade_code: string; grade_note: string | null }>(db,
      `SELECT grade_code, grade_note FROM v_person_confidence
        WHERE person_id = $1 AND season_id = $2`, [personId, season2])
    assert.equal(now?.grade_code, 'S')
    assert.equal(now?.grade_note, '説明会に来た')

    // 行は減らない。**増える**（打ち消し1行＋新しい記入1行）。
    const after = Number(await scalar(db,
      `SELECT count(*) FROM person_confidence_events WHERE person_id = $1`, [personId]))
    assert.equal(after, before + 2)

    // 最初に入れた B の行も、記録層にはそのまま残っている。
    const kept = Number(await scalar(db, `
      SELECT count(*) FROM person_confidence_events e
        JOIN confidence_grades g ON g.id = e.grade_id
       WHERE e.person_id = $1 AND g.code = 'B' AND NOT e.is_correction`, [personId]))
    assert.equal(kept, 1, '前の見立てが記録から消えている')
  })

  test('★ 期ごとに別（2期がSでも、3期はまだ未記入）', async () => {
    const three = await maybeOne(db,
      `SELECT grade_code FROM v_person_confidence WHERE person_id = $1 AND season_id = $2`,
      [personId, season3])
    assert.equal(three, null)

    await setConfidence(db, {
      personId, seasonId: season3, gradeCode: 'C', recordedBy: '運営 太郎',
    })
    const rows = await all<{ season_id: string; grade_code: string }>(db,
      `SELECT season_id, grade_code FROM v_person_confidence WHERE person_id = $1`, [personId])
    assert.equal(rows.length, 2)
    assert.equal(rows.find((r) => r.season_id === season2)?.grade_code, 'S')
    assert.equal(rows.find((r) => r.season_id === season3)?.grade_code, 'C')
  })

  test('記入は更新も削除もできない（追記専用）', async () => {
    await assert.rejects(
      () => db.query(`UPDATE person_confidence_events SET recorded_by = '別人'`),
      /追記専用|append|拒否|reject/i)
  })

  test('★ 画面は「確度の算出規則が未登録」を出さない ―― 規則で決めるのをやめた', async () => {
    const page = await readFile(join(ROOT, 'app/headhunting/page.tsx'), 'utf8')
    assert.doesNotMatch(page, /確度の算出規則が未登録/)
    assert.match(page, /setConfidenceAction/, '記入する道が画面に無い')
  })
})

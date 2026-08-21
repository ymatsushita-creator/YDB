import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { freshDb } from '../src/db/testing.ts'
import { one } from '../src/db/client.ts'
import { listCandidatesByConfidence } from '../src/queries/borderline.ts'
import { getPersonPhoto } from '../src/queries/photo.ts'
import { appCss } from './support/css.ts'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const read = (path: string) => readFile(join(ROOT, path), 'utf8')

/** 実行⑱ ④ ―― 候補者を読む2つの一覧で、候補者そのものの列を揃える。 */
describe('候補者一覧の列と顔写真（C-193）', () => {
  test('確度順リストは、候補者編集表と同じ候補者項目を並べる', async () => {
    const page = await read('app/borderline/page.tsx')
    const expected = [
      '顔写真', '番号', '姓', '名', '姓（かな）', '名（かな）', '生年月日',
      '学校', '学部・学科', 'メール', '電話番号', 'LINE ID',
      '流入元', '接点の日', 'アプローチ状態', '担当者メモ',
    ]
    for (const label of expected) {
      assert.match(page, new RegExp(`>${label}<`), `${label} が確度順リストに無い`)
    }
  })

  test('候補者編集表にも顔写真の列があり、写真は遅延取得する', async () => {
    const page = await read('app/people/new/page.tsx')
    const sheet = await read('app/_components/sheet.tsx')
    assert.match(page, /photoSrc:/, '既存行が顔写真の取得先を渡していない')
    assert.match(sheet, />顔写真</, '表に顔写真の列が無い')
    assert.match(sheet, /loading="lazy"/, '画面外の写真まで一度に取得する')
  })

  test('列をカード幅へ押し込まず、横へ送って読む', async () => {
    const page = await read('app/borderline/page.tsx')
    const css = await appCss()
    assert.match(page, /candidate-unified-table/)
    assert.match(css, /\.candidate-unified-table\s*\{[^}]*width:\s*max-content/,
      '列幅を潰さず横スクロールへ渡していない')
    assert.match(css, /\.candidate-unified-table th\s*\{[^}]*white-space:\s*nowrap/,
      '見出しが1文字ずつ折れてしまう')
  })

  test('全件の表データへ写真本体を混ぜない', async () => {
    const query = await read('src/queries/sheet.ts')
    assert.doesNotMatch(query, /p\.photo_data_url\s*(?:,|AS\s+photo_data_url)/i,
      '写真本体を全件の表クエリで運んでいる')
    assert.match(query, /photo_data_url IS NOT NULL/, '写真の有無は記録から読む')
  })

  test('確度順の問い合わせが、編集表と同じ記録値を返す', async () => {
    const db = await freshDb({ seeds: 'production' })
    const season = await one<{ id: string }>(db,
      `SELECT id FROM seasons ORDER BY enrollment_year LIMIT 1`)
    const school = await one<{ id: string }>(db,
      `INSERT INTO schools (name) VALUES ('架空一覧校') RETURNING id`)
    const staff = await one<{ id: string }>(db, `
      INSERT INTO staffs (display_name, email)
      VALUES ('架空 入力者', 'candidate-list@example.test') RETURNING id`)
    const person = await one<{ id: string }>(db, `
      INSERT INTO persons
        (family_name, given_name, family_name_kana, given_name_kana, birth_date,
         school_id, faculty, email, phone, line_user_id, note, photo_data_url)
      VALUES ('架空', '候補', 'かくう', 'こうほ', DATE '2007-04-01', $1,
              '架空学部', 'list@example.test', '000-0000-0000', 'line-test',
              '架空メモ', 'data:image/png;base64,aGVsbG8=') RETURNING id`, [school.id])
    await db.query(`INSERT INTO candidate_numbers (season_id, person_id, number)
                    VALUES ($1, $2, 1)`, [season.id, person.id])
    await db.query(`
      INSERT INTO approach_events
        (person_id, season_id, approach_state_id, occurred_at, recorded_by_staff_id)
      SELECT $1, $2, id, now(), $3 FROM approach_states WHERE code = 'not_approached'`,
    [person.id, season.id, staff.id])
    const result = await listCandidatesByConfidence(db, season.id, { limit: 2000, offset: 0 })
    assert.ok(result.rows.length > 0)
    const row = result.rows[0]!
    for (const key of [
      'number', 'family_name', 'given_name', 'family_name_kana', 'given_name_kana',
      'birth_date', 'school', 'faculty', 'email', 'phone', 'line_user_id', 'note',
      'first_channel_name', 'first_contacted_on', 'approach_label', 'has_photo',
    ]) assert.ok(key in row, `${key} が問い合わせ結果に無い`)
    assert.equal('photo_data_url' in row, false, '写真本体を一覧の行へ混ぜない')
    await db.close()
  })

  test('写真は削除済み候補者へ返さず、1人ずつ取得できる', async () => {
    const db = await freshDb({ seeds: 'production' })
    const school = await one<{ id: string }>(db,
      `INSERT INTO schools (name) VALUES ('架空写真校') RETURNING id`)
    const person = await one<{ id: string }>(db, `
      INSERT INTO persons (family_name, given_name, school_id, photo_data_url)
      VALUES ('架空', '写真', $1, 'data:image/png;base64,aGVsbG8=') RETURNING id`, [school.id])
    assert.equal((await getPersonPhoto(db, person.id))?.photo_data_url,
      'data:image/png;base64,aGVsbG8=')
    await db.query(`UPDATE persons SET anonymized_at = now() WHERE id = $1`, [person.id])
    assert.equal(await getPersonPhoto(db, person.id), null)
    assert.equal(await getPersonPhoto(db, 'not-an-id'), null)
    await db.close()
  })
})

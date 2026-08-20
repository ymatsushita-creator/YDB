import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { freshDb } from '../src/db/testing.ts'
import { scalar, maybeOne, type Db } from '../src/db/client.ts'
import { baseFixture, makeSeason } from './support/fixtures.ts'
import { addEvent, getEventKind, composeNote } from '../src/commands/event.ts'
import { saveEventSheet } from '../src/commands/sheet.ts'
import { composeBodies, involvementFor, findHeaderRow } from '../src/import/application_form_2026.ts'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const read = (p: string) => readFile(join(ROOT, p), 'utf8')

/**
 * イベントの追加（C-155）と、応募フォームの抽出（C-156）。依頼者の指示。
 */

describe('イベントを追加（C-155）', () => {
  let db: Db
  let seasonId: string
  let staffId: string

  before(async () => {
    db = await freshDb()
    const base = await baseFixture(db)
    staffId = base.staffId
    seasonId = (await makeSeason(db, { year: 2026 })).id
  })

  test('種別「イベント」があり、候補者を要らない（0040）', async () => {
    const kind = await getEventKind(db)
    assert.ok(kind, 'イベントの種別が無い')
    const requires = await scalar(db,
      `SELECT requires_person FROM appointment_kinds WHERE code = 'event'`)
    assert.equal(requires, false, 'イベントに候補者を要求すると、集客イベントが置けない')
  })

  test('1件足せる。日時は JST で置かれる', async () => {
    const r = await addEvent(db, {
      seasonId, title: '検査イベント', day: '2026-04-10',
      startsAt: '19:00', endsAt: '21:00', ownerStaffId: staffId,
    })
    assert.equal(r.ok, true)
    const row = await maybeOne<{ starts: string; ends: string }>(db, `
      SELECT to_char(starts_at AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD HH24:MI') AS starts,
             to_char(ends_at   AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD HH24:MI') AS ends
        FROM appointments WHERE title = '検査イベント'`)
    assert.equal(row?.starts, '2026-04-10 19:00')
    assert.equal(row?.ends, '2026-04-10 21:00')
  })

  test('★ 終わりの時刻を作らない（無ければ入れずに理由を返す）', async () => {
    const r = await addEvent(db, {
      seasonId, title: '終わり未定', day: '2026-04-11',
      startsAt: '19:00', endsAt: '', ownerStaffId: staffId,
    })
    assert.equal(r.ok, false)
    assert.equal(r.ok === false ? r.reason : '', 'end_required')
  })

  test('終わりが始まりより前なら入らない', async () => {
    const r = await addEvent(db, {
      seasonId, title: '逆さま', day: '2026-04-11',
      startsAt: '21:00', endsAt: '19:00', ownerStaffId: staffId,
    })
    assert.equal(r.ok === false ? r.reason : '', 'range_invalid')
  })

  test('★ 場所と URL は、見出しごと記録に残す（列を作らない）', () => {
    const note = composeNote({
      seasonId, title: 'x', day: '2026-04-10', startsAt: '19:00', endsAt: '20:00',
      ownerStaffId: staffId, place: '福岡市', url: 'https://example.test', note: '雨天中止',
    })
    assert.equal(note, '場所: 福岡市\nURL: https://example.test\n備考: 雨天中止')
  })

  test('表からまとめて足せる。空行は無視し、既に保存した行は作り直さない', async () => {
    const before = Number(await scalar(db, `SELECT count(*) FROM appointments`))
    const r = await saveEventSheet(db, {
      seasonId,
      rows: [
        { appointmentId: '', title: '表から1', day: '2026-04-12', startsAt: '10:00',
          endsAt: '12:00', ownerStaffId: staffId, place: '', url: '', note: '' },
        { appointmentId: '', title: '', day: '', startsAt: '', endsAt: '',
          ownerStaffId: '', place: '', url: '', note: '' },
        { appointmentId: '00000000-0000-0000-0000-000000000001', title: '既に保存済み',
          day: '2026-04-13', startsAt: '10:00', endsAt: '11:00',
          ownerStaffId: staffId, place: '', url: '', note: '' },
      ],
    })
    assert.equal(r.created, 1)
    assert.equal(r.failed, 0)
    assert.equal(Number(await scalar(db, `SELECT count(*) FROM appointments`)), before + 1)
  })

  test('★ 追加タブは「連携団体を追加」のすぐ下にある（依頼者の指示）', async () => {
    const shell = await read('app/_components/shell.tsx')
    const approach = shell.indexOf("{ href: '/approach/new'")
    const events = shell.indexOf("{ href: '/events/new'")
    assert.ok(approach > 0 && events > approach, '並びが指示と違う')
    assert.ok(shell.indexOf("{ href: '/people/new'") < approach, '候補者追加より上に来ている')
  })

  test('★ 追加タブは、開ける層が決まっている（押せるのに入れない、を作らない）', async () => {
    const tiers = await read('src/auth/tiers.ts')
    const shell = await read('app/_components/shell.tsx')
    // ★ 呼び名は「追加」から「編集」になった（C-168。依頼者の指示）。
    //   語で数えると、名前を変えるたびに見張りが黙る ―― **行き先で数える。**
    const links = [...shell.matchAll(/\{ href: '(\/[a-z/-]+\/new)', label: '[^']*' \}/g)]
      .map((m) => m[1]!)
    assert.ok(links.length >= 3, '追加タブが数えられていない')
    for (const href of links) {
      assert.ok(tiers.includes(`'${href}'`), `${href} が層の定義に無い`)
    }
  })
})

describe('応募フォームの抽出（C-156）', () => {
  test('見出し行は「お名前」で見つける（行番号を決め打ちしない）', () => {
    const rows = [[], ['注記'], ['タイムスタンプ', 'お名前', '動機'], ['1', '検査 太郎', '理由']]
    assert.equal(findHeaderRow(rows), 2)
  })

  test('★ 切り詰めずに、上限で分けて残す', () => {
    const long = 'あ'.repeat(1500)
    const bodies = composeBodies({
      sheet: 's', row: 1, fullName: '検査 太郎',
      entries: [
        { question: '動機', answer: long },
        { question: '自己PR', answer: long },
      ],
    })
    assert.equal(bodies.length, 2, '2000文字に収まらない回答を1枚へ詰めている')
    for (const b of bodies) assert.ok(b.length <= 2000)
    // 質問文ごと残っている（あとから何の答えか読める）。
    assert.ok(bodies[0]!.startsWith('【動機】'))
    assert.ok(bodies[1]!.startsWith('【自己PR】'))
  })

  test('札は枚数が1枚なら番号を付けない', () => {
    assert.equal(involvementFor(0, 1), '2期の応募フォーム')
    assert.equal(involvementFor(0, 3), '2期の応募フォーム（1/3）')
  })

  test('★ 表に居て新DBに居ない人を、この取り込みでは作らない', async () => {
    const source = await read('scripts/import-application-forms.ts')
    assert.doesNotMatch(source, /INSERT INTO persons/,
      '応募フォームは氏名しか鍵が無い。人を起こすと同一人物が二重になる')
    assert.match(source, /新DBに居ない人/, '入らなかった件数を出していない')
  })
})

describe('画面の配置に、欠けが無い（実行⑯）', () => {
  test('★ 追加の画面はどれも同じ骨格（見出し・年度・パンくず・カード）', async () => {
    for (const p of ['app/approach/new/page.tsx', 'app/people/new/page.tsx',
      'app/events/new/page.tsx']) {
      const s = await read(p)
      assert.match(s, /<Breadcrumb/, `${p} にパンくずが無い`)
      assert.match(s, /page-head/, `${p} に見出しの枠が無い`)
      assert.match(s, /<Card/, `${p} にカードが無い`)
    }
  })

  test("★ 'use client' は表と追従光の2つのまま（C-95 / C-104）", async () => {
    const found: string[] = []
    for (const f of await readdir(join(ROOT, 'app'), { recursive: true })) {
      if (typeof f !== 'string' || !/\.tsx?$/.test(f)) continue
      if ((await read(join('app', f))).startsWith("'use client'")) found.push(f)
    }
    assert.deepEqual(found.sort(), ['_components/sheet.tsx'])
  })
})

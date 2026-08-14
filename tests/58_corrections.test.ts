import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freshDb } from '../src/db/testing.ts'
import { all, maybeOne, scalar, type Db } from '../src/db/client.ts'
import { addStaff } from '../src/commands/staff.ts'
import { addCandidate } from '../src/commands/intake.ts'
import { addPersonNote, undoPersonNote } from '../src/commands/note.ts'
import { setPersonApproachState, correctApproachState } from '../src/commands/profile.ts'
import {
  setPartnerRecommendationState, correctPartnerRecommendation,
} from '../src/commands/partner.ts'
import { listPersonNotes } from '../src/queries/borderline.ts'

/**
 * 打ち消しで訂正する記録 ―― **道が画面まで通っているか**（実行⑮）。
 *
 * CLAUDE.md「追記専用テーブルの訂正は打ち消し行で行う」。
 * 打ち消し列（`corrects_*`）を持つ記録は**4つ**ある ――
 *
 *   status_histories                選考の遷移（0001）
 *   approach_events                 アプローチ状態（0016）
 *   person_notes                    候補者メモ（0027）
 *   partner_recommendation_events   推薦枠ステイタス（0035）
 *
 * ★ 点検すると、**画面から打ち消せるのは status_histories だけ**だった。
 *   残る3つは記録層に打ち消しの形がありながら、**SQL でしか書けない。**
 *   規律に「打ち消し行で行う」と書いてあるのに、運用者にはその道が無い。
 *
 * ★ さらに、打ち消しの**範囲**を縛っているのも status_histories だけである
 *   （0007 `check_correction_scope`）。ほかの3つは
 *   **別の人・別の団体・別の期の記録を静かに消せる。**
 *   打ち消された行は有効判定のビューから黙って落ちるので、
 *   消された側の画面には「何が起きたか」が出ない。
 *
 * ここで固定するのは3つ ――
 *   ① 打ち消しは**同じ相手の中でしか**書けない（記録層で縛る）
 *   ② 打ち消しの道が**コマンドにあり、画面から呼ばれている**
 *   ③ 打ち消し行は**正しい値を載せて元に取って代わる**（`correctDecision`
 *      と同じ形）。元の行は記録層に残り、有効判定のビューから落ちるだけ
 */

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const read = (p: string) => readFile(join(ROOT, p), 'utf8')

/** 架空の人を1人作る。学校は必須なので一緒に用意する。 */
const addPersonRow = async (db: Db, givenName: string): Promise<string> => {
  const schoolId = await scalar<string>(db, `
    INSERT INTO schools (name) VALUES ($1) RETURNING id`, [`架空${givenName}高校`])
  return await scalar<string>(db, `
    INSERT INTO persons (family_name, given_name, school_id)
    VALUES ('架空', $1, $2) RETURNING id`, [givenName, schoolId])
}

/**
 * 打ち消し列を持つ記録と、その道。
 *
 * ★ 表が増えたら**ここに書き足すまでテストが落ちる。** 記録層に打ち消しの
 *   形だけ作って画面を繋がない、が繰り返されないようにする。
 */
const CORRECTABLE = [
  {
    table: 'status_histories',
    /** 打ち消しの相手が同じでなければならない列。 */
    scope: 'application_id',
    command: 'correctDecision',
  },
  { table: 'approach_events', scope: 'person_id', command: 'correctApproachState' },
  { table: 'person_notes', scope: 'person_id', command: 'undoPersonNote' },
  {
    table: 'partner_recommendation_events',
    scope: 'partner_id',
    command: 'correctPartnerRecommendation',
  },
  /**
   * 確度の記入（0039。C-151）。
   *
   * ★ **専用の「訂正する」ボタンは無い。** 書き直すこと自体が訂正なので、
   *   `setConfidence` が前の記入を打ち消してから新しい記入を足す。
   *   道が1本しかないぶん、繋ぎ忘れが起きない。
   */
  { table: 'person_confidence_events', scope: 'person_id', command: 'setConfidence' },
] as const

describe('打ち消しの道（C-129）', () => {
  test('打ち消し列を持つ記録は、数え上げた4つで全部である', async () => {
    const found = new Set<string>()
    for (const f of (await readdir(join(ROOT, 'db/migrations'))).sort()) {
      const sql = await read(join('db/migrations', f))
      // `CREATE TABLE x (... corrects_… )` の形だけを拾う。
      for (const m of sql.matchAll(/CREATE TABLE (\w+) \(([\s\S]*?)\n\);/g)) {
        if (/\bcorrects_\w+\s+uuid/.test(m[2]!)) found.add(m[1]!)
      }
    }
    assert.deepEqual([...found].sort(), CORRECTABLE.map((c) => c.table).sort(),
      '打ち消し列を持つ記録が増減した。道（コマンドと画面）も一緒に用意すること')
  })

  test('★ 打ち消しの道がコマンドにあり、画面から呼ばれている', async () => {
    const commands = await Promise.all(
      (await readdir(join(ROOT, 'src/commands')))
        .map(async (f) => read(join('src/commands', f))))
    const screens: string[] = []
    for (const f of await readdir(join(ROOT, 'app'), { recursive: true })) {
      if (typeof f !== 'string' || !/\.tsx?$/.test(f)) continue
      screens.push(await read(join('app', f)))
    }
    for (const c of CORRECTABLE) {
      assert.ok(commands.some((s) => s.includes(`export async function ${c.command}`)),
        `${c.table} を打ち消すコマンド（${c.command}）が無い`)
      assert.ok(screens.some((s) => s.includes(c.command)),
        `${c.command} が画面から呼ばれていない（SQL でしか打ち消せない）`)
    }
  })
})

describe('置いた順が現在に出る（C-132）', () => {
  /**
   * ★ 時計が刻めないほど速く2件入ると `occurred_at` も `created_at` も同着し、
   *   現在の状態が **id（乱数）で決まる**。ここは待たずに続けて打つ ――
   *   **同着を起こすことがこのテストの目的である。**
   */
  test('推薦枠 ―― 続けて置いても、あとに置いたほうが現在になる', async () => {
    const db = await freshDb({ seeds: 'production' })
    const staff = await addStaff(db, { displayName: '架空 推薦担当' })
    assert.equal(staff.ok, true)
    if (!staff.ok) throw new Error('unreachable')
    const seasonId = await scalar<string>(db, `SELECT id FROM seasons WHERE cohort_number = 2`)
    const states = new Map((await all<{ code: string; id: string }>(db,
      `SELECT code, id FROM partner_recommendation_states`)).map((s) => [s.code, s.id]))
    const partnerId = await scalar<string>(db,
      `INSERT INTO partners (name) VALUES ('架空同着大学') RETURNING id`)

    for (const code of ['not_contacted', 'mailed', 'met', 'out_of_scope']) {
      assert.equal((await setPartnerRecommendationState(db, {
        partnerId, seasonId, stateId: states.get(code)!, staffId: staff.staffId,
      })).ok, true)
    }
    assert.equal((await maybeOne<{ state_label: string }>(db, `
      SELECT state_label FROM v_partner_recommendation_state
       WHERE partner_id = $1 AND season_id = $2`, [partnerId, seasonId]))?.state_label,
    '対象外', '置いた順が現在に出ていない（同じ瞬間に入ると id で決まっていた）')
    await db.close()
  })

  test('アプローチ ―― 続けて置いても、あとに置いたほうが現在になる', async () => {
    const db = await freshDb({ seeds: 'production' })
    const staff = await addStaff(db, { displayName: '架空 アプローチ担当' })
    assert.equal(staff.ok, true)
    if (!staff.ok) throw new Error('unreachable')
    const seasonId = await scalar<string>(db, `SELECT id FROM seasons WHERE cohort_number = 2`)
    const personId = await addPersonRow(db, '壬')
    const states = new Map((await all<{ code: string; id: string }>(db,
      `SELECT code, id FROM approach_states`)).map((s) => [s.code, s.id]))

    for (const code of ['not_approached', 'considering', 'approaching', 'scheduling']) {
      assert.equal((await setPersonApproachState(db, {
        personId, seasonId, stateId: states.get(code)!, staffId: staff.staffId, note: '',
      })).ok, true)
    }
    assert.equal((await maybeOne<{ approach_code: string }>(db, `
      SELECT approach_code FROM v_person_approach_state
       WHERE person_id = $1 AND season_id = $2`, [personId, seasonId]))?.approach_code,
    'scheduling', '置いた順が現在に出ていない')

    // 訂正も同じ ―― 打ち消し行は**打ち消す相手より必ず後ろ**に置く。
    assert.equal((await correctApproachState(db, {
      personId, seasonId, stateId: states.get('considering')!,
      staffId: staff.staffId, note: '',
    })).ok, true)
    assert.equal((await maybeOne<{ approach_code: string }>(db, `
      SELECT approach_code FROM v_person_approach_state
       WHERE person_id = $1 AND season_id = $2`, [personId, seasonId]))?.approach_code,
    'considering', '訂正が同着で負けている')
    await db.close()
  })
})

describe('打ち消しは同じ相手の中でしか書けない（C-130）', () => {
  /** 打ち消しの相手だけを取り違えた行を差し込み、記録層が拒むことを見る。 */
  const rejects = async (db: Db, sql: string, params: unknown[]) => {
    await assert.rejects(() => db.query(sql, params), /correction crosses|訂正/,
      '別の相手の記録を打ち消せてしまう')
  }

  test('別の人のメモは打ち消せない', async () => {
    const db = await freshDb({ seeds: 'production' })
    const a = await addPersonRow(db, '甲')
    const b = await addPersonRow(db, '乙')
    const note = await addPersonNote(db, {
      personId: a, authorName: '架空 運営', notedAt: '2026-08-10T10:00',
      body: '甲のメモ。',
    })
    assert.equal(note.ok, true)
    if (!note.ok) throw new Error('unreachable')

    await rejects(db, `
      INSERT INTO person_notes (person_id, author_name, noted_at, body,
                                is_correction, corrects_note_id)
      VALUES ($1, '架空 運営', now(), '乙の行から甲のメモを消す。', true, $2)`,
    [b, note.noteId])
    await db.close()
  })

  test('別の団体の推薦枠は打ち消せない', async () => {
    const db = await freshDb({ seeds: 'production' })
    const staff = await addStaff(db, { displayName: '架空 推薦担当' })
    assert.equal(staff.ok, true)
    if (!staff.ok) throw new Error('unreachable')
    const seasonId = await scalar<string>(db,
      `SELECT id FROM seasons WHERE cohort_number = 2`)
    const stateId = await scalar<string>(db, `
      SELECT id FROM partner_recommendation_states WHERE code = 'mailed'`)
    const [x, y] = [
      await scalar<string>(db, `INSERT INTO partners (name) VALUES ('架空X大学') RETURNING id`),
      await scalar<string>(db, `INSERT INTO partners (name) VALUES ('架空Y大学') RETURNING id`),
    ]
    assert.equal((await setPartnerRecommendationState(db, {
      partnerId: x, seasonId, stateId, staffId: staff.staffId,
    })).ok, true)
    const eventId = await scalar<string>(db, `
      SELECT id FROM partner_recommendation_events WHERE partner_id = $1`, [x])

    await rejects(db, `
      INSERT INTO partner_recommendation_events
        (partner_id, season_id, state_id, occurred_at, recorded_by_staff_id,
         is_correction, corrects_event_id)
      VALUES ($1, $2, $3, now(), $4, true, $5)`,
    [y, seasonId, stateId, staff.staffId, eventId])
    await db.close()
  })

  test('別の人のアプローチ状態は打ち消せない', async () => {
    const db = await freshDb({ seeds: 'production' })
    const staff = await addStaff(db, { displayName: '架空 アプローチ担当' })
    assert.equal(staff.ok, true)
    if (!staff.ok) throw new Error('unreachable')
    const seasonId = await scalar<string>(db,
      `SELECT id FROM seasons WHERE cohort_number = 2`)
    const stateId = await scalar<string>(db,
      `SELECT id FROM approach_states WHERE code = 'approaching'`)
    const a = await addPersonRow(db, '丙')
    const b = await addPersonRow(db, '丁')
    assert.equal((await setPersonApproachState(db, {
      personId: a, seasonId, stateId, staffId: staff.staffId, note: '',
    })).ok, true)
    const eventId = await scalar<string>(db,
      `SELECT id FROM approach_events WHERE person_id = $1`, [a])

    await rejects(db, `
      INSERT INTO approach_events
        (person_id, season_id, approach_state_id, occurred_at, recorded_by_staff_id,
         is_correction, corrects_event_id)
      VALUES ($1, $2, $3, now(), $4, true, $5)`,
    [b, seasonId, stateId, staff.staffId, eventId])
    await db.close()
  })

  test('★ 期をまたいでも打ち消せない（同じ団体でも別の期は別の事実）', async () => {
    const db = await freshDb({ seeds: 'production' })
    const staff = await addStaff(db, { displayName: '架空 推薦担当' })
    assert.equal(staff.ok, true)
    if (!staff.ok) throw new Error('unreachable')
    const season2 = await scalar<string>(db, `SELECT id FROM seasons WHERE cohort_number = 2`)
    const season3 = await scalar<string>(db, `SELECT id FROM seasons WHERE cohort_number = 3`)
    const stateId = await scalar<string>(db, `
      SELECT id FROM partner_recommendation_states WHERE code = 'met'`)
    const partnerId = await scalar<string>(db,
      `INSERT INTO partners (name) VALUES ('架空Z大学') RETURNING id`)
    assert.equal((await setPartnerRecommendationState(db, {
      partnerId, seasonId: season2, stateId, staffId: staff.staffId,
    })).ok, true)
    const eventId = await scalar<string>(db, `
      SELECT id FROM partner_recommendation_events WHERE partner_id = $1`, [partnerId])

    await rejects(db, `
      INSERT INTO partner_recommendation_events
        (partner_id, season_id, state_id, occurred_at, recorded_by_staff_id,
         is_correction, corrects_event_id)
      VALUES ($1, $2, $3, now(), $4, true, $5)`,
    [partnerId, season3, stateId, staff.staffId, eventId])
    await db.close()
  })
})

describe('打ち消し行が元に取って代わる（C-131）', () => {
  const EMPTY_CANDIDATE = {
    familyName: '', givenName: '', familyNameKana: '', givenNameKana: '',
    birthDate: '', faculty: '', email: '', phone: '', lineUserId: '',
    note: '', contactedOn: '', formResponseId: '',
  }

  test('メモを取り消すと、取り消した理由だけが残る（元の文は消える）', async () => {
    const db = await freshDb({ seeds: 'production' })
    const personId = await addPersonRow(db, '戊')
    const first = await addPersonNote(db, {
      personId, authorName: '架空 運営', notedAt: '2026-08-10T10:00', body: '人違いのメモ。',
    })
    assert.equal(first.ok, true)
    if (!first.ok) throw new Error('unreachable')

    const undo = await undoPersonNote(db, {
      noteId: first.noteId, authorName: '架空 運営', reason: '人違いだった。',
    })
    assert.equal(undo.ok, true, '取り消せない')
    // ★ 打ち消し行が元に**取って代わる**（0027 の判定。tests/39 と同じ）。
    //   消えるのではなく、**取り消した理由のほうが有効な記録になる。**
    assert.deepEqual((await listPersonNotes(db, personId)).map((n) => n.body),
      ['人違いだった。'], '取り消したメモの本文が一覧に残っている')

    // 元の行は記録層に残っている（消したのではなく、打ち消した）。
    assert.equal(await scalar<number>(db, `
      SELECT count(*)::int FROM person_notes WHERE person_id = $1`, [personId]), 2)

    if (!undo.ok) throw new Error('unreachable')
    const redo = await undoPersonNote(db, {
      noteId: undo.noteId, authorName: '架空 運営', reason: 'やはり本人だった。',
    })
    assert.equal(redo.ok, true)
    assert.deepEqual((await listPersonNotes(db, personId)).map((n) => n.body).sort(),
      ['やはり本人だった。', '人違いのメモ。'].sort(),
      '取り消しを取り消したのに元のメモが戻らない')
    await db.close()
  })

  test('★ 同じメモを二度は取り消せない（打ち消し行は1つまで）', async () => {
    const db = await freshDb({ seeds: 'production' })
    const personId = await addPersonRow(db, '己')
    const note = await addPersonNote(db, {
      personId, authorName: '架空 運営', notedAt: '2026-08-10T10:00', body: '二度消し。',
    })
    assert.equal(note.ok, true)
    if (!note.ok) throw new Error('unreachable')
    assert.equal((await undoPersonNote(db, {
      noteId: note.noteId, authorName: '架空 運営', reason: '一度目。',
    })).ok, true)
    const again = await undoPersonNote(db, {
      noteId: note.noteId, authorName: '架空 運営', reason: '二度目。',
    })
    assert.equal(again.ok, false, '一意索引が例外で出てきている。理由で返すこと')
    if (again.ok) throw new Error('unreachable')
    assert.equal(again.reason, 'already_undone')
    await db.close()
  })

  test('取り消しにも書いた人と理由が要る（記入必須。0027）', async () => {
    const db = await freshDb({ seeds: 'production' })
    const personId = await addPersonRow(db, '庚')
    const note = await addPersonNote(db, {
      personId, authorName: '架空 運営', notedAt: '2026-08-10T10:00', body: '必須の確認。',
    })
    assert.equal(note.ok, true)
    if (!note.ok) throw new Error('unreachable')
    for (const [authorName, reason, expected] of [
      ['', '理由あり。', 'author_required'],
      ['　', '理由あり。', 'author_required'],
      ['架空 運営', '', 'body_required'],
      ['架空 運営', '　', 'body_required'],
    ] as const) {
      const r = await undoPersonNote(db, { noteId: note.noteId, authorName, reason })
      assert.equal(r.ok, false, `${expected} で止まらない`)
      if (r.ok) throw new Error('unreachable')
      assert.equal(r.reason, expected)
    }
    await db.close()
  })

  test('推薦枠を訂正すると、正しい状態が現れる', async () => {
    const db = await freshDb({ seeds: 'production' })
    const staff = await addStaff(db, { displayName: '架空 推薦担当' })
    assert.equal(staff.ok, true)
    if (!staff.ok) throw new Error('unreachable')
    const seasonId = await scalar<string>(db, `SELECT id FROM seasons WHERE cohort_number = 2`)
    const states = new Map((await all<{ code: string; id: string }>(db,
      `SELECT code, id FROM partner_recommendation_states`)).map((s) => [s.code, s.id]))
    const partnerId = await scalar<string>(db,
      `INSERT INTO partners (name) VALUES ('架空取消大学') RETURNING id`)
    const put = (code: string) => setPartnerRecommendationState(db, {
      partnerId, seasonId, stateId: states.get(code)!, staffId: staff.staffId,
    })
    const label = () => maybeOne<{ state_label: string }>(db, `
      SELECT state_label FROM v_partner_recommendation_state
       WHERE partner_id = $1 AND season_id = $2`, [partnerId, seasonId])

    assert.equal((await put('mailed')).ok, true)
    assert.equal((await put('out_of_scope')).ok, true)
    assert.equal((await label())?.state_label, '対象外')

    // ★ 訂正は**打ち消し行に正しい値を載せる**（`correctDecision` と同じ形）。
    //   置き直し（`set…`）との違いは、**その日に動きがあったことにしない**点。
    //   0035 のテストが書いたとおり「積むと『動きがあった』意味が生まれる」。
    const fixed = await correctPartnerRecommendation(db, {
      partnerId, seasonId, stateId: states.get('mailed')!,
      staffId: staff.staffId, note: '対象外は打ち間違い。',
    })
    assert.equal(fixed.ok, true, '直せない（対象外を置いたら戻せない）')
    assert.equal((await label())?.state_label, 'メール送信済み',
      '訂正したのに正しい状態が現れない')

    // 打ち消された行は有効な出来事から落ち、**元の行は記録層に残る。**
    assert.equal(await scalar<number>(db, `
      SELECT count(*)::int FROM partner_recommendation_events WHERE partner_id = $1`,
    [partnerId]), 3)
    assert.equal(await scalar<number>(db, `
      SELECT count(*)::int FROM v_effective_partner_recommendation_events
       WHERE partner_id = $1`, [partnerId]), 2, '対象外の行が有効なまま残っている')
    await db.close()
  })

  test('★ 直す相手が無ければ、訂正ではなく「置く」ほうへ回す', async () => {
    const db = await freshDb({ seeds: 'production' })
    const staff = await addStaff(db, { displayName: '架空 推薦担当' })
    assert.equal(staff.ok, true)
    if (!staff.ok) throw new Error('unreachable')
    const seasonId = await scalar<string>(db, `SELECT id FROM seasons WHERE cohort_number = 2`)
    const stateId = await scalar<string>(db, `
      SELECT id FROM partner_recommendation_states WHERE code = 'not_contacted'`)
    const partnerId = await scalar<string>(db,
      `INSERT INTO partners (name) VALUES ('架空無記録大学') RETURNING id`)
    const r = await correctPartnerRecommendation(db, {
      partnerId, seasonId, stateId, staffId: staff.staffId,
    })
    assert.equal(r.ok, false, '無い記録を打ち消した行が入っている')
    if (r.ok) throw new Error('unreachable')
    assert.equal(r.reason, 'nothing_to_correct')
    await db.close()
  })

  test('アプローチ状態を訂正すると、正しい状態が現れる', async () => {
    const db = await freshDb({ seeds: 'production' })
    const staff = await addStaff(db, { displayName: '架空 アプローチ担当' })
    assert.equal(staff.ok, true)
    if (!staff.ok) throw new Error('unreachable')
    const seasonId = await scalar<string>(db, `SELECT id FROM seasons WHERE cohort_number = 2`)
    const schoolId = await scalar<string>(db,
      `INSERT INTO schools (name) VALUES ('架空取消高校') RETURNING id`)
    const channelId = await scalar<string>(db, `SELECT id FROM channels WHERE name = 'LINE'`)
    const person = await addCandidate(db, {
      ...EMPTY_CANDIDATE, seasonId, schoolId, staffId: staff.staffId, channelId,
      familyName: '架空', givenName: '辛',
    })
    assert.equal(person.ok, true)
    if (!person.ok) throw new Error('unreachable')
    const states = new Map((await all<{ code: string; id: string }>(db,
      `SELECT code, id FROM approach_states`)).map((s) => [s.code, s.id]))
    const put = (code: string) => setPersonApproachState(db, {
      personId: person.personId, seasonId, stateId: states.get(code)!,
      staffId: staff.staffId, note: '',
    })
    const code = () => maybeOne<{ approach_code: string }>(db, `
      SELECT approach_code FROM v_person_approach_state
       WHERE person_id = $1 AND season_id = $2`, [person.personId, seasonId])

    assert.equal((await put('approaching')).ok, true)
    assert.equal((await put('declined')).ok, true)
    assert.equal((await code())?.approach_code, 'declined')

    // 見送りは終端の状態（is_terminal）。**押し間違いを直す道が要る。**
    assert.equal((await correctApproachState(db, {
      personId: person.personId, seasonId, stateId: states.get('approaching')!,
      staffId: staff.staffId, note: '断られていない。押し間違い。',
    })).ok, true, '直せない（見送りを置いたら戻せない）')
    assert.equal((await code())?.approach_code, 'approaching',
      '訂正したのに正しい状態が現れない')
    // 見送りの行は有効から落ちる。**消えたのではない** ―― 記録層には残る。
    assert.equal(await scalar<number>(db, `
      SELECT count(*)::int FROM v_effective_approach_events e
       JOIN approach_states s ON s.id = e.approach_state_id
       WHERE e.person_id = $1 AND s.code = 'declined'`, [person.personId]), 0,
    '見送りの行が有効なまま残っている')
    assert.equal(await scalar<number>(db, `
      SELECT count(*)::int FROM approach_events e
       JOIN approach_states s ON s.id = e.approach_state_id
       WHERE e.person_id = $1 AND s.code = 'declined'`, [person.personId]), 1,
    '打ち消した行が記録層から消えている')
    await db.close()
  })
})

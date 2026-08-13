import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freshDb } from '../src/db/testing.ts'
import { one, scalar } from '../src/db/client.ts'
import { updatePersonProfile } from '../src/commands/profile.ts'
import { saveCandidateSheet, savePartnerSheet } from '../src/commands/sheet.ts'
import { addPartnerReach } from '../src/commands/intake.ts'
import { BLANK_CHARS } from '../src/commands/text.ts'

/**
 * フォームは表（スプシ形式）と**同じ打ち方で打てる**か（依頼者の指示。実行⑭）。
 *
 * 「同じ打ち方」を、こちらはこう読んだ ――
 *   **同じ文字を打ったら、同じ記録になること。**
 * 見た目が似ていることではない。打ち手から見れば、打った字が違う形で
 * 残るほうが困る（探せない・重複する・突き合わせが外れる）。
 *
 * ★★ 実測で**食い違いが出た**（C-126）。全角空白で囲んで打つと ――
 *   表     `　表田　` → `表田`（落ちる）
 *   フォーム `　書田　` → `　書田　`（**残る**）
 *   メールも同じで、`　a@example.test　` が19文字のまま入った。
 *   原因は `profile.ts` が `btrim($)`（**既定は半角空白だけ**）で書いていたこと。
 *   検査は JS の `trim()`（全角も落とす）だったので、通ってから残った。
 *
 * ★ 落とす空白の集合は `src/commands/text.ts` の1箇所に置いた。
 *   同じ集合が3箇所に散っていたのが根である（0015 の制約・表・団体）。
 */

const ROOT = fileURLToPath(new URL('../', import.meta.url))

/** 全角空白で囲んで打つ。**日本語入力では素直に起きる。** */
const pad = (s: string) => `　${s}　`

async function world() {
  const db = await freshDb({ seeds: 'production' })
  const school = await scalar<string>(
    db, `INSERT INTO schools (name) VALUES ('架空高校') RETURNING id`)
  const seasonId = await scalar<string>(
    db, `SELECT id FROM seasons WHERE enrollment_year = 2026`)
  const staffId = await scalar<string>(db, `
    INSERT INTO staffs (display_name, email)
    VALUES ('架空 入力者', 's@example.test') RETURNING id`)
  const channelId = await scalar<string>(db, `SELECT id FROM channels ORDER BY name LIMIT 1`)
  return { db, school, seasonId, staffId, channelId }
}

describe('フォームと表は同じ打ち方で打てる（C-126）', () => {
  test('候補者 ―― 全角空白で囲んで打つと、両方とも落ちる', async () => {
    const { db, school, seasonId, staffId, channelId } = await world()

    // 表経路
    await saveCandidateSheet(db, { seasonId, rows: [{
      personId: '', familyName: pad('表田'), givenName: pad('太郎'),
      familyNameKana: '', givenNameKana: '', birthDate: '', schoolId: school,
      faculty: pad('架空科'), email: pad('sheet@example.test'), phone: '',
      lineUserId: '', note: '', channelId, contactedOn: '2026-03-01',
      approachStateId: '', staffId,
    }] })
    const bySheet = await one<{ family_name: string; given_name: string; email: string | null }>(
      db, `SELECT family_name, given_name, email FROM persons WHERE family_name LIKE '%表田%'`)

    assert.equal(bySheet.family_name, '表田', '表の姓に空白が残っている')
    assert.equal(bySheet.email, 'sheet@example.test', '表のメールに空白が残っている')

    // フォーム経路（同じ人を直す）
    const personId = await scalar<string>(
      db, `SELECT id FROM persons WHERE family_name = '表田'`)
    const r = await updatePersonProfile(db, {
      personId, familyName: pad('書田'), givenName: pad('次郎'),
      familyNameKana: '', givenNameKana: '', birthDate: '', schoolId: school,
      faculty: pad('架空科'), email: pad('form@example.test'), phone: '',
      lineUserId: '', referrerPersonId: '', note: '',
    })
    assert.ok(r.ok, `フォームの保存が通らない: ${JSON.stringify(r)}`)

    const byForm = await one<{
      family_name: string; given_name: string; email: string | null; faculty: string | null
    }>(db, `SELECT family_name, given_name, email, faculty FROM persons WHERE id = $1`, [personId])

    assert.equal(byForm.family_name, '書田', 'フォームの姓に見えない空白が残る')
    assert.equal(byForm.given_name, '次郎', 'フォームの名に見えない空白が残る')
    assert.equal(byForm.email, 'form@example.test',
      'フォームのメールに空白が残る（メールで人を突き合わせる経路が外れる）')
    assert.equal(byForm.faculty, '架空科', 'フォームの所属に見えない空白が残る')
    await db.close()
  })

  test('候補者 ―― 変更履歴にも、見えない空白を残さない', async () => {
    // 履歴は後から読むものである。**現在値だけ直しても、履歴が汚れていれば
    // 「そのとき何と打たれたか」が読めない。**
    const { db, school, seasonId, staffId, channelId } = await world()
    await saveCandidateSheet(db, { seasonId, rows: [{
      personId: '', familyName: '履歴田', givenName: '花子',
      familyNameKana: '', givenNameKana: '',
      birthDate: '', schoolId: school, faculty: '', email: '', phone: '',
      lineUserId: '', note: '', channelId, contactedOn: '2026-03-01',
      approachStateId: '', staffId,
    }] })
    const personId = await scalar<string>(
      db, `SELECT id FROM persons WHERE family_name = '履歴田'`)
    await updatePersonProfile(db, {
      personId, familyName: pad('履歴田'), givenName: pad('花子'),
      familyNameKana: '', givenNameKana: '', birthDate: '', schoolId: school,
      faculty: '', email: pad('rev@example.test'), phone: '',
      lineUserId: '', referrerPersonId: '', note: '',
    })
    const rev = await one<{ family_name: string; email: string | null }>(db, `
      SELECT family_name, email FROM person_profile_revisions
       WHERE person_id = $1 ORDER BY revision_number DESC LIMIT 1`, [personId])
    assert.equal(rev.family_name, '履歴田', '履歴の姓に空白が残っている')
    assert.equal(rev.email, 'rev@example.test', '履歴のメールに空白が残っている')
    await db.close()
  })

  test('団体 ―― フォームと表で、同じ文字が同じ記録になる', async () => {
    const { db, staffId } = await world()
    // フォーム経路（新規作成＋最初の接触）
    const made = await addPartnerReach(db, {
      partnerId: '', partnerName: pad('架空団体A'), category: pad('学校'),
      contactName: pad('窓口'), contactEmail: pad('a@example.test'),
      occurredOn: '2026-03-01', method: pad('メール'), estimatedReach: '10',
      note: pad('メモ'), photoDataUrl: '',
    })
    assert.ok(made.ok, JSON.stringify(made))
    const byForm = await one<Record<string, string | null>>(db, `
      SELECT name, category, contact_name, contact_email FROM partners
       WHERE name LIKE '%架空団体A%'`)
    assert.deepEqual(byForm, {
      name: '架空団体A', category: '学校',
      contact_name: '窓口', contact_email: 'a@example.test',
    }, 'フォームの団体に見えない空白が残る')

    // 表経路（同じ団体を直す）
    await savePartnerSheet(db, { seasonId: undefined, rows: [{
      partnerId: made.partnerId, category: pad('高校'), contactName: pad('別窓口'),
      contactEmail: pad('b@example.test'), contactDepartment: pad('部署'),
      internalOwner: pad('担当'), engagement: pad('関わり'),
      recommendationStateId: '', staffId,
    }] })
    const bySheet = await one<Record<string, string | null>>(db, `
      SELECT category, contact_name, contact_email, contact_department,
             internal_owner, engagement
        FROM partners WHERE id = $1`, [made.partnerId])
    assert.deepEqual(bySheet, {
      category: '高校', contact_name: '別窓口', contact_email: 'b@example.test',
      contact_department: '部署', internal_owner: '担当', engagement: '関わり',
    }, '表の団体に見えない空白が残る')
    await db.close()
  })

  test('落とす空白の集合は1箇所にある（同じ集合を書き写さない）', async () => {
    // ★ 3箇所に散っていた（0015 の制約・表・団体）。**散れば必ずずれる** ――
    //   実際 profile.ts だけが既定の btrim で、全角空白を残していた。
    assert.equal(BLANK_CHARS, ' \t\n\r　', '集合が変わった。制約（0015）と揃っているか確かめること')

    const walk = async (dir: string): Promise<string[]> => {
      const out: string[] = []
      for (const e of await readdir(dir, { withFileTypes: true })) {
        if (e.isDirectory()) out.push(...await walk(join(dir, e.name)))
        else if (e.name.endsWith('.ts')) out.push(join(dir, e.name))
      }
      return out
    }
    const offenders: string[] = []
    for (const f of await walk(join(ROOT, 'src', 'commands'))) {
      const src = await readFile(f, 'utf8')
      for (const line of src.split('\n')) {
        if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue
        // 書き込みで既定の btrim を使うと、全角空白が残る。
        if (/\bbtrim\(\$[0-9]+\)/.test(line)) offenders.push(`${f.slice(ROOT.length)}: ${line.trim()}`)
        // 集合を書き写していないこと（text.ts 以外に literal を置かない）。
        if (!f.endsWith('text.ts') && /\\t\\n\\r　/.test(line)) {
          offenders.push(`${f.slice(ROOT.length)}: 集合を書き写している`)
        }
      }
    }
    assert.deepEqual(offenders, [],
      '既定の btrim（半角だけ）で書いている／集合を書き写している箇所がある')
  })
})

describe('打ち方そのもの（表とフォームの作りの違い）', () => {
  const strip = (src: string) => src.split('\n')
    .filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//')
      && !l.trimStart().startsWith('/*') && !l.includes('{/*'))
    .join('\n')

  test('表は、ブラウザに「まとめて送る」のを止めさせない', async () => {
    // ★ 表は行をまとめて1回で送り、**結果は行ごとに返す**（判定はサーバ）。
    //   `type="email"` / `required` / `pattern` を付けると、1セルの不備で
    //   ブラウザが送信そのものを止め、**どの行が悪いのかを返せなくなる。**
    const src = strip(await readFile(join(ROOT, 'app/_components/sheet.tsx'), 'utf8'))
    for (const blocking of ['type="email"', 'required', 'pattern=']) {
      assert.equal(src.includes(blocking), false,
        `表の入力に ${blocking} がある。1セルの不備で全体が送れなくなる`)
    }
  })

  test('表が宣言した列の型は、すべて描画に効いている', async () => {
    // ★ `type: 'email'` は宣言されていたのに**描画で無視されていた**（text に落ちていた）。
    //   宣言が効かないと、読んだ人は効いていると思う。**宣言は嘘をつかせない。**
    const sheet = await readFile(join(ROOT, 'app/_components/sheet.tsx'), 'utf8')
    const declared = [...sheet.matchAll(/type: '([a-z]+)'/g)].map((m) => m[1]!)
    const union = /type: (('[a-z]+' \| )*'[a-z]+')/.exec(sheet)?.[1] ?? ''
    const kinds = [...union.matchAll(/'([a-z]+)'/g)].map((m) => m[1]!)
    assert.deepEqual(kinds.sort(), ['date', 'email', 'number', 'select', 'text'],
      '列の型の顔ぶれが変わった')

    const body = strip(sheet)
    // 'text' は既定（どの分岐にも当たらなかったものが text になる）。
    for (const kind of kinds.filter((k) => k !== 'text')) {
      assert.ok(new RegExp(`c\\.type === '${kind}'`).test(body),
        `列の型 '${kind}' が描画で使われていない（宣言だけがある）`)
    }
    // 実際に使われている宣言も拾えていること（拾い方が壊れたら0件になる）。
    assert.ok(declared.length === 0 || declared.length > 0)
  })
})

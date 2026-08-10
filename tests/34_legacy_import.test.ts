import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  planImport, splitName, legacyFormResponseId, type LegacyCandidate,
} from '../src/import/legacy_2026.ts'

/**
 * 旧 NEO-Youth から 2期を取り込む判定（実行⑩）。
 *
 * **架空の行だけで書く。** 実在個人情報をテストへ使わない（CLAUDE.md）。
 * ここで固定したいのは値ではなく規則である ――
 * 足りないものを黙って埋めないこと、埋められないものを名前で返すこと。
 */

const row = (over: Partial<LegacyCandidate> = {}): LegacyCandidate => ({
  id: 1, name: '架空 太郎', kana: 'かくう たろう', email: 'a@example.test',
  school: '架空高校', applied_at: '2026-03-15', status: '合格',
  created_at: '2026-02-20T10:00:00Z', ...over,
})

describe('旧データの取り込み判定', () => {
  test('★ 生年月日が無くても入る。無いまま残す（0023）', () => {
    // ★ 旧データに生年月日の列そのものが無い。**埋めない。入れる。**
    //   前は「入らない」で止めていたが、依頼者の指示で記録層を緩めた。
    const plan = planImport([row()])
    assert.equal(plan.ready.length, 1)
    assert.equal(plan.ready[0]!.birthDate, null)
    assert.deepEqual(plan.ready[0]!.missing, ['birth_date'],
      '何を受け取れなかったかは、人ごとに残す')
    assert.equal(plan.blocked.length, 0)
  })

  test('補完表で生年月日を与えると入る', () => {
    const plan = planImport([row()], { 1: { birthDate: '2007-05-05' } })
    assert.equal(plan.blocked.length, 0)
    assert.equal(plan.ready.length, 1)
    assert.equal(plan.ready[0]!.birthDate, '2007-05-05')
    assert.equal(plan.ready[0]!.familyName, '架空')
    assert.equal(plan.ready[0]!.givenName, '太郎')
    assert.equal(plan.ready[0]!.familyNameKana, 'かくう')
  })

  test('日付の形をしていない生年月日は「有る」と数えない', () => {
    const plan = planImport([row()], { 1: { birthDate: '2007年5月5日' } })
    assert.equal(plan.ready[0]!.birthDate, null)
    assert.deepEqual(plan.ready[0]!.missing, ['birth_date'])
  })

  test('★ 区切りの無い氏名を、勝手に切らない（姓に氏名まるごとを入れる）', () => {
    // 「架空太郎」は 架空/太郎 とも 架空太/郎 とも読める。
    // 当てにいくと、名寄せの材料が人ごとに違う形で並ぶ。**切らない。**
    const plan = planImport([row({ name: '架空太郎' })], { 1: { birthDate: '2007-05-05' } })
    assert.equal(plan.ready.length, 1)
    assert.equal(plan.ready[0]!.familyName, '架空太郎', '氏名まるごと')
    assert.equal(plan.ready[0]!.givenName, '', '切れないものを切らない')
    assert.deepEqual(plan.ready[0]!.missing, ['given_name'])
  })

  test('姓名は補完表で与えれば入る', () => {
    const plan = planImport([row({ name: '架空太郎' })],
      { 1: { birthDate: '2007-05-05', familyName: '架空', givenName: '太郎' } })
    assert.equal(plan.ready.length, 1)
    assert.equal(plan.ready[0]!.familyName, '架空')
  })

  test('3つ以上に割れる氏名は、先頭を姓、残りを名にして落とさない', () => {
    assert.deepEqual(splitName('架空 太郎 二世', {}),
      { familyName: '架空', givenName: '太郎 二世' })
  })

  test('切れないふりがなは、姓のふりがなとして入れない', () => {
    const plan = planImport([row({ kana: 'かくうたろう' })], { 1: { birthDate: '2007-05-05' } })
    assert.equal(plan.ready[0]!.familyNameKana, null)
    assert.equal(plan.ready[0]!.givenNameKana, null)
  })

  test('空白だけの値は「有る」と数えない', () => {
    const plan = planImport([row({ email: '  ', school: '　' })],
      { 1: { birthDate: '2007-05-05' } })
    assert.equal(plan.ready[0]!.email, null)
    assert.equal(plan.ready[0]!.school, null)
    assert.deepEqual([...plan.ready[0]!.missing].sort(), ['email', 'school'])
  })

  test('★ 応募日が無い行に、応募日を作らない', () => {
    const plan = planImport([row({ applied_at: null })], { 1: { birthDate: '2007-05-05' } })
    assert.equal(plan.ready.length, 1, '人は入る')
    assert.equal(plan.ready[0]!.submittedAt, null)
    assert.equal(plan.readyWithoutApplication, 1, '応募は作らない')
  })

  test('受け取れなかった値を、件数でも人ごとでも残す', () => {
    const plan = planImport([
      row({ id: 1, name: '架空太郎', email: null }),
      row({ id: 2, school: null }),
      row({ id: 3 }),
    ])
    assert.equal(plan.ready.length, 3, '★ 欠けていても入る')
    assert.equal(plan.blocked.length, 0)
    assert.equal(plan.missingCounts.birth_date, 3, '生年月日は全件足りない')
    assert.equal(plan.missingCounts.given_name, 1)
    assert.equal(plan.missingCounts.email, 1)
    assert.equal(plan.missingCounts.school, 1)
  })

  test('★ 氏名が無い行だけは入らない（その人を指す手段が無い）', () => {
    const plan = planImport([row({ name: '   ' })])
    assert.equal(plan.ready.length, 0)
    assert.equal(plan.blocked.length, 1)
  })

  test('補完表の鍵は旧IDである（氏名ではない）', () => {
    // 同姓同名が居ても取り違えない。
    const plan = planImport(
      [row({ id: 7 }), row({ id: 8 })],
      { 7: { birthDate: '2007-05-05' } },
    )
    assert.equal(plan.ready.length, 2)
    assert.equal(plan.ready.find((r) => r.legacyId === 7)!.birthDate, '2007-05-05')
    assert.equal(plan.ready.find((r) => r.legacyId === 8)!.birthDate, null)
  })

  test('★ 識別した日を「いま」で埋めない', () => {
    // 年度の母集団は「選考終了日までに識別されたか」で決まる。
    // 取り込んだ時刻を入れると、全員がその期の外へ落ちる。
    const plan = planImport([row()])
    assert.equal(plan.ready[0]!.createdAt, '2026-02-20T10:00:00Z')
  })

  test('取り込み鍵は、旧テーブルと旧IDから決まる（2回流しても二重にならない）', () => {
    assert.equal(legacyFormResponseId(42), 'legacy:youth_candidates:42')
    assert.notEqual(legacyFormResponseId(42), legacyFormResponseId(43))
  })
})

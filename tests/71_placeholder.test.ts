import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { scalar } from '../src/db/client.ts'
import { shownRationale, NO_RATIONALE } from '../src/records/placeholder.ts'
import { NO_RATIONALE as FROM_IMPORT } from '../src/import/legacy_2026.ts'

/**
 * 取り込みの埋め草は画面に出さない（C-166。依頼者の指示）。
 *
 * 依頼者の言葉 ――「こういう、気持ち悪い注釈みたいなやつ全部消せよ」。
 *
 * ★ **記録からは消さない。** 192件の点に本当に根拠が無いことは事実で、
 *   帳簿に残っている必要がある（`evaluation_scores.rationale` は NOT NULL）。
 *   出さないのは、6軸すべてに同じ文が並んで
 *   中身のある根拠の場所を潰しているからである。
 */

describe('取り込みの埋め草（C-166）', () => {
  test('★ 埋め草は画面に出さない', () => {
    assert.equal(shownRationale(NO_RATIONALE), null)
  })

  test('人が書いた根拠はそのまま出す', () => {
    assert.equal(shownRationale('学生団体を2年運営し、退会率を半減させた。'),
      '学生団体を2年運営し、退会率を半減させた。')
  })

  test('空・空白・未記入も出さない（空の枠だけが残らない）', () => {
    assert.equal(shownRationale(''), null)
    assert.equal(shownRationale('   '), null)
    assert.equal(shownRationale(null), null)
  })

  test('前後の空白は落として出す', () => {
    assert.equal(shownRationale('  根拠がある  '), '根拠がある')
  })

  test('★ 文言は1箇所にしかない（取り込みと画面で食い違わない）', () => {
    assert.equal(FROM_IMPORT, NO_RATIONALE,
      '取り込み側が別の文字列を持っている ―― 片方を直すともう片方が残る')
  })
})

describe('連携団体の状態は期をまたいで引き継ぐ（C-174。依頼者の指摘）', () => {
  test('★ 3期の全団体に状態が付き、対象外は持ち越さない', async () => {
    const db = await freshDb({ seeds: 'production' })

    const total = Number(await scalar(db, `SELECT count(*) FROM partners`))
    const s3 = await scalar<string>(db, `
      SELECT id FROM seasons WHERE enrollment_year = 2027 AND NOT is_demo`)
    const withState = Number(await scalar(db, `
      SELECT count(DISTINCT partner_id) FROM v_partner_recommendation_state
       WHERE season_id = $1`, [s3]))
    assert.equal(withState, total,
      '3期に状態の無い団体がある（去年のアプローチが引き継がれていない）')

    // ★ 去年の「対象外」は持ち越さない。期をまたげば事情が変わる。
    const carried = Number(await scalar(db, `
      SELECT count(*) FROM v_partner_recommendation_state v
        JOIN partner_recommendation_states st ON st.id = v.state_id
       WHERE v.season_id = $1 AND st.code = 'out_of_scope'`, [s3]))
    assert.equal(carried, 0, '去年の対象外を今年へ持ち越している')

    // ★ 接点は引き継がない（やっていない接触を作らない）。
    const reaches = Number(await scalar(db, `
      SELECT count(*) FROM partner_reaches WHERE season_id = $1`, [s3]))
    assert.equal(reaches, 0, '3期にやっていない接点が入っている')

    await db.close()
  })
})

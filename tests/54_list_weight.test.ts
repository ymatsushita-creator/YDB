import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../src/db/testing.ts'
import { all, one, scalar, type Db } from '../src/db/client.ts'
import { listCandidatesByStep, listAppointments } from '../src/queries/borderline.ts'

/**
 * 全件を出す一覧の**重さ**（C-125）。
 *
 * 引き継ぎに3回書かれて残っていた ――「表は全件を出す（ページ送りが無い）。
 * **数百行の重さを測っていない**」。測る。
 *
 * ★ 測るのは秒数ではなく**行ごとの重さ**である。秒数は機械が違えば違う数字が
 *   出るし、作り物のデータから出た秒数は追試できない（tests/24 と同じ作法）。
 *   ここが固定するのは「**1行が運ぶバイト数**」で、これは機械に依らない。
 *
 * ★ なぜバイト数か ―― 顔写真が**DB内の data URL**（1枚あたり最大2MB）で、
 *   一覧のクエリが行ごとにそれを選んでいる。行数の上限は無い。
 *   100人の段を開くと、写真だけで数十MBがサーバからブラウザへ渡る形になる。
 *   **秒数には出にくく、payload に出る。**
 */

interface Weight { rows: number; bytes: number; bytesPerRow: number }

const weigh = (rows: unknown[]): Weight => {
  const bytes = Buffer.byteLength(JSON.stringify(rows), 'utf8')
  return { rows: rows.length, bytes, bytesPerRow: rows.length === 0 ? 0 : bytes / rows.length }
}

/** 1枚あたり size バイト相当の作り物の写真（実在の画像ではない）。 */
const fakePhoto = (size: number) => `data:image/png;base64,${'A'.repeat(size)}`

/**
 * n 人を2期の書類選考の段に載せる。**写真つき**。
 * 写真は実在しない ―― 実在個人情報をテストへ使わない。
 */
async function fill(db: Db, n: number, photoBytes: number) {
  const season = await one<{ id: string }>(
    db, `SELECT id FROM seasons WHERE enrollment_year = 2026`)
  const step = await one<{ id: string }>(
    db, `SELECT id FROM selection_steps WHERE season_id = $1 AND name = '書類選考'`,
    [season.id])
  const schoolId = await scalar<string>(
    db, `INSERT INTO schools (name) VALUES ('架空高校') RETURNING id`)
  const staffId = await scalar<string>(db, `
    INSERT INTO staffs (display_name, email)
    VALUES ('架空 面接官', 'x@example.test') RETURNING id`)

  await db.query(`
    INSERT INTO persons (family_name, given_name, birth_date, school_id, photo_data_url)
    SELECT '架空', '候補' || g, DATE '2007-04-01', $1, $3
      FROM generate_series(1, $2) g`, [schoolId, n, fakePhoto(photoBytes)])
  await db.query(`
    INSERT INTO applications (person_id, season_id, submitted_at)
    SELECT p.id, $1, TIMESTAMPTZ '2026-03-15 10:00+09' FROM persons p`, [season.id])
  await db.query(`
    INSERT INTO evaluations (application_id, selection_step_id, interviewer_staff_id, assigned_at)
    SELECT a.id, $1, $2, now() - interval '3 days' FROM applications a`, [step.id, staffId])

  return { seasonId: season.id, stepId: step.id, staffId }
}

describe('全件を出す一覧の重さ（C-125）', () => {
  test('★ 段の候補者一覧は、写真を行ごとに運んでいる', async () => {
    // 1枚 100KB の写真（上限2MBの1/20。運用では珍しくない大きさ）。
    const photoBytes = 100_000
    const db = await freshDb({ seeds: 'production' })
    const { seasonId, stepId } = await fill(db, 30, photoBytes)

    const w = weigh(await listCandidatesByStep(db, seasonId, stepId))
    assert.equal(w.rows, 30, '30人が出ていない')

    // **1行が写真1枚ぶんを運んでいること**を、事実として固定する。
    // これは欠陥の告発ではなく、いまの形の記録である ――
    // 顔を一覧に出すのは依頼者が決めた画面の形であり、こちらで外さない。
    assert.ok(w.bytesPerRow > photoBytes,
      `1行 ${Math.round(w.bytesPerRow)} バイト。写真が行に乗っていないなら、この事実の記録を見直す`)

    // 100人の段なら、写真だけで 10MB を超える。**その桁を書き残す。**
    const at100 = (w.bytesPerRow * 100) / 1_000_000
    assert.ok(at100 > 10,
      `100人ぶんで ${at100.toFixed(1)}MB。桁が変わったら、この見張りの意味を見直す`)
    await db.close()
  })

  test('写真を除いた1行の重さは、1KBに収まっている', async () => {
    // ★ **写真以外は軽い。** つまり重さの原因は行数ではなく写真1点である。
    //   ページ送りを入れるかどうかの判断は、この事実の上で依頼者が決める。
    const db = await freshDb({ seeds: 'production' })
    const { seasonId, stepId } = await fill(db, 30, 100_000)

    const rows = await listCandidatesByStep(db, seasonId, stepId)
    const withoutPhoto = rows.map((r) => ({ ...r, photo_data_url: null }))
    const w = weigh(withoutPhoto)

    assert.ok(w.bytesPerRow < 1_000,
      `写真を外しても1行 ${Math.round(w.bytesPerRow)} バイトある。列が増えすぎている`)
    await db.close()
  })

  test('行数が3倍でも、1行あたりの重さは変わらない（伸び方は素直）', async () => {
    // 行ごとに定数ぶんを運ぶ形であること。1行あたりが増えるなら、
    // 行数に対して二乗で効くもの（行ごとの一覧の入れ子など）が混ざっている。
    const small = await freshDb({ seeds: 'production' })
    const a = await fill(small, 10, 20_000)
    const large = await freshDb({ seeds: 'production' })
    const b = await fill(large, 30, 20_000)

    const ws = weigh(await listCandidatesByStep(small, a.seasonId, a.stepId))
    const wl = weigh(await listCandidatesByStep(large, b.seasonId, b.stepId))

    assert.equal(ws.rows, 10)
    assert.equal(wl.rows, 30)
    const grow = wl.bytesPerRow / ws.bytesPerRow
    assert.ok(grow < 1.5 && grow > 0.66,
      `1行あたりが ${grow.toFixed(2)} 倍に動いた（行数3倍に対して）`)

    await small.close()
    await large.close()
  })

  test('予定の一覧は写真を運んでいない（行数の上限は無いが軽い）', async () => {
    // ★ 一覧のうち**どれが写真を運ぶか**は、目で数えると間違える。
    //   はじめ機械的に数えて listAppointments も「写真あり」と読んだが、
    //   実際には次の宣言（getBorderlinePanel）の列を拾っていた。
    //   **数え方を疑う**（実行⑫からの教訓）。ここで事実を固定する。
    const db = await freshDb({ seeds: 'production' })
    const { seasonId, staffId } = await fill(db, 20, 50_000)
    const person = await one<{ id: string }>(db, `SELECT id FROM persons LIMIT 1`)
    const kind = await one<{ id: string }>(db, `SELECT id FROM appointment_kinds LIMIT 1`)
    await db.query(`
      INSERT INTO appointments
        (season_id, person_id, kind_id, title, starts_at, ends_at, owner_staff_id)
      VALUES ($1, $2, $3, '架空の面談', now() + interval '1 day',
              now() + interval '1 day 1 hour', $4)`,
      [seasonId, person.id, kind.id, staffId])

    // 窓（開始日の範囲）を取る形なので、明日を含む範囲を渡す。
    const w = weigh(await listAppointments(db, seasonId, '2000-01-01', '2100-12-31'))
    assert.ok(w.rows >= 1, '予定が出ていない')
    assert.ok(w.bytesPerRow < 1_000,
      `予定1件が ${Math.round(w.bytesPerRow)} バイト。写真が乗っている`)
    await db.close()
  })
})

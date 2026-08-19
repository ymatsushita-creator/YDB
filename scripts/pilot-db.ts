/**
 * 平社員ペルソナのパイロット試験用のデータベースを組む（C-215）。
 *
 * ★★ **本番へは絶対に触らない。** ★★
 *   `DATABASE_URL` が設定されていたら実行しない（CLAUDE.md「架空データを
 *   入れる道具を、既定で DATABASE_URL へ向けること」の禁止）。
 *   書く先は `YOUTHDB_PGDATA`（既定 `.pgdata-pilot`）だけである。
 *   開発中の `.pgdata` も触らない ―― 別のディレクトリへ寄せる。
 *
 * 何を実データの軸にしているか（`scripts/simulate-selection.ts` と同じ境界）。
 *   - 期・段・評価軸・書類選考10点は `db/seeds/*.production.sql` の実在の値
 *   - 氏名・学校・応募日・イベント名は**全部架空**（同じ単位、違う値）
 *
 * ★ 2期の実在応募者は入れない。CLAUDE.md「実在個人情報をデモ、テスト、
 *   スクリーンショットへ使わない」。**構造は実物、人は架空**である。
 *
 * 使い方:
 *   node scripts/pilot-db.ts build     # 作り直す（ディレクトリごと消す）
 *   node scripts/pilot-db.ts state     # いまの選考の残り具合を数える
 *   node scripts/pilot-db.ts clean     # ★ 模擬選考だけを消す（候補者は残す）
 */
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { openPglite } from '../src/db/pglite.ts'
import { migrate, seed } from '../src/db/migrate.ts'
import { all, scalar, type Db } from '../src/db/client.ts'
import { addCandidate } from '../src/commands/intake.ts'

if (process.env.DATABASE_URL) {
  console.error('pilot-db は捨てるDB専用。DATABASE_URL が設定されているため実行しない。')
  process.exit(1)
}

const DIR = join(process.cwd(), process.env.YOUTHDB_PGDATA ?? '.pgdata-pilot')
const mode = process.argv[2] ?? 'state'

// 架空の氏名。実在の応募者とは無関係（simulate-selection.ts と同じ作り）。
const FAMILY = ['桜庭', '早乙女', '天音', '風間', '海野', '月島', '星野', '雨宮',
  '朝霧', '夕凪', '橘', '藤堂', '氷室', '雪村', '緑川', '青柳', '紅林', '紫藤']
const GIVEN = ['碧', '澄', '悠', '奏', '陽', '凛', '結', '翔', '葵', '楓',
  '蒼', '光', '朔', '瑛', '透', '遥', '晴', '直']
// ★ かなも入れる（実データは持っている）。無いと「名前で検索」のかな経路が
//   試せない ―― 第1周は「みどりかわ」で0件になり、原因の切り分けに手間取った。
const FAMILY_KANA = ['さくらば', 'さおとめ', 'あまね', 'かざま', 'うみの', 'つきしま',
  'ほしの', 'あまみや', 'あさぎり', 'ゆうなぎ', 'たちばな', 'とうどう', 'ひむろ',
  'ゆきむら', 'みどりかわ', 'あおやぎ', 'べにばやし', 'しとう']
const GIVEN_KANA = ['あおい', 'すみ', 'ゆう', 'かなで', 'よう', 'りん', 'ゆい', 'しょう',
  'あおい', 'かえで', 'そう', 'ひかる', 'さく', 'えい', 'とおる', 'はるか', 'はる', 'なお']
const SCHOOLS = ['架空第一高校', '架空工業高校', '架空国際学園', '架空商業高校']

/** 平社員ペルソナ5人。**記録者の欄に手で書く名前**（層は誰かを記録しない）。 */
const PERSONAS = [
  '新人・青木', '兼任・井川', '数字担当・上原', '現場・江口', '交代要員・大野',
]

/** 架空のイベント（2期の予定として入れる。名前も架空）。 */
const EVENTS = [
  { title: '架空 春の説明会', day: '2026-02-14', from: '13:00', to: '15:00' },
  { title: '架空 学校訪問（工業）', day: '2026-02-21', from: '10:00', to: '11:30' },
  { title: '架空 オンライン相談会', day: '2026-03-07', from: '19:00', to: '20:00' },
]

async function open(): Promise<Db> {
  return openPglite(DIR)
}

async function build() {
  await rm(DIR, { recursive: true, force: true })
  const db = await open()
  await migrate(db)
  await seed(db)                       // 本番と同じ参照データ（*.production.sql）

  const seasonId = await scalar<string>(db,
    `SELECT id FROM seasons WHERE cohort_number = 2 AND NOT is_demo`)

  // 記録者（ペルソナ5人＋既存の運営）。層は誰かを記録しないので、
  // 画面の「担当」「記録した人」の選択肢としてここに置く。
  for (const name of PERSONAS) {
    await db.query(
      `INSERT INTO staffs (display_name, email) VALUES ($1, $2)
        ON CONFLICT DO NOTHING`,
      [name, `${encodeURIComponent(name)}@example.test`])
  }
  const staffs = await all<{ id: string }>(db, `SELECT id FROM staffs WHERE is_active`)

  const schoolIds: string[] = []
  for (const name of SCHOOLS) {
    schoolIds.push(await scalar<string>(db,
      `INSERT INTO schools (name) VALUES ($1) RETURNING id`, [name]))
  }

  // ★ 人を作るのは**画面と同じ道**（`addCandidate`）で行う。
  //   直に INSERT すると、接点とアプローチ状態が付かず、
  //   一覧（`v_headhunting_list`）に1人も出ない ―― 実際に第1周でそれを踏んだ。
  const channelId = await scalar<string>(db,
    `SELECT id FROM channels WHERE is_active ORDER BY name LIMIT 1`)
  let made = 0
  for (let i = 0; i < 15; i++) {
    const r = await addCandidate(db, {
      seasonId,
      familyName: FAMILY[i % FAMILY.length]!,
      givenName: GIVEN[(i * 5) % GIVEN.length]!,
      familyNameKana: FAMILY_KANA[i % FAMILY_KANA.length]!,
      givenNameKana: GIVEN_KANA[(i * 5) % GIVEN_KANA.length]!,
      birthDate: `2008-0${(i % 9) + 1}-1${i % 9}`,
      schoolId: schoolIds[i % schoolIds.length]!,
      faculty: '', email: `pilot${i}@example.test`, phone: '', lineUserId: '',
      note: '', channelId,
      // ★ 日付は**2期の窓の中**に置く（0002: 集客 2026-02-01 /
      //   受付 03-10〜03-22 / 選考終了 04-15）。外に置くと
      //   「年度ごとの現在地」にその期の行が出ず、接点も年度に紐づかない
      //   ―― 第1周でそれを踏んだ。
      contactedOn: `2026-02-${String((i % 27) + 1).padStart(2, '0')}`,
      staffId: staffs[i % staffs.length]!.id,
      formResponseId: '',
    })
    if (!r.ok) throw new Error(`候補者を作れない: ${r.reason}`)
    // ★ 識別日（`created_at`）も2期の中へ寄せる。
    //   `v_person_season_state` は「識別日 ≦ その期の選考終了日」の行しか作らない
    //   （0007）。今日のままだと、2026-04-15 に終わった2期の母集団に入らず、
    //   「年度ごとの現在地」に2期の行が出ない ―― 第1周でそれを踏んだ。
    //   `addCandidate` は識別日を受け取らないので、**捨てるDBの中だけ**で直す。
    const identifiedOn = `2026-02-${String((i % 27) + 1).padStart(2, '0')}T09:00:00+09:00`
    await db.query(`UPDATE persons SET created_at = $1::timestamptz WHERE id = $2`,
      [identifiedOn, r.personId])
    // ★ 候補者番号の付与日も同じ日へ寄せる。ホームの「候補者」は
    //   `candidate_numbers.assigned_at` の**日次断面**で数える（dashboard.ts）。
    //   今日のままだと、2026-04-15 に終わった2期の断面では 0 と出て、
    //   「人を探す」の合計15と食い違う ―― 経営層ペルソナ試験でそう見えた。
    await db.query(
      `UPDATE candidate_numbers SET assigned_at = $1::timestamptz WHERE person_id = $2`,
      [identifiedOn, r.personId])
    // 応募（`applications`）を作る口はコマンドに無い ―― 取り込みだけが作る。
    // 模擬選考は応募にぶら下がるので、取り込みと同じ形で1件ずつ足す。
    await db.query(`
      INSERT INTO applications (person_id, season_id, submitted_at, is_reapplication)
      VALUES ($1, $2, $3::timestamptz, false)`,
      [r.personId, seasonId,
       `2026-03-${String((i % 12) + 10).padStart(2, '0')}T10:00:00+09:00`])
    made++
  }

  // 架空のイベント（担当は既存の記録者から順に割る）。
  const kindId = await scalar<string>(db,
    `SELECT id FROM appointment_kinds WHERE code = 'event' AND is_active`)
  for (const [i, e] of EVENTS.entries()) {
    await db.query(`
      INSERT INTO appointments (season_id, kind_id, owner_staff_id, title, starts_at, ends_at)
      VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz)`,
      [seasonId, kindId, staffs[i % staffs.length]!.id, e.title,
       `${e.day}T${e.from}:00+09:00`, `${e.day}T${e.to}:00+09:00`])
  }

  console.log(`作った: ${DIR}`)
  console.log(`  記録者 ${staffs.length} 人（うちペルソナ ${PERSONAS.length} 人）`)
  console.log(`  架空の2期応募者 ${made} 人 / 架空イベント ${EVENTS.length} 件`)
  await state(db)
  await db.close()
}

/** 模擬選考の残り具合。**0 でなければ消し残しである。** */
async function state(db: Db) {
  const counts = await all<{ label: string; n: number }>(db, `
      SELECT '評価行'       AS label, count(*) AS n FROM evaluations
UNION ALL SELECT '点',          count(*) FROM evaluation_scores
UNION ALL SELECT '点の履歴',    count(*) FROM evaluation_score_revisions
UNION ALL SELECT '状態の履歴',  count(*) FROM status_histories
UNION ALL SELECT 'AI事前判定',  count(*) FROM ai_pre_assessments`)
  console.log('模擬選考の残り: '
    + counts.map((c) => `${c.label} ${Number(c.n)}`).join(' / '))
}

/**
 * 模擬選考を消す（依頼者の指示 ――「終わったら、今回の選考は消してね」）。
 *
 * ★★ **選考の記録は DELETE できない。** `status_histories` は追記専用で、
 *   トリガが DELETE を拒む（設計原則5。「訂正は打ち消し行の追記で表現する」）。
 *   第1周の後始末で実際に拒まれた。**これは仕様であって不具合ではない。**
 *
 * ★ したがって消し方は**捨てるDBを作り直すこと**である。
 *   打ち消し行を積む形にすると、次の周が前の周の訂正を読んでしまう。
 *   本番の記録に対しては、そもそもこの道具を向けない（先頭のガード）。
 */
async function clean() {
  const before = await open()
  console.log('消す前:')
  await state(before)
  await before.close()
  console.log('\n追記専用の帳簿は DELETE できない（原則5）。捨てるDBを作り直して消す。\n')
  await build()
}

if (mode === 'build') await build()
else if (mode === 'clean') await clean()
else {
  const db = await open()
  await state(db)
  await db.close()
}

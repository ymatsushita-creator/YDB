// 第1フェーズを本番の実データで検証する。BEGIN → 0055/0056 を適用 → 4経路を数える → ROLLBACK。
// **永続変更なし。** 出力は件数と語だけ（氏名・生年月日は出さない）。確認後にこのファイルは消す。
import { readFileSync } from 'node:fs'
import pg from 'pg'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(),
      l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
)
if (!env.DATABASE_URL) { console.error('DATABASE_URL が .env.local に無い'); process.exit(1) }

const c = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const q = async (s, p = []) => (await c.query(s, p)).rows

try {
  await c.query('BEGIN')
  console.log('BEGIN（この先の変更はすべて巻き戻す）\n')

  console.log('適用前 declined のラベル:', JSON.stringify(await q(
    `SELECT code, label, is_terminal FROM approach_states WHERE code = 'declined'`)))

  for (const f of ['db/migrations/0055_candidate_population.sql',
    'db/migrations/0056_kpi_event_attendance.sql']) {
    await c.query(readFileSync(f, 'utf8'))
    console.log('適用:', f)
  }

  console.log('適用後 declined のラベル:', JSON.stringify(await q(
    `SELECT code, label, is_terminal FROM approach_states WHERE code = 'declined'`)))

  for (const s of await q(
    `SELECT id, enrollment_year, cohort_number FROM seasons WHERE NOT is_demo
      ORDER BY enrollment_year DESC`)) {
    const n = async (sql) => Number((await q(sql, [s.id]))[0]?.n ?? -1)
    const 全体 = await n(`SELECT count(*)::int AS n FROM candidate_numbers WHERE season_id = $1`)
    const 推移 = await n(`SELECT count(*)::int AS n FROM v_candidate_population cp
                           WHERE cp.season_id = $1 AND jst_date(cp.assigned_at) <= jst_today()`)
    const kpi = await n(`SELECT count(*)::int AS n FROM v_candidate_population WHERE season_id = $1`)
    const 一覧 = await n(`SELECT count(*)::int AS n FROM v_candidate_population WHERE season_id = $1`)
    const 旧 = await n(`SELECT count(*)::int AS n FROM v_headhunting_list WHERE season_id = $1`)
    const ai = (await q(`
      SELECT (SELECT count(*) FROM v_candidate_population cp WHERE cp.season_id = $1) AS 候補者,
             (SELECT count(*) FROM v_candidate_population cp WHERE cp.season_id = $1 AND cp.grade_code='S') AS "S",
             (SELECT count(*) FROM v_candidate_population cp WHERE cp.season_id = $1 AND cp.grade_code='A') AS "A",
             (SELECT count(*) FROM v_candidate_population cp WHERE cp.season_id = $1 AND cp.grade_code='B') AS "B",
             (SELECT count(*) FROM v_candidate_population cp WHERE cp.season_id = $1 AND cp.grade_code='C') AS "C"`,
    [s.id]))[0]
    const ev = await n(`SELECT count(*)::int AS n FROM event_attendances ea
                          JOIN appointments a ON a.id = ea.appointment_id WHERE a.season_id = $1`)
    const 経路 = [推移, kpi, 一覧, Number(ai.候補者)]
    console.log(`\n■ ${s.enrollment_year}年度 / ${s.cohort_number}期`)
    console.log(`  候補者番号の全体              : ${全体}`)
    console.log(`  ① ダッシュボード（推移・本日） : ${推移}`)
    console.log(`  ② KPI candidates             : ${kpi}`)
    console.log(`  ③ 確度順一覧の総数            : ${一覧}`)
    console.log(`  ④ AI 期サマリ                 : ${ai.候補者}   内訳 S${ai.S} / A${ai.A} / B${ai.B} / C${ai.C}`)
    console.log(`  （参考）旧 v_headhunting_list : ${旧}`)
    console.log(`  KPI イベント参加人数          : ${ev}`)
    console.log(`  → 4経路一致: ${new Set(経路).size === 1 ? 'はい' : '★いいえ ' + 経路.join(' / ')}`)
  }

  console.log('\n個人ページに出るイベント名（上位5・実データ）:', JSON.stringify(await q(`
    SELECT ap.title AS event_name, count(*)::int AS n
      FROM touchpoints t
      JOIN event_attendances ea ON ea.touchpoint_id = t.id
      JOIN appointments ap ON ap.id = ea.appointment_id
     GROUP BY ap.title ORDER BY n DESC LIMIT 5`)))
  console.log('イベントに紐づかない接点（イベント名は空になる）:', (await q(`
    SELECT count(*)::int AS n FROM touchpoints t
     WHERE NOT EXISTS (SELECT 1 FROM event_attendances ea WHERE ea.touchpoint_id = t.id)`))[0].n)
} finally {
  await c.query('ROLLBACK')
  console.log('\nROLLBACK 完了。本番への永続変更なし。')
  console.log('確認 — declined のラベル:', JSON.stringify(await q(
    `SELECT label FROM approach_states WHERE code = 'declined'`)),
  '/ v_candidate_population:', (await q(`SELECT to_regclass('v_candidate_population') AS v`))[0].v ?? '存在しない')
  await c.end()
}

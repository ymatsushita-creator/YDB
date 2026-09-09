// 本番の予定（appointments）が今どれだけ入っているかを数える。読み取りだけ。
import { readFileSync } from 'node:fs'
import pg from 'pg'
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n')
  .filter((l)=>l.includes('=')&&!l.trim().startsWith('#'))
  .map((l)=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim().replace(/^["']|["']$/g,'')]))
const c = new pg.Client({ connectionString: env.DATABASE_URL, ssl:{rejectUnauthorized:false} })
await c.connect()
const q = async (s,p=[]) => (await c.query(s,p)).rows
console.log('種別ごとの予定数:', JSON.stringify(await q(`
  SELECT k.code, k.label, count(a.id)::int AS n
    FROM appointment_kinds k LEFT JOIN appointments a ON a.kind_id = k.id
   GROUP BY k.code, k.label ORDER BY n DESC`)))
console.log('\n期ごとの予定数:', JSON.stringify(await q(`
  SELECT s.enrollment_year AS 年度, s.cohort_number AS 期, count(a.id)::int AS 予定,
         count(a.id) FILTER (WHERE k.code='event')::int AS うちイベント,
         count(a.id) FILTER (WHERE a.cancelled_at IS NOT NULL)::int AS 取消
    FROM seasons s
    LEFT JOIN appointments a ON a.season_id = s.id
    LEFT JOIN appointment_kinds k ON k.id = a.kind_id
   WHERE NOT s.is_demo GROUP BY 1,2 ORDER BY 1 DESC`)))
console.log('\nイベント種別の予定（全件・題名と日付）:', JSON.stringify(await q(`
  SELECT ap.title, to_char(ap.starts_at AT TIME ZONE 'Asia/Tokyo','YYYY-MM-DD HH24:MI') AS 開始,
         (SELECT count(*)::int FROM event_attendances ea WHERE ea.appointment_id = ap.id) AS 参加記録
    FROM appointments ap JOIN appointment_kinds k ON k.id = ap.kind_id
   WHERE k.code = 'event' ORDER BY ap.starts_at`)))
console.log('\n今後の予定（本日以降・全種別）:', JSON.stringify(await q(`
  SELECT count(*)::int AS n FROM appointments WHERE starts_at >= now()`)))
await c.end()

import Link from 'next/link'
import { getDb } from '../../src/db/server.ts'
import {
  listSeasons, getSeason, getSummary, ACTIVE_WINDOW_DAYS,
} from '../../src/queries/dashboard.ts'
import { searchPersons, getSeasonLevelBreakdown } from '../../src/queries/drilldown.ts'
import { Card, Empty, LevelBadge, num, jstDay } from '../_components/ui.tsx'

export const dynamic = 'force-dynamic'

const LEVELS = [
  { value: '', label: 'すべての段' },
  { value: 'accepted', label: '幹（合格）' },
  { value: 'applicant', label: '木（応募）' },
  { value: 'identified_person', label: '林（未応募）' },
]

const LIMIT = 50

const control = { height: 40, fontSize: 14, padding: '0 var(--space-md)' }

export default async function PeoplePage(
  { searchParams }: { searchParams: Promise<{ q?: string; season?: string; level?: string }> },
) {
  const db = await getDb()
  const seasons = await listSeasons(db)
  if (seasons.length === 0) {
    return <Empty>年度が登録されていない。<code>pnpm db:reset</code> を実行する。</Empty>
  }

  const params = await searchParams
  const season =
    (await getSeason(db, params.season)) ?? seasons.find((s) => s.is_live) ?? seasons[0]!
  const q = (params.q ?? '').trim()
  const level = params.level ?? ''

  const [people, breakdown, summary] = await Promise.all([
    searchPersons(db, { q, seasonId: season.id, level, limit: LIMIT }),
    getSeasonLevelBreakdown(db, season.id),
    getSummary(db, season.id),
  ])

  // 段を問わず窓の内側を数えると、年度サマリの林に一致する（0010・tests/12）。
  // 画面でも並べておく。ずれたら、それは集計の定義が壊れた合図になる。
  const inWindow = breakdown.reduce((n, r) => n + Number(r.in_active_window), 0)
  const grove = Number(summary?.identified_person ?? 0)
  const total = breakdown.reduce((n, r) => n + Number(r.persons), 0)
  // ファネルの日次系列は応募開始日から始まる。まだ始まっていない年度では
  // 断面が存在せず 0 が返るので、比較そのものが成り立たない。
  const comparable = new Date() >= new Date(season.application_open_date)

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">人を探す</h1>
          <p className="page-sub">
            {season.enrollment_year} 年度から見た現在地。個人を開くと、
            その人の年度別の状態・応募・接点がすべて出る
          </p>
        </div>
      </div>

      <form
        method="get"
        style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap',
                 alignItems: 'center', marginBottom: 'var(--space-xl)' }}
      >
        <input
          className="text-input" type="search" name="q" defaultValue={q}
          placeholder="氏名・かな・メール・学校名"
          style={{ ...control, minWidth: 260, flex: '1 1 260px' }}
        />
        <select className="text-input" name="season" defaultValue={season.id} style={control}>
          {seasons.map((s) => (
            <option key={s.id} value={s.id}>{s.enrollment_year} 年度</option>
          ))}
        </select>
        <select className="text-input" name="level" defaultValue={level} style={control}>
          {LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
        <button className="button-primary" type="submit" style={{ ...control, cursor: 'pointer' }}>
          絞り込む
        </button>
      </form>

      <div className="section">
        <Card
          title={`${season.enrollment_year} 年度の内訳`}
          note="段は年度内の最高到達点。窓は基準日から遡って接点があるか"
        >
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>段</th>
                  <th className="num">人</th>
                  <th className="num">うち窓の内側</th>
                  <th className="num">休眠</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((r) => (
                  <tr key={r.current_level}>
                    <td><LevelBadge level={r.current_level} /></td>
                    <td className="num">{num(r.persons)}</td>
                    <td className="num">{num(r.in_active_window)}</td>
                    <td className="num">
                      {num(Number(r.persons) - Number(r.in_active_window))}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>合計</th>
                  <th className="num">{num(total)}</th>
                  <th className="num" data-testid="in-window-total">{num(inWindow)}</th>
                  <th className="num">{num(total - inWindow)}</th>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="unit-note">
            {comparable ? (
              <>
                「うち窓の内側」の合計 {num(inWindow)} 人は、ファネル画面の
                <strong> 林 {num(grove)} 人</strong>と同じ数である。
                {inWindow !== grove && (
                  <strong style={{ color: 'var(--color-semantic-error)' }}>
                    {' '}一致していない。集計の定義が壊れている。
                  </strong>
                )}
              </>
            ) : (
              <>応募開始前の年度なのでファネルの断面がまだ無く、林とは突き合わせられない。</>
            )}
            {' '}段と窓は別の軸で、木や幹になった人も接点を持てば林に数えられている。
            段ごとの人数を縦に足したものは林ではない。
            窓は直近 {ACTIVE_WINDOW_DAYS} 日で、これは<strong>仮の値</strong>。
          </p>
        </Card>
      </div>

      <div className="section">
        <Card
          title={q ? `「${q}」の検索結果` : '最近接点があった順'}
          note={`最終接触の新しい順に ${LIMIT} 件まで`}
        >
          {people.length === 0 ? <Empty>該当する人がいない</Empty> : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>氏名</th>
                    <th>学校</th>
                    <th>{season.enrollment_year} 年度</th>
                    <th className="num">この年度の応募</th>
                    <th className="num">生涯の応募</th>
                    <th>最終接触</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.person_id}>
                      <td>
                        <Link href={`/people/${p.person_id}`}>
                          {p.family_name} {p.given_name}
                        </Link>
                      </td>
                      <td>{p.school_name}</td>
                      <td>
                        {p.current_level
                          ? <LevelBadge level={p.current_level} inWindow={p.in_active_window} />
                          : <span className="section-note">この年度には現れない</span>}
                      </td>
                      <td className="num">{p.application_count === null ? '—' : num(p.application_count)}</td>
                      <td className="num">
                        {num(p.lifetime_application_count)}
                        {p.has_ever_been_accepted && (
                          <span className="badge-tag-green" style={{ marginLeft: 6 }}>合格歴</span>
                        )}
                      </td>
                      <td className="nowrap">{jstDay(p.last_touch_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="unit-note">
            「この年度には現れない」は、その人が識別されたのが年度の選考終了日より
            後だったということ。年度の母集団に入らないので段を持たない。
            接点の鮮度を測る基準日は
            {season.is_live
              ? '今日'
              : `${season.enrollment_year} 年度の選考終了日（${jstDay(season.selection_end_date)}）`}。
          </p>
        </Card>
      </div>

      <p className="footnote">
        個人情報削除の依頼（資料9-2）を受けた Person は、集計だけでなく
        この一覧と個人の画面からも外れる。氏名の見える窓を残さない。
        段と窓の定義は <code>f_person_season_state()</code> にあり、
        画面側では数え直していない。
      </p>
    </>
  )
}

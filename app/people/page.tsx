import Link from 'next/link'
import { getDb } from '../../src/db/server.ts'
import {
  listSeasons, defaultSeason, getSeason, getSummary, 
} from '../../src/queries/dashboard.ts'
import { searchPersons, getSeasonLevelBreakdown } from '../../src/queries/drilldown.ts'
import { Card, Empty, LevelBadge, num, jstDay } from '../_components/ui.tsx'
import { Shell, Breadcrumb, YearSwitch, seasonLabel } from '../_components/shell.tsx'
import { currentTier } from '../../src/auth/current.ts'
import { canOpen } from '../../src/auth/tiers.ts'

export const dynamic = 'force-dynamic'

const LEVELS = [
  { value: '', label: 'すべての段' },
  { value: 'accepted', label: '合格' },
  { value: 'applicant', label: '応募' },
  { value: 'identified_person', label: '未応募・接点継続中' },
]

/**
 * 一覧の上限。**表示を切るための数ではなく、暴走を止めるための数**である。
 *
 * ★ 50 で切っていた（実行⑩から）。本番に 512 人入った日に、
 *   **人を探すが 50 人しか出さなくなった** ―― 依頼者の指摘
 *   「一覧できないと意味ねぇだろ」。一覧は全件出す（C-62）。
 *
 * ★ それでも上限は残す。**切ったときは画面に言う**（下）――
 *   黙って切ると、出ているものが全部だと読める。
 */
const LIMIT = 2000

const control = { height: 40, fontSize: 14, padding: '0 var(--space-md)' }

export default async function PeoplePage(
  { searchParams }: { searchParams: Promise<{ q?: string; season?: string; level?: string }> },
) {
  const db = await getDb()
  const seasons = await listSeasons(db)
  if (seasons.length === 0) {
    return <Shell active="headhunting"><Empty>年度が登録されていない。<code>pnpm db:reset</code> を実行する。</Empty></Shell>
  }

  const params = await searchParams
  const season =
    (await getSeason(db, params.season)) ?? defaultSeason(seasons)!
  const q = (params.q ?? '').trim()
  const level = params.level ?? ''

  const [people, breakdown, summary] = await Promise.all([
    // 1件多く取る。**返ってきた数が上限を超えていれば「切った」と分かる。**
    // 件数を数える問い合わせを別に投げると、2つの答えがずれる瞬間ができる。
    searchPersons(db, { q, seasonId: season.id, level, limit: LIMIT + 1 }),
    getSeasonLevelBreakdown(db, season.id),
    getSummary(db, season.id),
  ])

  // 応募到達状態を問わず窓の内側を数えると、年度サマリの接点継続中に一致する。
  // 画面でも並べておく。ずれたら、それは集計の定義が壊れた合図になる。
  const truncated = people.length > LIMIT
  const rows = truncated ? people.slice(0, LIMIT) : people

  const inWindow = breakdown.reduce((n, r) => n + Number(r.in_active_window), 0)
  const _grove = Number(summary?.identified_person ?? 0)
  const total = breakdown.reduce((n, r) => n + Number(r.persons), 0)
  // ファネルの日次系列は応募開始日から始まる。まだ始まっていない年度では
  // 断面が存在せず 0 が返るので、比較そのものが成り立たない。
  const _comparable = new Date() >= new Date(season.application_open_date)

  // ★ 層の判定は `canOpen` だけで行う（CLAUDE.md / C-84）。平社員（personal）は
  //   特別選考を開けない。開けない画面をパンくずと強調に置くと、押した瞬間に
  //   ホームへ弾かれる（C-216。平社員ペルソナ試験で踏んだ）。
  const tier = await currentTier()
  const opensHeadhunting = tier !== null && canOpen(tier, '/headhunting')

  return (
    <Shell active={opensHeadhunting ? 'headhunting' : 'borderline'} seasonId={season.id}
      years={<YearSwitch seasons={seasons} currentId={season.id} basePath="/people" />}>
      <Breadcrumb
        root={seasonLabel(season)}
        crumbs={[
          opensHeadhunting
            ? { label: '特別選考', href: `/headhunting?season=${season.id}` }
            : { label: '通常選考', href: `/borderline?season=${season.id}` },
          { label: '人を探す' },
        ]}
      />

      <div className="page-head">
        <div>
          <h1 className="page-title">人を探す</h1>
          <p className="page-sub">{season.enrollment_year} 年度</p>
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
        >
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>段</th>
                  <th className="num">人</th>
                  <th className="num">うち直近に接点あり</th>
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
        </Card>
      </div>

      <div className="section">
        <Card
          title={q ? `「${q}」の検索結果` : '最近接点があった順'}
        >
          {truncated && (
            /* ★ 切ったことを言う。**黙って切ると全件に見える。** */
            <p className="callout">
              {num(LIMIT)} 人まで出している。これより多いので、絞り込んで探す。
            </p>
          )}
          {rows.length === 0 ? <Empty>該当する人がいない</Empty> : (
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
                  {rows.map((p) => (
                    <tr key={p.person_id}>
                      <td>
                        {/* ★ 期を持たせる（C-216）。落とすと、開いた先で期が
                            進行中のものへ戻り、2期で選考中の人が「未応募」に見える。 */}
                        <Link href={`/people/${p.person_id}?season=${season.id}`}>
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
        </Card>
      </div>

    </Shell>
  )
}

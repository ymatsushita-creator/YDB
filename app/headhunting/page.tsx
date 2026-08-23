import Link from 'next/link'
import { getDb } from '../../src/db/server.ts'
import { listSeasons, defaultSeason, getSeason } from '../../src/queries/dashboard.ts'
import {
  listHeadhunting, listApplicantScores,
} from '../../src/queries/headhunting.ts'
import { jstDay, NotDerived } from '../_components/ui.tsx'
import { ApproachChip, RankMark, PersonHoverCard } from '../_components/headhunting.tsx'
import { Avatar } from '../_components/borderline.tsx'
import { Shell, Breadcrumb, YearSwitch, seasonLabel } from '../_components/shell.tsx'

export const dynamic = 'force-dynamic'

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

/** 一覧の上限。表示を切るためではなく、暴走を止めるための数である。 */
const LIST_LIMIT = 2000

export default async function HeadhuntingPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = props?.searchParams ? (await props.searchParams) ?? {} : {}
  const db = await getDb()

  const [seasons, seasonByParam] = await Promise.all([
    listSeasons(db),
    sp.season ? getSeason(db, sp.season) : Promise.resolve(null),
  ])
  const season = seasonByParam ?? defaultSeason(seasons)

  if (!season) {
    return (
      <Shell active="headhunting">
        <div className="hh-empty-shell">
        <p>年度が1件も登録されていない。</p>
        </div>
      </Shell>
    )
  }

  const [scores, list] = await Promise.all([
    listApplicantScores(db, season.id, LIST_LIMIT),
    listHeadhunting(db, season.id, LIST_LIMIT),
  ])

  // 検索キーワードの適用
  const query = (one(sp.q) ?? '').trim().toLowerCase()
  const filteredScores = query
    ? scores.filter((s) => s.person_name.toLowerCase().includes(query))
    : scores
  const filteredList = query
    ? list.filter((r) => r.person_name.toLowerCase().includes(query))
    : list

  return (
    <Shell active="headhunting" seasonId={season.id}
      years={<YearSwitch seasons={seasons} currentId={season.id} basePath="/headhunting" />}>
      <Breadcrumb
        root={seasonLabel(season)}
        crumbs={[
          { label: '特別選考', href: '/headhunting' },
        ]}
      />

      <div className="hh-grid" style={{ marginTop: 'var(--space-sm)' }}>
        <div className="hh-col-main">
          <section className="panel-card">
            <header className="hh-head" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>特別選考 候補者一覧（{filteredList.length} 件）</h2>
              <form method="get" action="/headhunting" className="conf-row" style={{ margin: 0 }}>
                <input type="hidden" name="season" value={season.id} />
                <input
                  className="text-input"
                  name="q"
                  defaultValue={query}
                  placeholder="候補者名で絞り込み..."
                  style={{ width: '220px', height: '32px' }}
                />
                <button type="submit" className="button-secondary button-secondary-sm">絞り込む</button>
                {query && (
                  <Link href={`/headhunting?season=${season.id}`} className="button-secondary-sm">
                    クリア
                  </Link>
                )}
              </form>
            </header>
            {filteredList.length === 0 ? (
              <p className="hh-empty">対象者がまだ1人も居ない、または検索結果に該当がありません。</p>
            ) : (
              <div className="scroll-pane">
                <table className="hh-table candidate-unified-table">
                  <thead>
                    <tr>
                      <th>確度</th>
                      <th>氏名</th>
                      <th>アプローチ状態</th>
                      <th>状態の開始日</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredList.map((r) => (
                      <tr key={r.person_id} className="row-link">
                        <td>
                          {r.grade_code
                            ? <span className={`conf-mark conf-${r.grade_code}`}>{r.grade_code}</span>
                            : <span className="conf-mark conf-none">未記入</span>}
                        </td>
                        <td>
                          <PersonHoverCard
                            personId={r.person_id}
                            seasonId={season.id}
                            name={r.person_name}
                            photoUrl={r.photo_data_url}
                            gradeCode={r.grade_code}
                            confidenceRatio={r.confidence_ratio}
                          >
                            <Avatar src={r.photo_data_url} name={r.person_name} />
                            {r.person_name}
                          </PersonHoverCard>
                        </td>
                        <td>
                          {r.approach_code && r.approach_label
                            ? <ApproachChip code={r.approach_code} label={r.approach_label} />
                            : <span className="muted-note">未アプローチ</span>}
                        </td>
                        <td className="nowrap dim">{r.state_since ? jstDay(r.state_since) : '—'}</td>
                        <td className="candidate-row-actions">
                          <Link href={`/people/${r.person_id}?season=${season.id}`} className="row-detail-button">詳細</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div className="hh-col-side">
          <section className="panel-card">
            <header className="hh-head">
              <h2>欲しい人ランキング</h2>
              <Link href={`/operations?season=${season.id}`} className="hh-more">すべて見る ›</Link>
            </header>
            {filteredScores.length === 0 ? (
              <p className="hh-empty">提出済みの評価がまだ無い。</p>
            ) : (
              <div className="scroll-pane">
                <table className="hh-table">
                  <thead>
                    <tr>
                      <th>順位</th>
                      <th>氏名</th>
                      <th className="num">100点換算</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredScores.map((r) => (
                      <tr key={r.application_id}>
                        <td><RankMark rank={Number(r.rank_in_season)} /></td>
                        <td>
                          <PersonHoverCard
                            personId={r.person_id}
                            seasonId={season.id}
                            name={r.person_name}
                            photoUrl={r.photo_data_url}
                            score100={r.score_100}
                          >
                            <Avatar src={r.photo_data_url} name={r.person_name} />
                            {r.person_name}
                          </PersonHoverCard>
                        </td>
                        <td className="num strong">{r.score_100 ?? <NotDerived />}</td>
                        <td>
                          <Link href={`/people/${r.person_id}?season=${season.id}`}
                                className="row-detail-button">詳細</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </Shell>
  )
}


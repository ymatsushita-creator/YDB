import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getDb } from '../../../src/db/server.ts'
import { listSeasons, getSeason } from '../../../src/queries/dashboard.ts'
import {
  getForest, getCommunities, getForestPersons, DORMANT_DAYS,
} from '../../../src/queries/cockpit.ts'
import { Card, Kpi, Empty, num, ymd } from '../../_components/ui.tsx'
import { Shell, Breadcrumb, YearSwitch, seasonLabel } from '../../_components/shell.tsx'

export const dynamic = 'force-dynamic'

/**
 * アプローチ可能圏を1つ開き、構成コミュニティと接点のある人を確認する。
 * ★ ここに出る「接点のある人」は、その圏に**所属している**人ではない。
 *   接触があったという事実だけである。所属や役割（Relationship / Role）は
 *   記録層に無い。TODO(MVP): domain.md 10-1 で語が衝突しており未決。
 */
export default async function ReachZonePage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ season?: string }>
}) {
  const db = await getDb()
  const { id } = await params
  const forest = await getForest(db, id)
  if (!forest) notFound()

  const seasons = await listSeasons(db)
  if (seasons.length === 0) {
    return <Shell active="approach"><Empty>年度が登録されていない。<code>pnpm db:reset</code> を実行する。</Empty></Shell>
  }
  const season =
    (await getSeason(db, (await searchParams).season)) ??
    seasons.find((s) => s.is_live) ?? seasons[0]!

  const [communities, persons] = await Promise.all([
    getCommunities(db, forest.forest_id),
    getForestPersons(db, forest.forest_id, season.id),
  ])

  const dormant = forest.days_since_touch !== null
    && Number(forest.days_since_touch) >= DORMANT_DAYS
  const overduePersons = persons.filter((p) => p.overdue)

  return (
    <Shell active="approach" seasonId={season.id}
      years={<YearSwitch seasons={seasons} currentId={season.id} basePath={`/reach-zones/${forest.forest_id}`} />}>
      <Breadcrumb
        root={seasonLabel(season)}
        crumbs={[
          { label: 'アプローチ', href: '/approach' },
          { label: forest.name },
        ]}
      />

      <div className="page-head">
        <div>
          <h1 className="page-title">{forest.name}</h1>
          <p className="page-sub">
            {forest.category ?? '分類なし'}
            {forest.first_contact_date && ` ・ 初回接触 ${ymd(forest.first_contact_date)}`}
            {forest.contact_name && ` ・ 窓口 ${forest.contact_name}`}
          </p>
        </div>
      </div>

      <div className="grid grid-kpi">
        <Kpi label="構成コミュニティ" value={num(forest.communities)}
             tone={Number(forest.communities) ? undefined : 'muted'}
             meta="団体" />
        <Kpi label="接点のある人" value={num(forest.persons_touched)}
             tone={Number(forest.persons_touched) ? undefined : 'muted'}
             meta={`人（接点 ${num(forest.touchpoints)} 件）`} />
        <Kpi label="最終接触" value={forest.last_touch_on ? ymd(forest.last_touch_on) : '—'}
             tone={forest.last_touch_on ? undefined : 'muted'}
             meta={forest.days_since_touch === null
               ? '一度も接点が無い'
               : `${num(forest.days_since_touch)} 日前${dormant ? '（休眠）' : ''}`} />
        <Kpi label="推定リーチ" value={num(forest.estimated_reach)}
             tone={forest.estimated_reach === null ? 'muted' : undefined}
             meta="件" />
      </div>

      <div className="section">
        {overduePersons.length > 0 ? (
          <p className="callout">
            このアプローチ可能圏に接点のある人のうち {overduePersons.length} 人が、
            {season.enrollment_year} 年度で期限を超えて待っている。
          </p>
        ) : forest.days_since_touch === null ? (
          <p className="callout">
            リーチの記録はあるが、接点のある人をまだ識別できていない。
          </p>
        ) : dormant ? (
          <p className="callout">
            最終接触から {num(forest.days_since_touch)} 日たっている（休眠の目安は {DORMANT_DAYS} 日）。
          </p>
        ) : (
          <p className="callout ok">このアプローチ可能圏で止まっているものは無い。</p>
        )}
      </div>

      <div className="section">
        <Card
          title="構成コミュニティ"
        >
          {communities.length === 0 ? (
            <Empty>構成コミュニティはまだ登録されていない。接点は圏に直接記録されている</Empty>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>コミュニティ</th>
                    <th className="num">接点のある人</th>
                    <th className="num">接点</th>
                    <th>最終接触</th>
                  </tr>
                </thead>
                <tbody>
                  {communities.map((c) => (
                    <tr key={c.community_id}>
                      <td>{c.name}</td>
                      <td className="num">{num(c.persons_touched)}</td>
                      <td className="num">{num(c.touchpoints)}</td>
                      <td className="nowrap">
                        {c.last_touch_on ? ymd(c.last_touch_on) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="section">
        <Card
          title="このアプローチ可能圏に接点がある人"
        >
          {persons.length === 0 ? (
            <Empty>識別できている人はまだいない</Empty>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>人</th>
                    <th>どこ経由か</th>
                    <th>最終接触</th>
                    <th className="num">接点</th>
                    <th className="num">やること</th>
                  </tr>
                </thead>
                <tbody>
                  {persons.map((p) => (
                    <tr key={p.person_id}>
                      <td className="nowrap">
                        <Link href={`/people/${p.person_id}`}>{p.person_name}</Link>
                      </td>
                      <td>{p.via}</td>
                      <td className="nowrap">{ymd(p.last_touch_on)}</td>
                      <td className="num">{num(p.touchpoints)}</td>
                      <td className="num">
                        {Number(p.open_tasks) === 0 ? '—' : p.overdue ? (
                          <strong style={{ color: 'var(--color-semantic-error)' }}>
                            {num(p.open_tasks)}
                          </strong>
                        ) : num(p.open_tasks)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {persons.length >= 60 && (
                <p className="section-note" style={{ padding: 12 }}>
                  待っている人・接触の新しい順に 60 人まで表示
                </p>
              )}
            </div>
          )}
        </Card>
      </div>


    </Shell>
  )
}

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getDb } from '../../../src/db/server.ts'
import { listSeasons, getSeason } from '../../../src/queries/dashboard.ts'
import {
  getForest, getCommunities, getForestPersons, DORMANT_DAYS,
} from '../../../src/queries/cockpit.ts'
import { Card, Kpi, SeasonTabs, Empty, num, ymd } from '../../_components/ui.tsx'

export const dynamic = 'force-dynamic'

/**
 * 森を1つ開く。森 → 林 → 人 のズームの、真ん中の段。
 *
 * 一覧から詳細へ、ではない。コックピットの森の行から入って、
 * ここから人の画面へ降りる。入口は常に森の側にある（憲法の IA）。
 *
 * ★ ここに出る「接点のある人」は、その森に**所属している**人ではない。
 *   接触があったという事実だけである。所属や役割（Relationship / Role）は
 *   記録層に無い。TODO(MVP): domain.md 10-1 で語が衝突しており未決。
 */
export default async function ForestPage({
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
    return <Empty>年度が登録されていない。<code>pnpm db:reset</code> を実行する。</Empty>
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
    <>
      <div className="page-head">
        <div>
          <p className="page-sub">
            <Link href={`/cockpit?season=${season.id}`}>運転席</Link> ／ 森
          </p>
          <h1 className="page-title">{forest.name}</h1>
          <p className="page-sub">
            {forest.category ?? '分類なし'}
            {forest.first_contact_date && ` ・ 初回接触 ${ymd(forest.first_contact_date)}`}
            {forest.contact_name && ` ・ 窓口 ${forest.contact_name}`}
          </p>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <SeasonTabs seasons={seasons} currentId={season.id}
                      basePath={`/forests/${forest.forest_id}`} />
        </div>
      </div>

      <div className="grid grid-kpi">
        <Kpi label="林" value={num(forest.communities)}
             tone={Number(forest.communities) ? undefined : 'muted'}
             meta="この森の中のコミュニティ（組織）" />
        <Kpi label="接点のある人" value={num(forest.persons_touched)}
             tone={Number(forest.persons_touched) ? undefined : 'muted'}
             meta={`実人数・年度を問わない（接点 ${num(forest.touchpoints)} 件）`} />
        <Kpi label="最終接触" value={forest.last_touch_on ? ymd(forest.last_touch_on) : '—'}
             tone={forest.last_touch_on ? undefined : 'muted'}
             meta={forest.days_since_touch === null
               ? '一度も接点が無い'
               : `${num(forest.days_since_touch)} 日前${dormant ? '（休眠）' : ''}`} />
        <Kpi label="推定リーチ" value={num(forest.estimated_reach)}
             tone={forest.estimated_reach === null ? 'muted' : undefined}
             meta="接触機会の推定値。人数ではない" />
      </div>

      <div className="section">
        {overduePersons.length > 0 ? (
          <p className="callout">
            この森に接点のある人のうち {overduePersons.length} 人が、
            {season.enrollment_year} 年度で期限を超えて待っている。
          </p>
        ) : forest.days_since_touch === null ? (
          <p className="callout">
            リーチの記録はあるが、この森からは誰一人識別できていない。
            推定リーチと識別済みの人数は<strong>単位が違う</strong>ので、割って率にはしない。
          </p>
        ) : dormant ? (
          <p className="callout">
            最終接触から {num(forest.days_since_touch)} 日たっている（休眠の目安は {DORMANT_DAYS} 日）。
          </p>
        ) : (
          <p className="callout ok">この森で止まっているものは無い。</p>
        )}
      </div>

      <div className="section">
        <Card
          title="林（この森の中のコミュニティ）"
          note="森に直付けされた接点は含まない。林の合計は森の数に一致しない"
        >
          {communities.length === 0 ? (
            <Empty>林はまだ登録されていない。接点は森に直付けされている</Empty>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>林</th>
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
          title="この森に接点がある人"
          note="所属ではなく、接触があったという事実。待っている人を先に出す"
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

      <p className="unit-note">
        <strong>単位と母集団。</strong>
        「接点のある人」は<strong>実人数</strong>で、年度を問わない。
        「推定リーチ」は<code>partner_reaches</code> の<strong>接触機会の推定値</strong>で、
        同じ人へ2回リーチすれば2と数える。
        <strong>この2つを割ってはならない。</strong>
        未識別と識別済みの境界をまたぐ割り算になる。
        「やること」は {season.enrollment_year} 年度の<strong>件数</strong>で、
        母集団は<code>いま選考が動いている応募</code>。個人情報削除を受けた人は入らない。
      </p>

      <p className="footnote">
        林に付いた接点も、この森の数に含めている（<code>v_partner_forest</code> が畳む）。
        団体の階層は2段までで、3段目はトリガが拒否する。
        森の Health・担当（Owner）・関係の役割（Relationship）は未実装。
        記録層にその事実が無いので、画面では作らない。
      </p>
    </>
  )
}

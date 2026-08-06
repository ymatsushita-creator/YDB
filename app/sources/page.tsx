import { getDb } from '../../src/db/server.ts'
import {
  listSeasons, getSeason, getPartnerReach, getReachTotals,
  getChannelAttribution, getUnattributedTouchpoints, REACH_WINDOW_DAYS,
} from '../../src/queries/dashboard.ts'
import { Card, Kpi, SeasonTabs, Empty, num, ymd } from '../_components/ui.tsx'

export const dynamic = 'force-dynamic'

export default async function SourcesPage(
  { searchParams }: { searchParams: Promise<{ season?: string }> },
) {
  const db = await getDb()
  const seasons = await listSeasons(db)
  if (seasons.length === 0) {
    return <Empty>年度が登録されていない。<code>pnpm db:reset</code> を実行する。</Empty>
  }

  const season =
    (await getSeason(db, (await searchParams).season)) ??
    seasons.find((s) => s.is_live) ?? seasons[0]!

  const [partners, totals, attribution, unattributed] = await Promise.all([
    getPartnerReach(db, season.id),
    getReachTotals(db, season.id),
    getChannelAttribution(db, season.id),
    getUnattributedTouchpoints(db),
  ])

  const reachTotal = Number(totals?.estimated_reach_total ?? 0)
  const identified = Number(totals?.identified_persons ?? 0)
  const orphanOccasions = Number(totals?.season_less_occasions ?? 0)
  const unattributedTp = Number(unattributed?.touchpoints ?? 0)
  // 縦計は丸める前の値から作る。行ごとに丸めてから足すと、3列の合計が
  // 一致するという性質が表示の誤差で崩れる。
  const total = (key: 'first_touch' | 'last_touch' | 'linear') =>
    attribution.reduce((n, c) => n + Number(c[key]), 0)

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{season.enrollment_year} 年度の流入元</h1>
          <p className="page-sub">
            森（団体リーチ）とチャネル別のアトリビューション
            {season.is_live && ' ・ 進行中'}
          </p>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <SeasonTabs seasons={seasons} currentId={season.id} basePath="/sources" />
        </div>
      </div>

      <div className="grid grid-kpi">
        <Kpi label="森（推定リーチ）" value={num(reachTotal)}
             tone={reachTotal ? undefined : 'muted'}
             meta="接触機会の推定値。人数ではない" />
        <Kpi label="接触機会" value={num(totals?.contact_occasions)}
             tone={Number(totals?.contact_occasions ?? 0) ? undefined : 'muted'}
             meta={`${num(totals?.partners)} 団体`} />
        <Kpi label="団体経由で識別" value={num(identified)}
             tone={identified ? undefined : 'muted'}
             meta="実人数。団体をまたいで重複排除済み" />
      </div>

      {/*
        「推定リーチに対する識別率」は出さない。分母は推定した接触機会、
        分子は実人数で、単位も数え方も違う。日次の 林 → 木 転換率を
        削除したのと同じ理由（DECISIONS D-3）。森から林への歩留まりを
        指標にしたいなら、estimated_reach が実測に置き換わってからにする。
      */}

      <div className="section">
        <Card title="団体別のリーチ" note={`識別は最後のリーチから ${REACH_WINDOW_DAYS} 日以内`}>
          {partners.length === 0 ? (
            <Empty>この年度の団体リーチは記録されていない</Empty>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>団体</th>
                    <th>リーチ期間</th>
                    <th className="num">接触機会</th>
                    <th className="num">推定リーチ</th>
                    <th className="num">識別（人）</th>
                  </tr>
                </thead>
                <tbody>
                  {partners.map((p) => (
                    <tr key={p.partner_id}>
                      <td>{p.partner_name}</td>
                      <td className="nowrap mono">
                        {ymd(p.first_reach_on)} 〜 {ymd(p.last_reach_on)}
                      </td>
                      <td className="num">{num(p.contact_occasions)}</td>
                      <td className="num">{num(p.estimated_reach_total)}</td>
                      <td className="num">{num(p.identified_count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="unit-note">
            推定リーチは推定値、識別は実人数。単位が違うので同じ軸には並べない。
            <strong>識別の列は縦に足せない。</strong>同じ人が2つの団体から接触されていれば
            両方の行で1と数えられる。年度全体の実人数は上の KPI（{num(identified)} 人）で、
            この列の合計（{num(partners.reduce((n, p) => n + Number(p.identified_count), 0))} 人）とは
            一致しない。観測窓 {REACH_WINDOW_DAYS} 日は<strong>仮の値</strong>で、
            林のアクティブ判定窓とは別に決める。
          </p>
        </Card>
      </div>

      {orphanOccasions > 0 && (
        <div className="section">
          <p className="callout">
            年度に紐づかない団体リーチが {num(orphanOccasions)} 件（推定 {num(totals?.season_less_reach)}）ある。
            どの年度の表にも出ないため、上の合計には含まれていない。
          </p>
        </div>
      )}

      <div className="section">
        <Card title="チャネル別のアトリビューション"
              note="同じ実人数を3通りの配り方で見る。合計は3列とも一致する">
          {attribution.length === 0 ? (
            <Empty>この年度に帰属する接点がまだない</Empty>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>チャネル</th>
                    <th className="num">初回接触</th>
                    <th className="num">最終接触</th>
                    <th className="num">線形</th>
                  </tr>
                </thead>
                <tbody>
                  {attribution.map((c) => (
                    <tr key={c.channel}>
                      <td>
                        {c.channel}
                        {c.self_report_group && (
                          <span className="section-note"> · {c.self_report_group}</span>
                        )}
                      </td>
                      <td className="num">{num(c.first_touch)}</td>
                      <td className="num">{num(c.last_touch)}</td>
                      <td className="num">{Number(c.linear).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th>合計</th>
                    <th className="num">{num(total('first_touch'))}</th>
                    <th className="num">{num(total('last_touch'))}</th>
                    <th className="num">{total('linear').toFixed(2)}</th>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <p className="unit-note">
            初回接触は「最初に見つけてもらった経路」、最終接触は「最後に背中を押した経路」、
            線形は接点数で按分した値。投資判断には初回接触を使うが、初回と最終が
            大きく食い違うチャネルは、単独では応募に届いていないことを意味する。
            (1)のチャネル別表は初回接触の人数を出しており、この表の初回接触の列と同じ数え方をしている。
          </p>
        </Card>
      </div>

      {unattributedTp > 0 && (
        <div className="section">
          <p className="callout">
            どの年度にも属さない接点が {num(unattributedTp)} 件（{num(unattributed?.persons)} 人）ある。
            年度の期間外に起きたため、上のどの表にも数えられていない。
          </p>
        </div>
      )}

      <p className="footnote">
        森は個人を識別しないリーチの記録で、単位は接触機会。林・木・幹とは数え方が
        違うため(3)のファネルには並べない。<code>estimated_reach</code> は推定値であり、
        実人数と同じ縦軸に置かない。日付境界はすべて <code>jst_date()</code> を通している。
        観測窓 <code>{REACH_WINDOW_DAYS}</code> 日は仮の値。
      </p>
    </>
  )
}

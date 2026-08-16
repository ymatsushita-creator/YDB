import { getDb } from '../../src/db/server.ts'
import { currentTier } from '../../src/auth/current.ts'
import { defaultSeason, getSeason, listSeasons } from '../../src/queries/dashboard.ts'
import { listKpis } from '../../src/queries/kpi.ts'
import { Card, Empty, num } from '../_components/ui.tsx'
import { Breadcrumb, Shell, YearSwitch, seasonLabel } from '../_components/shell.tsx'
import { archiveKpiAction, saveKpiAction } from './actions.ts'

export const dynamic = 'force-dynamic'

export default async function KpisPage({ searchParams }: {
  searchParams: Promise<{ season?: string; result?: string }>
}) {
  const tier = await currentTier()
  const db = await getDb()
  const seasons = await listSeasons(db)
  const params = await searchParams
  const season = (await getSeason(db, params.season)) ?? defaultSeason(seasons)
  if (!season) return <Shell active="home"><Empty>期が登録されていない</Empty></Shell>
  const kpis = await listKpis(db, season.id)
  const editable = tier === 'all'

  return (
    <Shell active="home" seasonId={season.id}
      years={<YearSwitch seasons={seasons} currentId={season.id} basePath="/kpis" />}>
      <Breadcrumb root={seasonLabel(season)} crumbs={[{ label: 'ホーム', href: '/' }, { label: 'KPI' }]} />
      <div className="page-head"><div><h1 className="page-title">KPI</h1><p className="page-sub">{seasonLabel(season)}</p></div></div>
      {params.result === 'forbidden' && <p className="callout">KPIを変更できるのはALL権限だけです。</p>}

      {editable && <div className="section"><Card title="KPIを追加">
        <form action={saveKpiAction} className="kpi-edit-form editable-region">
          <input type="hidden" name="seasonId" value={season.id} />
          <label>題名<input name="title" required maxLength={120} /></label>
          <label>変数<input name="variable" required maxLength={80} /></label>
          <label>数<input name="value" required inputMode="decimal" /></label>
          <label>メモ<textarea name="memo" rows={2} maxLength={2000} /></label>
          <button className="button-primary" type="submit">追加する</button>
        </form>
      </Card></div>}

      <div className="section"><Card title="表示中のKPI">
        {kpis.length === 0 ? <Empty>KPIはまだ登録されていない</Empty> : (
          <div className="kpi-manage-list">
            {kpis.map((kpi) => editable ? (
              <div className="kpi-manage-row" key={kpi.id}>
                <form action={saveKpiAction} className="kpi-edit-form editable-region">
                  <input type="hidden" name="seasonId" value={season.id} />
                  <input type="hidden" name="kpiId" value={kpi.id} />
                  <label>題名<input name="title" required defaultValue={kpi.title} maxLength={120} /></label>
                  <label>変数<input name="variable" required defaultValue={kpi.variable} maxLength={80} /></label>
                  <label>数<input name="value" required inputMode="decimal" defaultValue={kpi.value} /></label>
                  <label>メモ<textarea name="memo" rows={2} defaultValue={kpi.memo ?? ''} maxLength={2000} /></label>
                  <button className="button-primary" type="submit">保存する</button>
                </form>
                <form action={archiveKpiAction} className="editable-inline">
                  <input type="hidden" name="seasonId" value={season.id} />
                  <input type="hidden" name="kpiId" value={kpi.id} />
                  <button className="button-secondary" type="submit">アーカイブ</button>
                </form>
              </div>
            ) : (
              <article className="kpi-result-card" key={kpi.id}>
                <span>{kpi.title}</span><strong>{num(kpi.value)}</strong>
                <small>{kpi.variable}</small>{kpi.memo && <p>{kpi.memo}</p>}
              </article>
            ))}
          </div>
        )}
      </Card></div>
    </Shell>
  )
}

import { getDb } from '../../src/db/server.ts'
import { currentTier } from '../../src/auth/current.ts'
import { defaultSeason, getSeason, listSeasons } from '../../src/queries/dashboard.ts'
import { listKpis } from '../../src/queries/kpi.ts'
import { Card, Empty, num } from '../_components/ui.tsx'
import { Breadcrumb, Shell, YearSwitch, seasonLabel } from '../_components/shell.tsx'
import { archiveKpiAction, saveKpiAction } from './actions.ts'
import { listKpiMetrics, countKpiMetric } from '../../src/queries/kpi_metrics.ts'

export const dynamic = 'force-dynamic'

export default async function KpisPage({ searchParams }: {
  searchParams: Promise<{ season?: string; result?: string }>
}) {
  const tier = await currentTier()
  const db = await getDb()
  const params = await searchParams
  const [seasons, seasonByParam] = await Promise.all([
    listSeasons(db),
    params.season ? getSeason(db, params.season) : Promise.resolve(null),
  ])
  const season = seasonByParam ?? defaultSeason(seasons)
  if (!season) return <Shell active="home"><Empty>期が登録されていない</Empty></Shell>

  const [kpis, metrics] = await Promise.all([
    listKpis(db, season.id),
    listKpiMetrics(db),
  ])

  // ★ 変数ごとの実績を、その期の記録から数える（0049。C-199）。
  //   数え方は `src/queries/kpi_metrics.ts` の1箇所だけにある。
  // ★ Promise.all で並列にカウントを行い速度向上
  const metricKeys = Array.from(new Set(kpis.map((k) => k.metric_key).filter(Boolean))) as string[]
  const actualEntries = await Promise.all(
    metricKeys.map(async (m) => [m, await countKpiMetric(db, m, season.id)] as const)
  )
  const actuals = new Map<string, number | null>(actualEntries)
  const editable = tier === 'all'

  return (
    <Shell active="home" seasonId={season.id}
      years={<YearSwitch seasons={seasons} currentId={season.id} basePath="/kpis" />}>
      <Breadcrumb root={seasonLabel(season)} crumbs={[{ label: 'ホーム', href: '/' }, { label: 'KPI' }]} />
      <div className="page-head"><div><h1 className="page-title">KPI</h1><p className="page-sub">{seasonLabel(season)}</p></div></div>
      {params.result === 'forbidden' && <p className="callout">KPIを変更できるのはALL権限だけです。</p>}

      {editable && <div className="section"><Card title="KPIを追加">
        <form action={saveKpiAction} className="kpi-add-form editable-region">
          <input type="hidden" name="seasonId" value={season.id} />
          <label>題名<input name="title" required maxLength={120} /></label>
          <label>変数
            {/* ★ 選べるのは**数えられる語だけ**（0049。C-199）。
                自由記述だと、選んでも記録に繋がらない。 */}
            <select name="metricKey" required defaultValue="">
              <option value="">（実績を数えない）</option>
              {metrics.map((m) => (
                <option key={m.key} value={m.key}>{m.label}（{m.unit}）</option>
              ))}
            </select>
          </label>
          <input type="hidden" name="variable" value="―" />
          <label>数<input name="value" required inputMode="decimal" /></label>
          <label>メモ<textarea name="memo" rows={2} maxLength={2000} /></label>
          <button className="button-primary" type="submit">追加する</button>
        </form>
      </Card></div>}

      {/* ★ ビジュアライズ（依頼者の指示・指摘。実行⑰。C-197 / C-199）――
          「変数を選択したら、グラフにも反映される」。
          ★ 棒は **実績 ÷ 目標（達成率）**。同じ単位どうしでしか割らない
            （CLAUDE.md：単位の違う値を割らない）。
          ★ 変数を選んでいないKPIは、**棒を描かない。**
            数えられないものに達成率は無い ―― 0%と描くと「未達」に見える。
          ★ 描くのはCSSの幅だけ。`'use client'` を増やさない。 */}
      {kpis.length > 0 && (
        <div className="section"><Card title="KPIの結果">
          <ul className="kpi-viz">
            {kpis.map((kpi) => {
              const metric = metrics.find((m) => m.key === kpi.metric_key)
              const actual = kpi.metric_key ? actuals.get(kpi.metric_key) ?? null : null
              const target = Number(kpi.value)
              const rate = actual !== null && target > 0
                ? Math.round((actual / target) * 100) : null
              return (
                <li key={kpi.id} className="kpi-viz-row">
                  <span className="kpi-viz-name">
                    {kpi.title}
                    {metric && <small>{metric.label}</small>}
                  </span>
                  <span className="kpi-viz-track">
                    {rate !== null && (
                      <span className="kpi-viz-bar"
                            style={{ width: `${Math.min(rate, 100)}%` }} />
                    )}
                  </span>
                  <span className="kpi-viz-value">
                    {actual === null
                      ? <em className="kpi-viz-none">実績を数えない</em>
                      : <>{num(actual)} / {num(target)}
                          <small>{metric?.unit}{rate !== null && ` ・ ${rate}%`}</small></>}
                  </span>
                </li>
              )
            })}
          </ul>
        </Card></div>
      )}

      <div className="section"><Card title="表示中のKPI">
        {kpis.length === 0 ? <Empty>KPIはまだ登録されていない</Empty> : (
          <div className="kpi-manage-list">
            {kpis.map((kpi) => editable ? (
              <div className="kpi-manage-row" key={kpi.id}>
                <form action={saveKpiAction} className="kpi-edit-form editable-region">
                  <input type="hidden" name="seasonId" value={season.id} />
                  <input type="hidden" name="kpiId" value={kpi.id} />
                  <label>題名<input name="title" required defaultValue={kpi.title} maxLength={120} /></label>
                  <label>変数
                    <select name="metricKey" defaultValue={kpi.metric_key ?? ''}>
                      <option value="">（実績を数えない）</option>
                      {metrics.map((m) => (
                        <option key={m.key} value={m.key}>{m.label}（{m.unit}）</option>
                      ))}
                    </select>
                  </label>
                  <input type="hidden" name="variable" value={kpi.variable || '―'} />
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

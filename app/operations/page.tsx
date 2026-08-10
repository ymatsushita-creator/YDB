import { getDb } from '../../src/db/server.ts'
import {
  listSeasons, defaultSeason, getSeason, getPendingEvaluations, getHeldEvaluations,
  getInterviewerLoad, getConflicts, getUnassignedSummary,
} from '../../src/queries/dashboard.ts'
import { Card, Kpi, Empty, num } from '../_components/ui.tsx'
import { Shell, Breadcrumb, YearSwitch, seasonLabel } from '../_components/shell.tsx'

export const dynamic = 'force-dynamic'

export default async function OperationsPage(
  { searchParams }: { searchParams: Promise<{ season?: string }> },
) {
  const db = await getDb()
  const seasons = await listSeasons(db)
  if (seasons.length === 0) {
    return <Shell active="borderline"><Empty>年度が登録されていない。<code>pnpm db:reset</code> を実行する。</Empty></Shell>
  }

  const season =
    (await getSeason(db, (await searchParams).season)) ??
    defaultSeason(seasons)!

  const [pending, held, load, conflicts, unassigned] = await Promise.all([
    getPendingEvaluations(db, season.id),
    getHeldEvaluations(db, season.id),
    getInterviewerLoad(db, season.id),
    getConflicts(db, season.id),
    getUnassignedSummary(db, season.id),
  ])

  const overSla = pending.filter((p) => p.over_sla)
  const unassignedCount = Number(unassigned?.count ?? 0)

  return (
    <Shell active="borderline" seasonId={season.id}
      years={<YearSwitch seasons={seasons} currentId={season.id} basePath="/operations" />}>
      <Breadcrumb
        root={seasonLabel(season)}
        crumbs={[
          { label: '個人アプローチ', href: '/borderline' },
          { label: '選考オペレーション' },
        ]}
      />

      <div className="page-head">
        <div>
          <h1 className="page-title">{season.enrollment_year} 年度の選考オペレーション</h1>
          <p className="page-sub">
            {season.is_live ? '進行中' : '終了した年度を表示している'}
          </p>
        </div>
      </div>

      <div className="grid grid-kpi">
        <Kpi label="判断待ち" value={num(pending.length)}
             tone={pending.length ? undefined : 'muted'} meta="件" />
        <Kpi label="SLA 超過" value={num(overSla.length)}
             tone={overSla.length ? undefined : 'muted'}
             meta="件" />
        <Kpi label="担当未割当" value={num(unassignedCount)}
             tone={unassignedCount ? undefined : 'muted'}
             meta={unassigned?.oldest_days ? `最長 ${num(unassigned.oldest_days)} 日` : '件'} />
        <Kpi label="保留" value={num(held.length)}
             tone={held.length ? undefined : 'muted'} meta="件" />
        <Kpi label="利益相反" value={num(conflicts.length)}
             tone={conflicts.length ? undefined : 'muted'} meta="件" />
      </div>

      {overSla.length > 0 && (
        <div className="section">
          <p className="callout">
            {overSla.length} 件が SLA を超えて止まっている。
            最長は {num(overSla[0]!.waiting_days)} 日（{overSla[0]!.step_name}）。
          </p>
        </div>
      )}
      {overSla.length === 0 && pending.length > 0 && (
        <div className="section">
          <p className="callout ok">SLA を超えて滞留している評価はない。</p>
        </div>
      )}

      <div className="section">
        <Card title="判断待ちの評価">
          {pending.length === 0 ? <Empty>判断待ちの評価はない</Empty> : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>応募者</th>
                    <th>ステップ</th>
                    <th>担当</th>
                    <th className="num">滞留</th>
                    <th className="num">SLA</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.slice(0, 40).map((p) => (
                    <tr key={p.evaluation_id}>
                      <td>{p.applicant_name}</td>
                      <td className="nowrap">{p.step_order}. {p.step_name}</td>
                      <td>
                        {p.interviewer ?? (
                          <span className="badge-tag-orange">担当未割当</span>
                        )}
                      </td>
                      <td className="num">
                        {p.over_sla ? (
                          <strong style={{ color: 'var(--color-semantic-error)' }}>
                            {num(p.waiting_days)} 日
                          </strong>
                        ) : `${num(p.waiting_days)} 日`}
                      </td>
                      <td className="num">{p.sla_days ? `${p.sla_days} 日` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {pending.length > 40 && (
                <p className="section-note" style={{ padding: 12 }}>
                  滞留の長い順に 40 件を表示（全 {num(pending.length)} 件）
                </p>
              )}
            </div>
          )}
        </Card>
      </div>

      <div className="section grid grid-2">
        <Card title="面接官別の負荷">
          {load.length === 0 ? <Empty>割り当てがまだない</Empty> : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>面接官</th>
                    <th className="num">待ち</th>
                    <th className="num">提出済</th>
                    <th className="num">保留</th>
                    <th className="num">平均日数</th>
                  </tr>
                </thead>
                <tbody>
                  {load.map((l) => (
                    <tr key={l.interviewer}>
                      <td>{l.interviewer}</td>
                      <td className="num">{num(l.pending)}</td>
                      <td className="num">{num(l.submitted)}</td>
                      <td className="num">{num(l.held)}</td>
                      <td className="num">{l.avg_turnaround_days ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="保留">
          {held.length === 0 ? <Empty>保留はない</Empty> : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>応募者</th><th>理由</th><th className="num">経過</th></tr>
                </thead>
                <tbody>
                  {held.map((h) => (
                    <tr key={h.evaluation_id}>
                      <td>{h.applicant_name}<br />
                        <span className="section-note">{h.step_name}</span></td>
                      <td>{h.hold_reason}</td>
                      <td className="num">{num(h.waiting_days)} 日</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="section">
        <Card title="利益相反">
          {conflicts.length === 0 ? <Empty>検出されていない</Empty> : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>応募者</th><th>面接官</th><th>ステップ</th><th>種別</th><th>状態</th></tr>
                </thead>
                <tbody>
                  {conflicts.map((c, i) => (
                    <tr key={i}>
                      <td>{c.applicant_name}</td>
                      <td>{c.interviewer}</td>
                      <td>{c.step_name}</td>
                      <td>
                        <span className="badge-tag-purple">
                          {c.conflict_type === 'self' ? '本人' : '紹介者'}
                        </span>
                      </td>
                      <td>{c.state}</td>
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

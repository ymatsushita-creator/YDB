import { getDb } from '../../src/db/server.ts'
import {
  listSeasons, getSeason, getPendingEvaluations, getHeldEvaluations,
  getInterviewerLoad, getConflicts, getUnassignedSummary,
} from '../../src/queries/dashboard.ts'
import { Card, Kpi, SeasonTabs, Empty, num } from '../_components/ui.tsx'

export const dynamic = 'force-dynamic'

export default async function OperationsPage(
  { searchParams }: { searchParams: Promise<{ season?: string }> },
) {
  const db = await getDb()
  const seasons = await listSeasons(db)
  if (seasons.length === 0) {
    return <Empty>年度が登録されていない。<code>pnpm db:reset</code> を実行する。</Empty>
  }

  const requested = (await searchParams).season
  const season =
    (requested ? await getSeason(db, requested) : null) ??
    seasons.find((s) => s.is_live) ?? seasons[0]!

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
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{season.enrollment_year} 年度の選考オペレーション</h1>
          <p className="page-sub">
            {season.is_live ? '進行中' : '終了した年度を表示している'}
          </p>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <SeasonTabs seasons={seasons} currentId={season.id} basePath="/operations" />
        </div>
      </div>

      <div className="grid grid-kpi">
        <Kpi label="判断待ち" value={num(pending.length)}
             tone={pending.length ? undefined : 'muted'} meta="pending の評価" />
        <Kpi label="SLA 超過" value={num(overSla.length)}
             tone={overSla.length ? undefined : 'muted'}
             meta="ステップごとの sla_days を超えて滞留" />
        <Kpi label="担当未割当" value={num(unassignedCount)}
             tone={unassignedCount ? undefined : 'muted'}
             meta={unassigned?.oldest_days ? `最長 ${num(unassigned.oldest_days)} 日` : '面接官が決まっていない'} />
        <Kpi label="保留" value={num(held.length)}
             tone={held.length ? undefined : 'muted'} meta="held の評価" />
        <Kpi label="利益相反" value={num(conflicts.length)}
             tone={conflicts.length ? undefined : 'muted'} meta="紹介者または本人が面接官" />
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
        <Card title="判断待ちの評価" note="滞留の起点は割り当て時刻。基準日は運用タイムゾーンの今日">
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
        <Card title="面接官別の負荷" note="偏りは滞留の原因になる">
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

        <Card title="保留" note="理由が必須なので、必ず読める形で残る">
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
        <Card title="利益相反" note="紹介チャネルの合格率が実力かバイアスかの検証に使う">
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

      <p className="footnote">
        滞留日数は <code>jst_today() - jst_date(assigned_at)</code>。
        <code>CURRENT_DATE</code> は接続のタイムゾーン依存のため使っていない。
      </p>
    </>
  )
}

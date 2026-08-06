import { getDb } from '../src/db/server.ts'
import {
  listSeasons, getSeason, getFunnel, getSummary, getStepFlow,
  getChannelPerformance, getWithdrawReasons, ACTIVE_WINDOW_DAYS,
} from '../src/queries/dashboard.ts'
import { Card, Kpi, SeasonTabs, Empty, num, pct, ymd } from './_components/ui.tsx'
import { TimeSeries, Legend, FunnelStages } from './_components/charts.tsx'

export const dynamic = 'force-dynamic'

const SERIES = [
  { key: 'applicant_cum', label: '木（応募）', color: 'var(--color-primary)' },
  { key: 'accepted_cum', label: '幹（合格）', color: 'var(--color-brand-green)' },
  { key: 'net_accepted_cum', label: '純幹（辞退控除後）', color: 'var(--color-brand-teal)', dashed: true },
  { key: 'rejected_cum', label: '不合格', color: 'var(--color-stone)' },
  { key: 'withdrawn_cum', label: '辞退', color: 'var(--color-brand-orange)' },
] as const

const GROVE = [
  { key: 'identified_person_cum', label: `林（直近${ACTIVE_WINDOW_DAYS}日に接点のある人）`,
    color: 'var(--color-brand-purple)' },
] as const

export default async function FunnelPage(
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

  const [summary, funnel, steps, channels, withdrawals] = await Promise.all([
    getSummary(db, season.id),
    getFunnel(db, season.id),
    getStepFlow(db, season.id),
    getChannelPerformance(db, season.id),
    getWithdrawReasons(db, season.id),
  ])

  const s = summary ?? {
    identified_person: 0, applicant: 0, accepted: 0, net_accepted: 0,
    rejected: 0, withdrawn: 0, in_progress: 0, reapplicant: 0,
  }
  const capacity = season.capacity ?? 0
  const target = season.target_application_count ?? 0

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{season.enrollment_year} 年度のファネル</h1>
          <p className="page-sub">
            {ymd(season.application_open_date)} 〜 {ymd(season.selection_end_date)}
            {season.is_live && ' ・ 進行中'}
          </p>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <SeasonTabs seasons={seasons} currentId={season.id} basePath="/" />
        </div>
      </div>

      <div className="grid grid-kpi">
        <Kpi label="林" value={num(s.identified_person)}
             meta={`直近 ${ACTIVE_WINDOW_DAYS} 日に接点がある人`} />
        <Kpi label="木（応募）" value={num(s.applicant)}
             meta={target ? `目標 ${num(target)} に対して ${pct(s.applicant, target)}` : undefined}
             fill={target ? { ratio: s.applicant / target } : undefined} />
        <Kpi label="幹（合格）" value={num(s.accepted)}
             meta={`到達した事実。辞退があっても減らない`} />
        <Kpi label="純幹" value={num(s.net_accepted)}
             meta={capacity ? `定員 ${num(capacity)} に対して ${pct(s.net_accepted, capacity)}` : undefined}
             fill={capacity ? { ratio: s.net_accepted / capacity, over: s.net_accepted > capacity } : undefined} />
        <Kpi label="選考中" value={num(s.in_progress)} tone={s.in_progress ? undefined : 'muted'}
             meta="まだ結論が出ていない応募" />
      </div>

      <div className="section grid grid-2">
        <Card title="段" note="林は人、木と幹は応募。単位が違うので同じ軸には載せない">
          <FunnelStages stages={[
            { label: '林 identified_person', value: s.identified_person,
              note: '（人）', color: 'var(--color-brand-purple)' },
            { label: '木 applicant', value: s.applicant,
              note: '（応募）', color: 'var(--color-primary)' },
            { label: '幹 accepted', value: s.accepted,
              note: '（応募）', color: 'var(--color-brand-green)' },
            { label: '純幹 net accepted', value: s.net_accepted,
              note: '（辞退控除後）', color: 'var(--color-brand-teal)' },
          ]} />
          <p className="section-note" style={{ marginTop: 16 }}>
            不合格 {num(s.rejected)} ・ 辞退 {num(s.withdrawn)} ・ 再応募 {num(s.reapplicant)}
          </p>
        </Card>

        <Card title="ステップ別の到達と通過" note="どこで落ちているか">
          {steps.length === 0 ? <Empty>選考ステップが未定義</Empty> : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>ステップ</th>
                    <th className="num">到達</th>
                    <th className="num">通過</th>
                    <th className="num">通過率</th>
                  </tr>
                </thead>
                <tbody>
                  {steps.map((st) => (
                    <tr key={st.sort_order}>
                      <td>{st.sort_order}. {st.name}</td>
                      <td className="num">{num(st.reached)}</td>
                      <td className="num">{num(st.passed)}</td>
                      <td className="num">{pct(Number(st.passed), Number(st.reached))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="section">
        <Card title="日次の累積" note="到達したことがあるかで数える。差し戻しがあっても戻らない">
          <TimeSeries points={funnel} series={[...SERIES]} valueLabel="応募と選考結果" />
          <Legend series={[...SERIES]} />
        </Card>
      </div>

      <div className="section">
        <Card title="林の推移" note={`その日から遡って ${ACTIVE_WINDOW_DAYS} 日以内に接点がある人。累積ではない`}>
          <TimeSeries points={funnel} series={[...GROVE]} height={160} valueLabel="林" />
        </Card>
      </div>

      <div className="section grid grid-2">
        <Card title="チャネル別" note="初回接触アトリビューション">
          {channels.length === 0 ? <Empty>接点がまだない</Empty> : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>チャネル</th>
                    <th className="num">林</th>
                    <th className="num">木</th>
                    <th className="num">幹</th>
                    <th className="num">応募率</th>
                  </tr>
                </thead>
                <tbody>
                  {channels.map((c) => (
                    <tr key={c.channel}>
                      <td>
                        {c.channel}
                        {c.self_report_group && (
                          <span className="section-note"> · {c.self_report_group}</span>
                        )}
                      </td>
                      <td className="num">{num(c.identified)}</td>
                      <td className="num">{num(c.applicants)}</td>
                      <td className="num">{num(c.accepted)}</td>
                      <td className="num">{pct(Number(c.applicants), Number(c.identified))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="辞退理由" note="不合格と混ぜない。チャネルの質を表す">
          {withdrawals.length === 0 ? <Empty>辞退はまだ記録されていない</Empty> : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>理由</th><th className="num">件数</th></tr></thead>
                <tbody>
                  {withdrawals.map((w) => (
                    <tr key={w.label}>
                      <td>{w.label}</td>
                      <td className="num">{num(w.count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <p className="footnote">
        すべての日付境界は <code>jst_date()</code> を通している。
        接続のタイムゾーンが変わっても集計値は動かない。
        訂正された遷移は <code>v_effective_status_histories</code> で解決済み。
      </p>
    </>
  )
}

import { getDb } from '../src/db/server.ts'
import {
  listSeasons, getSeason, getFunnel, getSummary, getStepFlow,
  getChannelPerformance, getWithdrawReasons, getReachConversion, ACTIVE_WINDOW_DAYS,
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

  const season =
    (await getSeason(db, (await searchParams).season)) ??
    seasons.find((s) => s.is_live) ?? seasons[0]!

  const [summary, funnel, steps, channels, withdrawals, reach] = await Promise.all([
    getSummary(db, season.id),
    getFunnel(db, season.id),
    getStepFlow(db, season.id),
    getChannelPerformance(db, season.id),
    getWithdrawReasons(db, season.id),
    getReachConversion(db, season.id),
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
        <Card title="段">
          <FunnelStages stages={[
            { label: '林 identified_person', value: s.identified_person,
              note: '（人）', color: 'var(--color-brand-purple)' },
            // 林（人）→ 木（応募）は単位が違ううえ、日次では母集団の定義も違う。
            // 割り算を出さない。年度単位の転換率は下のカードで出す。
            { label: '木 applicant', value: s.applicant,
              note: '（応募）', color: 'var(--color-primary)', showRatio: false },
            { label: '幹 accepted', value: s.accepted,
              note: '（応募）', color: 'var(--color-brand-green)' },
            { label: '純幹 net accepted', value: s.net_accepted,
              note: '（辞退控除後）', color: 'var(--color-brand-teal)' },
          ]} />
          <p className="section-note" style={{ marginTop: 16 }}>
            不合格 {num(s.rejected)} ・ 辞退 {num(s.withdrawn)} ・ 再応募 {num(s.reapplicant)}
          </p>
          <p className="unit-note">
            林は人数、木・幹は応募件数。同一人物が複数年度に応募すると
            木・幹は重複しうる。林は直近 {ACTIVE_WINDOW_DAYS} 日のローリング、
            木・幹は年度の累積なので、この2段の間で割り算はしていない。
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
        <Card
          title="年度の 林 → 木 転換率"
          note="日次ではなく期間全体で数える。分母も分子も実人数"
        >
          {!reach ? <Empty>年度が取得できない</Empty> : (
            <div className="row-between" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 16 }}>
              <div>
                <span className="kpi-value">
                  {pct(Number(reach.applied_persons), Number(reach.reached_persons))}
                </span>
                <span className="kpi-meta">
                  {'  '}{num(reach.reached_persons)} 人が接点を持ち、
                  {num(reach.applied_persons)} 人が応募した
                </span>
              </div>
              <span className={reach.is_final ? 'badge-tag-green' : 'badge-tag-orange'}>
                {reach.is_final ? '確定' : '暫定'}
              </span>
            </div>
          )}
          {reach && (
            <p className="unit-note">
              分母は募集期間（{ymd(reach.period_from)} 〜 {ymd(reach.period_to)}）に
              一度でも接点があった人の実人数。ローリングウィンドウではないので
              窓の幅に依存しない。
              {reach.is_final
                ? ' 選考完了日を過ぎたため確定値。'
                : ' 選考完了日までは分母が増え続けるため暫定値。'}
            </p>
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
          <p className="unit-note">
            アクティブ判定の窓 {ACTIVE_WINDOW_DAYS} 日は<strong>仮の値</strong>。
            運用データが溜まってから、スコアリングの減衰半減期と合わせて決める。
            窓を変えると林の人数も、上の年度転換率以外の転換率もすべて動く。
          </p>
        </Card>
      </div>

      <div className="section grid grid-2">
        <Card title="チャネル別" note="初回接触アトリビューション。人数列は林ではなく、その年度の初回接触の累積">
          {channels.length === 0 ? <Empty>接点がまだない</Empty> : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>チャネル</th>
                    <th className="num">初回接触</th>
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
                      <td className="num">{num(c.first_touch_persons)}</td>
                      <td className="num">{num(c.applicants)}</td>
                      <td className="num">{num(c.accepted)}</td>
                      <td className="num">
                        {pct(Number(c.applicants), Number(c.first_touch_persons))}
                      </td>
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
        林のアクティブ判定窓 <code>{ACTIVE_WINDOW_DAYS}</code> 日は仮の値で、正式な日数は未決定。
      </p>
    </>
  )
}

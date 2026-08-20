import { getDb } from '../../src/db/server.ts'
import {
  listSeasons, defaultSeason, getSeason, getFunnel, getSummary, getStepFlow,
  getChannelPerformance, getWithdrawReasons, getReachConversion, ACTIVE_WINDOW_DAYS,
  listCourseTargets,
} from '../../src/queries/dashboard.ts'
import { Card, Kpi, Empty, num, pct, ymd } from '../_components/ui.tsx'
import { TimeSeries, Legend, FunnelStages } from '../_components/charts.tsx'
import { Shell, Breadcrumb, YearSwitch, seasonLabel } from '../_components/shell.tsx'

export const dynamic = 'force-dynamic'

const SERIES = [
  { key: 'applicant_cum', label: '応募', color: 'var(--color-primary)' },
  { key: 'accepted_cum', label: '合格', color: 'var(--color-brand-lime-deep)' },
  { key: 'net_accepted_cum', label: '辞退控除後の合格', color: 'var(--color-brand-cyan-deep)', dashed: true },
  { key: 'rejected_cum', label: '不合格', color: 'var(--color-mute)' },
  { key: 'withdrawn_cum', label: '辞退', color: 'var(--color-brand-coral-deep)' },
] as const

const GROVE = [
  { key: 'identified_person_cum', label: `接点継続中（直近${ACTIVE_WINDOW_DAYS}日に接点のある人）`,
    color: 'var(--color-brand-periwinkle)' },
] as const

export default async function FunnelPage(
  { searchParams }: { searchParams: Promise<{ season?: string }> },
) {
  const db = await getDb()
  const seasons = await listSeasons(db)
  if (seasons.length === 0) {
    return <Shell active="approach"><Empty>年度が登録されていない。<code>pnpm db:reset</code> を実行する。</Empty></Shell>
  }

  const season =
    (await getSeason(db, (await searchParams).season)) ??
    defaultSeason(seasons)!

  const [summary, funnel, steps, channels, withdrawals, reach, targets] = await Promise.all([
    getSummary(db, season.id),
    getFunnel(db, season.id),
    getStepFlow(db, season.id),
    getChannelPerformance(db, season.id),
    getWithdrawReasons(db, season.id),
    getReachConversion(db, season.id),
    // KPI目標（0043。C-179）。取り込んであったのに読んでいなかった。
    listCourseTargets(db, season.id),
  ])

  const s = summary ?? {
    identified_person: 0, applicant: 0, accepted: 0, net_accepted: 0,
    rejected: 0, withdrawn: 0, in_progress: 0, reapplicant: 0,
  }
  const capacity = season.capacity ?? 0
  const target = season.target_application_count ?? 0

  return (
    <Shell active="approach" seasonId={season.id}
      years={<YearSwitch seasons={seasons} currentId={season.id} basePath="/funnel" />}>
      <Breadcrumb
        root={seasonLabel(season)}
        crumbs={[
          { label: '連携団体', href: '/approach' },
          { label: 'ファネル' },
        ]}
      />

      <div className="page-head">
        <div>
          <h1 className="page-title">{season.enrollment_year} 年度のファネル</h1>
          <p className="page-sub">
            {ymd(season.application_open_date)} 〜 {ymd(season.selection_end_date)}
            {season.is_live && ' ・ 進行中'}
          </p>
        </div>
      </div>

      <div className="grid grid-kpi">
        <Kpi label="接点継続中" value={num(s.identified_person)}
             meta={`直近 ${ACTIVE_WINDOW_DAYS} 日に接点がある人`} />
        <Kpi label="応募" value={num(s.applicant)}
             meta={target ? `目標 ${num(target)} に対して ${pct(s.applicant, target)}` : undefined}
             fill={target ? { ratio: s.applicant / target } : undefined} />
        <Kpi label="合格" value={num(s.accepted)}
             meta="人" />
        <Kpi label="辞退控除後の合格" value={num(s.net_accepted)}
             meta={capacity ? `定員 ${num(capacity)} に対して ${pct(s.net_accepted, capacity)}` : undefined}
             fill={capacity ? { ratio: s.net_accepted / capacity, over: s.net_accepted > capacity } : undefined} />
        <Kpi label="選考中" value={num(s.in_progress)} tone={s.in_progress ? undefined : 'muted'}
             meta="件" />
      </div>

      <div className="section grid grid-2">
        <Card title="段">
          <FunnelStages stages={[
            { label: '接点継続中', value: s.identified_person,
              note: '（人）', color: 'var(--color-brand-periwinkle)' },
            // 接点継続中（人）→ 応募（件）は単位が違い、日次では母集団も違う。
            // 割り算を出さない。年度単位の転換率は下のカードで出す。
            { label: '応募 applicant', value: s.applicant,
              note: '（応募）', color: 'var(--color-primary)', showRatio: false },
            { label: '合格 accepted', value: s.accepted,
              note: '（応募）', color: 'var(--color-brand-lime-deep)' },
            { label: '辞退控除後の合格 net accepted', value: s.net_accepted,
              note: '（辞退控除後）', color: 'var(--color-brand-cyan-deep)' },
          ]} />
          <p className="section-note" style={{ marginTop: 16 }}>
            不合格 {num(s.rejected)} ・ 辞退 {num(s.withdrawn)} ・ 再応募 {num(s.reapplicant)}
          </p>
        </Card>

        <Card title="ステップ別の到達と通過">
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

      {/* ★ KPI目標（0043。C-179。依頼者の指示）。
          応募管理表から取り込んだ目標を、初めて画面に出す。
          ★ 実績の列は**作らない** ―― 目標の区分（コース別・施策別）に
            対応する区分が記録の側に無い。当てると違う母集団の割り算になる。 */}
      {targets.length > 0 && (
        <div className="section">
          <Card title={`募集の目標（${num(targets.length)} 束）`}>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>区分</th><th>コース／施策</th><th>対象</th>
                    <th className="num">合格</th><th className="num">応募</th>
                    <th className="num">説明会</th><th className="num">リーチ</th>
                  </tr>
                </thead>
                <tbody>
                  {targets.map((t) => (
                    <tr key={`${t.category}-${t.course_label}-${t.segment_label ?? ''}`}>
                      <td>{t.category}</td>
                      <th scope="row">{t.course_label}</th>
                      <td>{t.segment_label ?? <span className="section-note">全体</span>}</td>
                      <td className="num">{t.target_accepted ?? '—'}</td>
                      <td className="num">{t.target_applicants ?? '—'}</td>
                      <td className="num">{t.target_briefing ?? '—'}</td>
                      <td className="num">{t.target_reach ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      <div className="section">
        <Card
          title="年度の接点継続中 → 応募"
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
        </Card>
      </div>

      <div className="section">
        <Card title="日次の累積">
          <TimeSeries points={funnel} series={[...SERIES]} valueLabel="応募と選考結果" />
          <Legend series={[...SERIES]} />
        </Card>
      </div>

      <div className="section">
        <Card title="接点継続中の推移">
          <TimeSeries points={funnel} series={[...GROVE]} height={160} valueLabel="接点継続中" />
        </Card>
      </div>

      <div className="section grid grid-2">
        <Card title="チャネル別">
          {channels.length === 0 ? <Empty>接点がまだない</Empty> : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>チャネル</th>
                    <th className="num">初回接触</th>
                    <th className="num">応募</th>
                    <th className="num">合格</th>
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

        <Card title="辞退理由">
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

    </Shell>
  )
}

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getDb } from '../src/db/server.ts'
import { currentTier } from '../src/auth/current.ts'
import { canOpen } from '../src/auth/tiers.ts'
import {
  listSeasons, defaultSeason, getSeason, getSummary, getStepFlow,
  getPartnerReach, getChannelPerformance,
} from '../src/queries/dashboard.ts'
import { listConfidence } from '../src/queries/headhunting.ts'
import { listSeasonInterviews } from '../src/queries/interview.ts'
import { Card, Kpi, Empty, num, NotDerived } from './_components/ui.tsx'
import { FunnelStages } from './_components/charts.tsx'
import { Confidence } from './_components/headhunting.tsx'
import { Avatar } from './_components/borderline.tsx'
import { Shell, Breadcrumb, YearSwitch, seasonLabel } from './_components/shell.tsx'

export const dynamic = 'force-dynamic'

/**
 * ホーム（依頼者の指示。実行⑫）。
 *
 * 実行⑪までは画面を持たず、層ごとの行き先へ redirect するだけだった。
 * 依頼者の指示は「既存のタブの上にホーム（サマリーをビジュアライズ、
 * ピックアップ候補者を3人みたいな感じの画面）」。
 *
 * ★ 出すのは依頼者が選んだ3つ ―― **母集団と歩留まり・集客の効き・
 *   面接の進み具合**。「いま止まっているもの」は**選ばれなかったので出さない**
 *   （特別選考の「最新やること」と個人アプローチにある）。
 *
 * ★ **新しい定義を作っていない。** どの数字も既にある集計を呼ぶだけである ――
 *   歩留まり `getSummary` / `getStepFlow`、集客 `getPartnerReach` /
 *   `getChannelPerformance`、面接 `listSeasonInterviews`、
 *   ピックアップ `listConfidence`。**ホーム専用の集計を作ると定義が2つになる。**
 *
 * ★ 層ごとに出すものを変える（依頼者の指示）。判定は `canOpen` を見る ――
 *   ホーム専用の層判定を書かない（2箇所に分かれると必ず食い違う）。
 *   入力層には**数字を出さず、入力への入口だけ**を出す。
 *
 * ★ 単位と母集団は画面に書かない（C-62）。定義はクエリのコメントと
 *   `db/DECISIONS.md` にある。
 */
export default async function Home(
  { searchParams }: { searchParams: Promise<{ season?: string }> },
) {
  const tier = await currentTier()
  // 券が無ければ proxy に合言葉を聞かせる。**ここで既定の層に倒さない。**
  if (tier === null) redirect('/headhunting')

  const db = await getDb()
  const seasons = await listSeasons(db)
  const season = (await getSeason(db, (await searchParams).season)) ?? defaultSeason(seasons)

  // 入力層。**数字を1つも出さない** ―― 見る画面を開けない層に
  // 見る画面の抜粋を出すと、押せない案内が並ぶ。
  if (tier === 'input') {
    return (
      <Shell active="home" seasonId={season?.id}>
        <Breadcrumb root={season ? seasonLabel(season) : 'ホーム'}
                    crumbs={[{ label: 'ホーム' }]} />
        <div className="page-head">
          <div><h1 className="page-title">入力</h1></div>
        </div>
        <div className="section">
          <Card title="入れるもの">
            <ul className="stack">
              <li>
                <Link href={season ? `/people/new?season=${season.id}` : '/people/new'}>
                  候補者を追加 ›
                </Link>
              </li>
              <li>
                <Link href={season ? `/approach/new?season=${season.id}` : '/approach/new'}>
                  連携団体を追加 ›
                </Link>
              </li>
              <li><Link href="/staff/new">入力者を追加 ›</Link></li>
            </ul>
          </Card>
        </div>
      </Shell>
    )
  }

  if (!season) {
    return (
      <Shell active="home">
        <p className="hh-empty-shell">年度が1件も登録されていない。</p>
      </Shell>
    )
  }

  const [summary, steps, reach, channels, interviews, picks] = await Promise.all([
    getSummary(db, season.id),
    getStepFlow(db, season.id),
    getPartnerReach(db, season.id),
    // 流入元は**初回接触の実人数**（/funnel と同じ定義）。
    // アトリビューション3方式はここに出さない ―― 判断に使うのは初回である。
    getChannelPerformance(db, season.id),
    listSeasonInterviews(db, season.id),
    // ピックアップは**確度の上位3人**（依頼者の指示）。
    // 順位は 0017 が凍結した値で、ここで作り直していない。
    listConfidence(db, season.id, 3),
  ])

  // 面接の進み具合。**母集団は上のクエリが返した行そのもの**にする ――
  // 数え直すための問い合わせを増やすと、同じ問いに2つの定義ができる。
  const written = interviews.filter((i) => i.has_sheet).length
  const verdicts = {
    pass: interviews.filter((i) => i.recommendation === 'pass').length,
    border: interviews.filter((i) => i.recommendation === 'border').length,
    fail: interviews.filter((i) => i.recommendation === 'fail').length,
  }

  const opens = (href: string) => canOpen(tier, href)

  return (
    <Shell
      active="home"
      seasonId={season.id}
      years={<YearSwitch seasons={seasons} currentId={season.id} basePath="/" />}
    >
      <Breadcrumb root={seasonLabel(season)} crumbs={[{ label: 'ホーム' }]} />

      <div className="page-head">
        <div>
          <h1 className="page-title">ホーム</h1>
          <p className="page-sub">{seasonLabel(season)}</p>
        </div>
      </div>

      {/* --- 母集団と歩留まり --- */}
      <div className="section">
        <Card title="母集団と歩留まり">
          {!summary ? <Empty>この期の集計はまだ出せない</Empty> : (
            <>
              <FunnelStages stages={[
                { label: '接点継続中', value: summary.identified_person,
                  color: 'var(--color-brand-purple)' },
                // 人と応募は単位が違う。**割り算を出さない。**
                { label: '応募', value: summary.applicant,
                  color: 'var(--color-primary)', showRatio: false },
                { label: '合格', value: summary.accepted, color: 'var(--color-brand-green)' },
                { label: '辞退控除後の合格', value: summary.net_accepted,
                  color: 'var(--color-brand-teal)' },
              ]} />
              <div className="grid grid-kpi" style={{ marginTop: 'var(--space-lg)' }}>
                <Kpi label="選考中" value={num(summary.in_progress)} />
                <Kpi label="不合格" value={num(summary.rejected)} />
                <Kpi label="辞退" value={num(summary.withdrawn)} />
              </div>
              {steps.length > 0 && (
                <div className="table-wrap" style={{ marginTop: 'var(--space-lg)' }}>
                  <table className="data">
                    <thead>
                      <tr><th>段</th><th className="num">到達</th><th className="num">通過</th></tr>
                    </thead>
                    <tbody>
                      {steps.map((s) => (
                        <tr key={s.sort_order}>
                          <td>{s.name}</td>
                          <td className="num strong">{num(s.reached)}</td>
                          <td className="num">{num(s.passed)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {opens('/funnel') && (
                <Link href={`/funnel?season=${season.id}`} className="hh-more">
                  ファネルへ ›
                </Link>
              )}
            </>
          )}
        </Card>
      </div>

      {/* --- 集客の効き --- */}
      <div className="section">
        <Card title="集客の効き">
          {reach.length === 0 && channels.length === 0 ? (
            <Empty>この期の集客の記録はまだ無い</Empty>
          ) : (
            <>
              <div className="grid grid-2">
                <div>
                  <h3 className="hh-sub">団体</h3>
                  {reach.length === 0 ? <Empty>接触の記録が無い</Empty> : (
                    <table className="data">
                      <thead>
                        <tr>
                          <th>団体</th>
                          <th className="num">接触</th>
                          <th className="num">識別</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reach.slice(0, 5).map((r) => (
                          <tr key={r.partner_id}>
                            <td className="cell-name">{r.partner_name}</td>
                            <td className="num">{num(r.contact_occasions)}</td>
                            <td className="num strong">{num(r.identified_count)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
                <div>
                  <h3 className="hh-sub">流入元</h3>
                  {channels.length === 0 ? <Empty>接点の記録が無い</Empty> : (
                    <table className="data">
                      <thead>
                        <tr><th>流入元</th><th className="num">人</th></tr>
                      </thead>
                      <tbody>
                        {channels.slice(0, 5).map((c) => (
                          <tr key={c.channel}>
                            <td className="cell-name">{c.channel}</td>
                            <td className="num strong">{num(c.first_touch_persons)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
              {opens('/approach') && (
                <Link href={`/approach?season=${season.id}`} className="hh-more">
                  団体アプローチへ ›
                </Link>
              )}
            </>
          )}
        </Card>
      </div>

      {/* --- 面接の進み具合 --- */}
      <div className="section">
        <Card title="面接の進み具合">
          {interviews.length === 0 ? <Empty>この期の面接はまだ無い</Empty> : (
            <>
              <div className="grid grid-kpi">
                <Kpi label="シート記入済み"
                     value={`${num(written)} / ${num(interviews.length)}`} />
                <Kpi label="合格" value={num(verdicts.pass)} />
                <Kpi label="ボーダー" value={num(verdicts.border)} />
                <Kpi label="不合格" value={num(verdicts.fail)} />
              </div>
              {opens('/interviews') && (
                <Link href={`/interviews?season=${season.id}`} className="hh-more">
                  面接へ ›
                </Link>
              )}
            </>
          )}
        </Card>
      </div>

      {/* --- ピックアップ候補者3人（依頼者の指示。確度の上位） --- */}
      <div className="section">
        <Card title="ピックアップ候補者">
          {picks.length === 0 ? (
            <Empty>確度がまだ算出されていない</Empty>
          ) : (
            <>
              <ul className="hh-list">
                {picks.map((p) => (
                  <li key={p.person_id}>
                    <Link href={`/people/${p.person_id}?season=${season.id}`}
                          className="hh-list-name bl-person">
                      <Avatar src={p.photo_data_url} name={p.person_name} />
                      {p.person_name}
                    </Link>
                    <span className="hh-list-conf">
                      {p.confidence_ratio === null
                        ? <NotDerived />
                        : <Confidence ratio={p.confidence_ratio} />}
                    </span>
                    <span className="sheet-result">{num(p.rank_in_season)} 位</span>
                  </li>
                ))}
              </ul>
              {opens('/borderline') && (
                <Link href={`/borderline?season=${season.id}`} className="hh-more">
                  個人アプローチへ ›
                </Link>
              )}
            </>
          )}
        </Card>
      </div>
    </Shell>
  )
}

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getDb } from '../src/db/server.ts'
import { currentTier } from '../src/auth/current.ts'
import { canOpen, type Tier } from '../src/auth/tiers.ts'
import {
  listSeasons, defaultSeason, getSeason, getHomeTrends, hasScoringRules, getSummary,
} from '../src/queries/dashboard.ts'
import { listConfidence } from '../src/queries/headhunting.ts'
import { listKpis } from '../src/queries/kpi.ts'
import { listKpiMetrics } from '../src/queries/kpi_metrics.ts'
import { saveKpiAction } from './kpis/actions.ts'
import { Card, Empty, num, NotDerived } from './_components/ui.tsx'
import { TimeSeries, Legend } from './_components/charts.tsx'
import { Confidence } from './_components/headhunting.tsx'
import { Avatar } from './_components/borderline.tsx'
import { Shell, Breadcrumb, YearSwitch, seasonLabel } from './_components/shell.tsx'

export const dynamic = 'force-dynamic'

function HomeKpi(
  { label, value, href, derived = true, meta }:
  { label: string; value: number; href?: string; derived?: boolean; meta?: string },
) {
  const body = (
    <>
      <span className="home-kpi-label">{label}</span>
      {/* ★ 算出できていないものを 0 と出さない ―― 0017 が
          「無いことを 0 と書くと、それは嘘の数字になる」と書いた形（C-127）。 */}
      {derived
        ? <strong className="home-kpi-value">{num(value)}</strong>
        : <strong className="home-kpi-value"><NotDerived /></strong>}
      {/* ★「Aスペース」に目標との比較を出す（依頼者の指示。実行⑯。C-162）。
          目標が無いカードには出さない ―― 無い目標を0と書かない（C-127と同じ形）。 */}
      {meta && <span className="home-kpi-meta">{meta}</span>}
    </>
  )
  // ★ 開ける層にだけリンクにする。開けない層では素のタイルのまま
  //   （押すと弾かれる窓を残さない。canOpen 1箇所で判定＝タブと同じ線）。
  return href
    ? <Link className="home-kpi home-kpi-link" href={href}>{body}</Link>
    : <div className="home-kpi">{body}</div>
}

/**
 * ホーム（依頼者の指示。実行⑫）。
 *
 * 実行⑪までは画面を持たず、層ごとの行き先へ redirect するだけだった。
 * 依頼者の指示は「既存のタブの上にホーム（サマリーをビジュアライズ、
 * ピックアップ候補者を3人みたいな感じの画面）」。
 *
 * ★ 実行⑬で、候補者・連携団体数・通常選考者（確度A以上）・特別選考者の
 *   日次推移と、注目候補者3人だけへ組み直した。1画面で一覧する。
 * ★ 入力層には**数字を出さず、入力への入口だけ**を出す。
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
                  候補者を編集 ›
                </Link>
              </li>
              <li>
                <Link href={season ? `/approach/new?season=${season.id}` : '/approach/new'}>
                  連携団体を編集 ›
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

  const [trends, picks, hasRules, summary, kpis, kpiMetrics] = await Promise.all([
    getHomeTrends(db, season.id),
    listConfidence(db, season.id, 3),
    hasScoringRules(db),
    getSummary(db, season.id),
    listKpis(db, season.id),
    // ★ この画面からKPIを足すための選択肢（0049。C-204）。
    listKpiMetrics(db),
  ])
  // KPIを決められるのはALL権限だけ（コマンド側でも層を見る）。
  const canEditKpi = tier === 'all'

  // ★ 応募の目標との比較（実行⑯。依頼者の指示。C-152 で引き継いだ値を使う）。
  //   目標が無い期（未受領）では出さない ―― 無い目標を出さない（C-127 と同じ形）。
  const applicantTarget = season.target_application_count
  const applicantActual = summary?.applicant ?? 0
  const applicantMeta = applicantTarget
    ? `目標 ${num(applicantTarget)} ・ ${Math.round((applicantActual / applicantTarget) * 100)}%`
    : undefined
  // ★ 確度の系列は、算出規則があるときだけ出す（C-127）。
  //   規則が0件なら確度は誰にも付かないので、常に0の線になる ――
  //   それは「無いことを0と書く」ことである（0017）。
  const series = [
    { key: 'candidates' as const, label: '候補者', color: '#f03090' },
    { key: 'partners' as const, label: '連携団体数', color: '#f0f000' },
    // ★ 「確度A以上」と名乗っていたのをやめた（C-127）。**A は記録に無い格付け**で、
    //   応募管理表では A〜C・D〜I が特別選考の軸の記号（別の意味）である。
    //   閾値は画面に書かない（C-62）。定義はクエリのコメントと DECISIONS に置く。
    ...(hasRules
      ? [{ key: 'high_confidence' as const, label: '確度の高い候補者', color: '#50f000' }]
      : []),
    { key: 'special' as const, label: '特別選考者', color: '#00c0f0', dashed: true },
  ]
  const latest = trends.at(-1) ?? { candidates: 0, partners: 0, high_confidence: 0, special: 0 }

  // 気になったセクションから、その詳細タブへ飛べるようにする（依頼者の指示）。
  // 行き先は canOpen で守る ―― 開けない層（personal は特別選考を開けない）には
  // リンクを渡さず、素の表示に倒す。判定は tiers.ts の1箇所（タブと同じ線）。
  const to = (path: string): string | undefined =>
    canOpen(tier as Tier, path) ? `${path}?season=${season.id}` : undefined

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

      <div className="home-dashboard">
        <div className="home-summary-grid">
          <HomeKpi label="候補者" value={latest.candidates} href={to('/people')} />
          <HomeKpi label="連携団体" value={latest.partners} href={to('/approach')} />
          {/* ★ 確度は 0039 で**人が記入する**ものになった（C-206。実画面で確認）。
              算出規則の有無で「算出なし」と出すのは、算出していた頃の言い方で、
              いまは規則が無いのが正しい状態である。記入された人数を素直に出す。 */}
          <HomeKpi label="確度の高い候補者" value={latest.high_confidence}
                   href={to('/borderline')} />
          {/* ★ 開けない層には**数も出さない**（C-208。ペルソナ試験で見つけた）。
              平社員には特別選考のタブが出ないのに、人数だけ出ていた。
              押せない札に数字だけ載ると、「見せない」と決めた線が漏れる。 */}
          {canOpen(tier ?? 'input', '/headhunting') && (
            <HomeKpi label="特別選考" value={latest.special} href={to('/headhunting')} />
          )}
          {/* ★「Aスペース」に5枚目（実行⑯。依頼者の指示。C-162）――
              「応募」は「候補者」（識別できた人の累計）とは母集団が違う
              （C-62：単位の違う値を並べない）。既存カードへ相乗りさせず、
              別枠にする。目標が無い期では出さない（無い目標を0と書かない）。 */}
          {applicantMeta && (
            <HomeKpi label="応募（目標比）" value={applicantActual}
                     href={to('/funnel')} meta={applicantMeta} />
          )}
        </div>

        <div className="home-detail-grid">
        <div className="section">
          <Card title="推移" titleHref={to('/funnel')}>
            {trends.length < 2 ? <Empty>推移を描ける記録がまだ無い</Empty> : (
              <>
                {/* ★ 高さは器が決める（C-161）。300 は当て推量で、
                    画面が高いと図の下に灰色が残っていた。 */}
                <TimeSeries points={trends} series={series} height={220} valueLabel="候補者と選考" />
                <Legend series={series} />
              </>
            )}
          </Card>
        </div>

        <div className="section">
          <Card title="KPI" titleHref={to('/kpis')}>
            {/* ★ この画面から直接足せる（依頼者の指示。C-204）――
                KPIを見る場所と決める場所が別だと、見て気づいた瞬間に直せない。
                ★ 変数は**数えられる語だけ**（0049）。実績はその語から数える。
                ★ 足せるのはALL権限だけ（`saveKpiAction` が層を見る）。 */}
            {canEditKpi && (
              <form action={saveKpiAction} className="home-kpi-add editable-region">
                <input type="hidden" name="seasonId" value={season.id} />
                <input name="title" required maxLength={120} placeholder="題名" />
                <select name="metricKey" defaultValue="">
                  <option value="">変数なし</option>
                  {kpiMetrics.map((m) => (
                    <option key={m.key} value={m.key}>{m.label}</option>
                  ))}
                </select>
                <input name="value" required inputMode="decimal" placeholder="目標" />
                <input name="memo" maxLength={2000} placeholder="メモ" />
                <input type="hidden" name="variable" value="―" />
                <button className="button-primary" type="submit">足す</button>
              </form>
            )}
            {kpis.length === 0 ? <Empty>KPIはまだ登録されていない</Empty> : (
              <div className="home-kpi-results">
                {kpis.map((kpi) => (
                  <article className="kpi-result-card" key={kpi.id}>
                    <span>{kpi.title}</span>
                    <strong>{num(kpi.value)}</strong>
                    <small>{kpi.variable}</small>
                    {kpi.memo && <p>{kpi.memo}</p>}
                  </article>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="section">
        <Card title="ピックアップ候補者" titleHref={to('/headhunting')}>
          {picks.length === 0 ? (
            <Empty>確度がまだ記入されていない</Empty>
          ) : (
            <>
              <div className="pick-list">
                {picks.map((p) => (
                  <Link key={p.person_id} className="pick-card"
                        href={`/people/${p.person_id}?season=${season.id}`}>
                    <span className="pick-head">
                      <Avatar src={p.photo_data_url} name={p.person_name} />
                      <span>
                        <span className="pick-name">{p.person_name}</span>
                        <span className="pick-rank" style={{ display: 'block' }}>
                          {num(p.rank_in_season)} 位
                        </span>
                      </span>
                    </span>
                    {p.confidence_ratio === null ? <NotDerived /> : (
                      <>
                        <Confidence ratio={p.confidence_ratio} />
                        <span className="bar-track">
                          <span className="bar-fill"
                                style={{ width: `${Math.round(Number(p.confidence_ratio) * 100)}%` }} />
                        </span>
                      </>
                    )}
                  </Link>
                ))}
              </div>
            </>
          )}
        </Card>
        </div>
        </div>
      </div>

    </Shell>
  )
}

import Link from 'next/link'
import { getDb } from '../../src/db/server.ts'
import { listSeasons, defaultSeason, getSeason } from '../../src/queries/dashboard.ts'
import { listSeasonInterviews } from '../../src/queries/interview.ts'
import { Card, Empty, num, jstDay } from '../_components/ui.tsx'
import { Shell, Breadcrumb, YearSwitch, seasonLabel } from '../_components/shell.tsx'
import { Avatar } from '../_components/borderline.tsx'

export const dynamic = 'force-dynamic'

/**
 * 面接（依頼者の指示。実行⑩ ――「アプローチの下に作れ」）。
 *
 * 4つ目のタブ。その期の面接をすべて並べ、1枚ずつシートへ入る。
 *
 * ★ 段で絞らない。**面接の一覧は選考の一覧ではない。**
 *   書いた／書いていないの区別なく並べる ―― 書いていないものが
 *   見えないと、書き漏れに気づけない。
 *
 * ★ 並びは「まだ書いていないものが先」。書き終えたシートは読み返す用で、
 *   この画面で急ぐのは**空いているシート**である。
 */
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export default async function InterviewsPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const db = await getDb()

  const [seasons, seasonByParam] = await Promise.all([
    listSeasons(db),
    sp.season ? getSeason(db, sp.season) : Promise.resolve(null),
  ])
  const season = seasonByParam ?? defaultSeason(seasons)

  if (!season) {
    return (
      <Shell active="interview">
        <p className="hh-empty-shell">年度が1件も登録されていない。</p>
      </Shell>
    )
  }

  const rows = await listSeasonInterviews(db, season.id)
  
  // フィルター
  const tab = one(sp.tab) ?? 'all'
  const query = (one(sp.q) ?? '').trim().toLowerCase()
  const stepFilter = one(sp.step) ?? ''

  // 集計 KPI
  const totalCount = rows.length
  const unwrittenCount = rows.filter((r) => !r.has_sheet).length
  const writtenCount = rows.filter((r) => r.has_sheet).length
  const passCount = rows.filter((r) => r.recommendation === 'pass').length
  const borderCount = rows.filter((r) => r.recommendation === 'border').length
  const failCount = rows.filter((r) => r.recommendation === 'fail').length

  // ステップ一覧
  const steps = Array.from(new Set(rows.map((r) => r.step_name)))

  // 絞り込み適用
  let filtered = rows
  if (tab === 'unwritten') {
    filtered = filtered.filter((r) => !r.has_sheet)
  } else if (tab === 'written') {
    filtered = filtered.filter((r) => r.has_sheet)
  }

  if (stepFilter) {
    filtered = filtered.filter((r) => r.step_name === stepFilter)
  }

  if (query) {
    filtered = filtered.filter((r) => 
      r.person_name.toLowerCase().includes(query) ||
      r.school.toLowerCase().includes(query) ||
      (r.interviewer_name?.toLowerCase().includes(query) ?? false)
    )
  }

  const tabUrl = (t: string) => {
    const params = new URLSearchParams()
    if (season.id) params.set('season', season.id)
    if (t !== 'all') params.set('tab', t)
    if (stepFilter) params.set('step', stepFilter)
    if (query) params.set('q', query)
    const str = params.toString()
    return `/interviews${str ? `?${str}` : ''}`
  }

  return (
    <Shell
      active="interview"
      seasonId={season.id}
      years={<YearSwitch seasons={seasons} currentId={season.id} basePath="/interviews" />}
    >
      <Breadcrumb
        root={seasonLabel(season)}
        crumbs={[{ label: '面接・評価' }]}
      />

      <div className="page-head" style={{ marginBottom: 'var(--space-md)' }}>
        <div>
          <h1 className="page-title">面接・評価ダッシュボード</h1>
          <p className="page-sub">
            {seasonLabel(season)} の面接進捗とシート記入状況の一覧
          </p>
        </div>
      </div>

      {/* トップ KPI サマリーカード */}
      <div className="grid grid-4" style={{ marginBottom: 'var(--space-md)' }}>
        <div className="kpi-result-card">
          <div className="kpi-label">総面接件数</div>
          <div className="kpi-val">{num(totalCount)} <span className="kpi-unit">件</span></div>
          <div className="section-note">配属された全評価シート</div>
        </div>

        <div className="kpi-result-card">
          <div className="kpi-label">未記入（要対応）</div>
          <div className="kpi-val" style={{ color: unwrittenCount > 0 ? 'var(--color-error-deep)' : 'var(--color-ink)' }}>
            {num(unwrittenCount)} <span className="kpi-unit">件</span>
          </div>
          <div className="section-note">{unwrittenCount > 0 ? '早めの記入を推奨' : 'すべて記入完了'}</div>
        </div>

        <div className="kpi-result-card">
          <div className="kpi-label">評価記入済み</div>
          <div className="kpi-val" style={{ color: 'var(--color-success-deep)' }}>
            {num(writtenCount)} <span className="kpi-unit">件</span>
          </div>
          <div className="section-note">完了率 {totalCount ? Math.round((writtenCount / totalCount) * 100) : 0}%</div>
        </div>

        <div className="kpi-result-card">
          <div className="kpi-label">判定内訳</div>
          <div className="kpi-val" style={{ fontSize: '18px', gap: '8px', display: 'flex', alignItems: 'center' }}>
            <span style={{ color: 'var(--color-success-deep)' }}>合格 {passCount}</span>
            <span style={{ color: 'var(--color-warning-deep)' }}>保留 {borderCount}</span>
            <span style={{ color: 'var(--color-error-deep)' }}>見送 {failCount}</span>
          </div>
          <div className="section-note">面接官の最終所見</div>
        </div>
      </div>

      <div className="section">
        <Card title={`面接シート一覧 (${filtered.length} 件)`}>
          {/* 絞り込みタブ ＆ 検索バー */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
            <div className="bl-tabs">
              <Link href={tabUrl('all')} className={`bl-tab ${tab === 'all' ? 'is-on' : ''}`}>
                すべて ({totalCount})
              </Link>
              <Link href={tabUrl('unwritten')} className={`bl-tab ${tab === 'unwritten' ? 'is-on' : ''}`}>
                未記入 ({unwrittenCount})
              </Link>
              <Link href={tabUrl('written')} className={`bl-tab ${tab === 'written' ? 'is-on' : ''}`}>
                記入済み ({writtenCount})
              </Link>
            </div>

            <form method="get" action="/interviews" className="conf-row" style={{ margin: 0, gap: 'var(--space-xs)' }}>
              <input type="hidden" name="season" value={season.id} />
              {tab !== 'all' && <input type="hidden" name="tab" value={tab} />}
              
              {steps.length > 0 && (
                <select name="step" defaultValue={stepFilter} className="text-input" style={{ height: '34px', fontSize: '13px' }}>
                  <option value="">すべてのステップ</option>
                  {steps.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              )}

              <input
                className="text-input"
                name="q"
                defaultValue={query}
                placeholder="候補者名・学校名で検索..."
                style={{ width: '200px', height: '34px', fontSize: '13px' }}
              />
              <button type="submit" className="button-secondary button-secondary-sm" style={{ height: '34px' }}>検索</button>
            </form>
          </div>

          {filtered.length === 0 ? <Empty>条件に該当する面接シートはありません</Empty> : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>候補者</th>
                    <th>選考ステップ</th>
                    <th>担当面接官</th>
                    <th>シート状態</th>
                    <th>面接日</th>
                    <th className="num">採点した軸</th>
                    <th>面接官所見</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.evaluation_id}>
                      <td>
                        <Link href={`/interviews/${r.evaluation_id}`} className="bl-person" style={{ fontWeight: 600 }}>
                          <Avatar src={r.photo_data_url} name={r.person_name} />
                          {r.person_name}
                        </Link>
                        <div className="section-note">{r.school}</div>
                      </td>
                      <td className="nowrap">
                        <span style={{ fontWeight: 500 }}>{r.step_name}</span>
                        {r.attempt > 1 && (
                          <span className="badge-tag-purple" style={{ marginLeft: 6 }}>
                            {r.attempt} 回目
                          </span>
                        )}
                      </td>
                      <td>{r.interviewer_name ?? (
                        <span className="badge-tag-orange">未割当</span>
                      )}</td>
                      <td>
                        {r.has_sheet ? (
                          <span className="badge-tag-cyan" style={{ background: 'var(--color-success-soft)', color: 'var(--color-success-deep)', border: '1px solid var(--color-success)' }}>
                            記入完了
                          </span>
                        ) : (
                          <span className="badge-tag-orange" style={{ background: 'var(--color-warning-soft)', color: 'var(--color-warning-deep)', border: '1px solid var(--color-warning)' }}>
                            未記入
                          </span>
                        )}
                      </td>
                      <td className="nowrap">
                        {r.interviewed_on ? jstDay(r.interviewed_on) : <span className="section-note">未定</span>}
                      </td>
                      <td className="num">
                        <span style={{ fontWeight: 600 }}>{num(r.scored_criteria)}</span>
                        <span className="section-note"> / {num(r.total_criteria)} 軸</span>
                      </td>
                      <td>
                        {r.recommendation ? (
                          r.recommendation === 'pass' ? (
                            <span className="badge-tag-cyan" style={{ background: 'var(--color-success-soft)', color: 'var(--color-success-deep)', border: '1px solid var(--color-success)', fontWeight: 700 }}>
                              合格
                            </span>
                          ) : r.recommendation === 'border' ? (
                            <span className="badge-tag-orange" style={{ background: 'var(--color-warning-soft)', color: 'var(--color-warning-deep)', border: '1px solid var(--color-warning)', fontWeight: 700 }}>
                              ボーダー
                            </span>
                          ) : (
                            <span className="badge-tag-orange" style={{ background: 'var(--color-error-soft)', color: 'var(--color-error-deep)', border: '1px solid var(--color-error)', fontWeight: 700 }}>
                              不合格
                            </span>
                          )
                        ) : (
                          <span className="section-note">未判定</span>
                        )}
                      </td>
                      <td>
                        <Link
                          href={`/interviews/${r.evaluation_id}`}
                          className={r.has_sheet ? 'button-secondary button-secondary-sm' : 'button-primary button-primary-sm'}
                          style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
                        >
                          {r.has_sheet ? '開く ›' : 'シートを書く ›'}
                        </Link>
                      </td>
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

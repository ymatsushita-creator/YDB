import Link from 'next/link'
import { getDb } from '../../src/db/server.ts'
import { listSeasons, defaultSeason, getSeason } from '../../src/queries/dashboard.ts'
import { listSeasonInterviews } from '../../src/queries/interview.ts'
import { RECOMMENDATION_LABEL } from '../../src/commands/interview.ts'
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
export default async function InterviewsPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const db = await getDb()

  const seasons = await listSeasons(db)
  const season = (await getSeason(db, sp.season))
    ?? defaultSeason(seasons)

  if (!season) {
    return (
      <Shell active="interview">
        <p className="hh-empty-shell">年度が1件も登録されていない。</p>
      </Shell>
    )
  }

  const rows = await listSeasonInterviews(db, season.id)
  const unwritten = rows.filter((r) => !r.has_sheet).length

  return (
    <Shell
      active="interview"
      seasonId={season.id}
      years={<YearSwitch seasons={seasons} currentId={season.id} basePath="/interviews" />}
    >
      <Breadcrumb
        root={seasonLabel(season)}
        crumbs={[{ label: '面接' }]}
      />

      <div className="page-head">
        <div>
          <h1 className="page-title">面接</h1>
          <p className="page-sub">
            {num(rows.length)} 件 ・ 未記入 {num(unwritten)} 件
          </p>
        </div>
      </div>

      <div className="section">
        <Card title="面接シート">
          {rows.length === 0 ? <Empty>この期の面接はまだ無い</Empty> : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>候補者</th>
                    <th>段</th>
                    <th>面接官</th>
                    <th>面接日</th>
                    <th className="num">点</th>
                    <th>所見</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.evaluation_id}>
                      <td>
                        <Link href={`/interviews/${r.evaluation_id}`} className="bl-person">
                          <Avatar src={r.photo_data_url} name={r.person_name} />
                          {r.person_name}
                        </Link>
                        <div className="section-note">{r.school}</div>
                      </td>
                      <td className="nowrap">
                        {r.step_name}
                        {r.attempt > 1 && (
                          <span className="badge-tag-purple" style={{ marginLeft: 6 }}>
                            {r.attempt} 回目
                          </span>
                        )}
                      </td>
                      <td>{r.interviewer_name ?? (
                        <span className="badge-tag-orange">未割当</span>
                      )}</td>
                      <td className="nowrap">
                        {r.interviewed_on ? jstDay(r.interviewed_on) : '—'}
                      </td>
                      <td className="num">
                        {num(r.scored_criteria)}
                        <span className="section-note"> / {num(r.total_criteria)}</span>
                      </td>
                      <td>
                        {r.recommendation
                          ? RECOMMENDATION_LABEL[
                            r.recommendation as keyof typeof RECOMMENDATION_LABEL]
                          : <span className="section-note">—</span>}
                      </td>
                      <td>
                        <Link href={`/interviews/${r.evaluation_id}`}>
                          {r.has_sheet ? '開く' : '書く'}
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

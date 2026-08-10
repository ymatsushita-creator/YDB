import Link from 'next/link'
import { getDb } from '../../../src/db/server.ts'
import { listSeasons, getSeason } from '../../../src/queries/dashboard.ts'
import { getIntakeOptions, listChannelResponses } from '../../../src/queries/intake.ts'
import { ADD_REACH_MESSAGE } from '../../../src/commands/intake.ts'
import { addReachAction } from './actions.ts'
import { Card, Empty, num } from '../../_components/ui.tsx'
import { Shell, Breadcrumb, YearSwitch, seasonLabel } from '../../_components/shell.tsx'

export const dynamic = 'force-dynamic'

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

/**
 * アプローチ追加（依頼者の指示。実行⑩）。
 *
 * ★ 記録するのは「団体へ、いつ、どうやって接触したか」1件である。
 *   団体そのものは、無ければこの場で作る（名前が一意）。
 *
 * ★ 推定リーチは**空のままにできる。** 分からないものを 0 にすると
 *   「届かなかった」という別の事実になる。
 *
 * ★ 年度は接触した日から決まる。**近い期へ寄せない** ――
 *   どの期の期間にも入らない接触は、どの期にも紐づかないまま残る。
 */
export default async function NewReachPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const db = await getDb()

  const seasons = await listSeasons(db)
  const season = (await getSeason(db, sp.season))
    ?? seasons.find((s) => s.is_live)
    ?? seasons[0]

  if (!season) {
    return (
      <Shell active="approach">
        <p className="hh-empty-shell">年度が1件も登録されていない。</p>
      </Shell>
    )
  }

  const [options, channels] = await Promise.all([
    getIntakeOptions(db),
    listChannelResponses(db, season.id),
  ])

  const code = one(sp.add)
  const message = code
    ? ADD_REACH_MESSAGE[code as keyof typeof ADD_REACH_MESSAGE] ?? '記録できなかった。'
    : null

  return (
    <Shell
      active="approach"
      seasonId={season.id}
      years={<YearSwitch seasons={seasons} currentId={season.id} basePath="/approach/new" />}
    >
      <Breadcrumb
        root={seasonLabel(season)}
        crumbs={[
          { label: 'アプローチ', href: `/approach?season=${season.id}` },
          { label: 'アプローチ追加' },
        ]}
      />

      {message && <p className={`callout${code === 'saved' ? ' ok' : ''}`}>{message}</p>}

      <div className="page-head">
        <div>
          <h1 className="page-title">アプローチ追加</h1>
          <p className="page-sub">{seasonLabel(season)}</p>
        </div>
      </div>

      <form action={addReachAction} className="editable-region">
        <input type="hidden" name="seasonId" value={season.id} />

        <div className="section">
          <Card title="どの団体へ">
            <div className="iv-grid">
              <label className="iv-field">既にある団体
                <select name="partnerId" defaultValue="">
                  <option value="">（新しく作る）</option>
                  {options.partners.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              </label>
              <label className="iv-field">新しい団体の名前
                <input name="partnerName" />
              </label>
              <label className="iv-field">分類<input name="category" /></label>
              <label className="iv-field">窓口<input name="contactName" /></label>
              <label className="iv-field">窓口のメール
                <input name="contactEmail" type="email" />
              </label>
            </div>
          </Card>
        </div>

        <div className="section">
          <Card title="いつ、どうやって">
            <div className="iv-grid">
              <label className="iv-field">接触した日
                <input name="occurredOn" type="date" required />
              </label>
              <label className="iv-field">やり方<input name="method" /></label>
              <label className="iv-field">推定リーチ
                {/* 分からなければ空のまま。0 は「届かなかった」である。 */}
                <input name="estimatedReach" type="number" min={0} step={1} />
              </label>
            </div>
            <label className="iv-field iv-field-wide">記録
              <textarea name="note" rows={3} />
            </label>
            <button className="button-primary" type="submit">記録する</button>
          </Card>
        </div>
      </form>

      {/* --- SNS の土台。フォーム回答をチャネル別に数えたもの --- */}
      <div className="section">
        <Card title="フォーム回答のチャネル別">
          {channels.length === 0 ? (
            <Empty>この期に届いたフォーム回答はまだ無い</Empty>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>チャネル</th>
                    <th className="num">回答</th>
                    <th className="num">結び付いた回答</th>
                    <th className="num">人</th>
                  </tr>
                </thead>
                <tbody>
                  {channels.map((c, i) => (
                    <tr key={`${c.channel_name ?? c.channel_answer ?? 'none'}-${i}`}>
                      <td className="cell-name">
                        {c.channel_name ?? (
                          <span className="section-note">{c.channel_answer ?? '未回答'}</span>
                        )}
                        {c.channel_category === 'sns' && (
                          <span className="badge-tag-blue" style={{ marginLeft: 6 }}>SNS</span>
                        )}
                      </td>
                      <td className="num strong">{num(c.responses)}</td>
                      <td className="num">{num(c.matched)}</td>
                      <td className="num">{num(c.persons)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="section">
        <Link href={`/approach?season=${season.id}`} className="hh-more">
          ‹ 流入元へ戻る
        </Link>
      </div>
    </Shell>
  )
}

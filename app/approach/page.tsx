import Link from 'next/link'
import { getDb } from '../../src/db/server.ts'
import { all } from '../../src/db/client.ts'
import {
  listSeasons, defaultSeason, getSeason, getPartnerReach, getReachTotals,
  getChannelAttribution, 
} from '../../src/queries/dashboard.ts'
import { getIntakeOptions } from '../../src/queries/intake.ts'
import { listPartnerSheetRows, listReachSheetRows } from '../../src/queries/sheet.ts'
import { Card, Kpi, Empty, num, ymd } from '../_components/ui.tsx'
import { Shell, Breadcrumb, YearSwitch, seasonLabel } from '../_components/shell.tsx'
import { Avatar } from '../_components/borderline.tsx'
import { Sheet, type SheetColumn } from '../_components/sheet.tsx'
import { savePartnerSheetAction, saveReachSheetAction } from './sheet-actions.ts'

export const dynamic = 'force-dynamic'

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export default async function ApproachPage(
  { searchParams }: {
    searchParams: Promise<{ season?: string; view?: string; partner?: string }>
  },
) {
  const sp = await searchParams
  const db = await getDb()
  const [seasons, seasonByParam] = await Promise.all([
    listSeasons(db),
    sp.season ? getSeason(db, sp.season) : Promise.resolve(null),
  ])
  if (seasons.length === 0) {
    return <Shell active="approach"><Empty>年度が登録されていない。<code>pnpm db:reset</code> を実行する。</Empty></Shell>
  }
  const season = seasonByParam ?? defaultSeason(seasons)!

  const [partners, totals, attribution, partnerRows, options] = await Promise.all([
    getPartnerReach(db, season.id),
    getReachTotals(db, season.id),
    getChannelAttribution(db, season.id),
    // 実行⑫。表（入力）が読む行。**集計とは別のクエリ**である。
    // 推薦枠ステイタス（0035）は期ごとなので、どの期で読むかを渡す。
    listPartnerSheetRows(db, season.id),
    getIntakeOptions(db),
  ])

  // 推薦枠ステイタスのマスタ（0035）。**非活性は選ばせない**（原則3）。
  const recommendationStates = await all<{ id: string; label: string }>(db, `
    SELECT id, label FROM partner_recommendation_states
     WHERE is_active ORDER BY sort_order`)

  const reachTotal = Number(totals?.estimated_reach_total ?? 0)
  const identified = Number(totals?.identified_persons ?? 0)
  // 縦計は丸める前の値から作る。行ごとに丸めてから足すと、3列の合計が
  // 一致するという性質が表示の誤差で崩れる。
  const total = (key: 'first_touch' | 'last_touch' | 'linear') =>
    attribution.reduce((n, c) => n + Number(c[key]), 0)

  // 表をタブで切り替える。**縦に積むと画面がスクロールになる。**
  // 集計2つは「どこから来ているか」への答えなので同じ場所で切り替え、
  // 実行⑫で足した「団体を直す」（入力）も同じ並びに置く ――
  // ★ ただし**入力列と導出列を同じ表に混ぜない**（依頼者の指示で編集可能に
  //   したのは団体の属性であって、推定リーチや識別人数は導出値である）。
  const view = sp.view === 'channel' ? 'channel'
    : sp.view === 'edit' ? 'edit'
    : sp.view === 'partner' ? 'partner'
    // ★ 連携団体一覧（依頼者の指示。実行⑰。C-178）。
    //   「団体別のリーチ」は接点のある団体しか出ない ―― 170件のうち
    //   接点があるのは53件で、**残り117件はどの画面にも出ていなかった。**
    : sp.view === 'list' ? 'list'
    // 団体は期を持たない。3期に接触実績がまだ無くても、2期で登録した
    // 連携団体そのものは同じ一覧に出す。実績だけを見る画面を既定にすると、
    // 登録済みの団体が0件に見えてしまう。
    : 'list'
  const tabHref = (v: string, extra: Record<string, string> = {}) =>
    `/approach?${new URLSearchParams({ season: season.id, view: v, ...extra })}`
  // 団体の行を開いた先に、その団体の接触の表を出す（依頼者の指示）。
  const openPartnerId = one(sp.partner)
  const openPartner = partnerRows.find((p) => p.partner_id === openPartnerId) ?? null
  const reaches = openPartner ? await listReachSheetRows(db, openPartner.partner_id) : []

const PARTNER_CATEGORY_OPTIONS = [
  { id: 'アプローチ対象', label: 'アプローチ対象' },
  { id: '提携団体', label: '提携団体' },
  { id: '大学', label: '大学' },
  { id: '専門学校', label: '専門学校' },
  { id: '高校', label: '高校' },
  { id: 'NPO・社協', label: 'NPO・社協' },
  { id: '自治体・行政', label: '自治体・行政' },
  { id: 'パートナー企業', label: 'パートナー企業' },
  { id: 'その他', label: 'その他' },
]

  const partnerColumns: SheetColumn[] = [
    { key: 'category', label: '団体区分', type: 'select', options: PARTNER_CATEGORY_OPTIONS, width: 140 },
    { key: 'contactName', label: '先方担当者名', type: 'text', width: 130 },
    // 先方のどの部署か／NEO 側の受け持ち（0034。応募管理表 011 にあってDBに無かった）。
    { key: 'contactDepartment', label: '先方部署名', type: 'text', width: 160 },
    { key: 'contactEmail', label: '窓口メール', type: 'email', width: 180 },
    { key: 'internalOwner', label: '社内担当者', type: 'text', width: 120 },
    // ★ 応募管理表 011 にあってDBに無かった枠（0046。C-180。依頼者の指示）。
    //   空は「聞いていない」、0 は「枠が無い」。**別物なので埋めない。**
    { key: 'recommendationSeats', label: '推薦可能人数', type: 'number', width: 110 },
    { key: 'partneredOn', label: '提携期日', type: 'date', width: 130 },
    { key: 'bestContactPeriod', label: '最適連絡時期', type: 'text', width: 150 },
    { key: 'location', label: '所在地', type: 'text', width: 140 },
    // NEO としてどう関わるか（0031）。自由入力の1行（依頼者の判断）。
    { key: 'engagement', label: '関わり・連携メモ', type: 'text', width: 220 },
    // 推薦枠ステイタス（0035）。**その期のもの**を出す（期を変えれば変わる）。
    {
      key: 'recommendationStateId', label: '推薦枠', type: 'select', width: 150,
      options: recommendationStates.map((s) => ({ id: s.id, label: s.label })),
    },
    { key: 'staffId', label: '記録担当者', type: 'select', options: options.staffs, width: 130 },
  ]

  const reachColumns: SheetColumn[] = [
    { key: 'occurredOn', label: '接触した日', type: 'date' },
    { key: 'method', label: 'やり方', type: 'text', width: 130 },
    // 空は「分からない」。**0 は「届かなかった」**（埋めない）。
    { key: 'estimatedReach', label: '推定リーチ', type: 'number' },
    { key: 'note', label: '記録', type: 'text', width: 260 },
    { key: 'staffId', label: '入力者', type: 'select', options: options.staffs, width: 130 },
  ]

  // 検索クエリの適用
  const query = (one((sp as Record<string, string | string[] | undefined>).q) ?? '').trim().toLowerCase()
  const filteredPartnerRows = query
    ? partnerRows.filter((p) => p.name.toLowerCase().includes(query) || p.category?.toLowerCase().includes(query))
    : partnerRows
  const filteredPartners = query
    ? partners.filter((p) => p.partner_name.toLowerCase().includes(query))
    : partners

  return (
    <Shell active="approach" seasonId={season.id}
      years={<YearSwitch seasons={seasons} currentId={season.id} basePath="/approach" />}>
      <Breadcrumb
        root={seasonLabel(season)}
        crumbs={[
          { label: '連携団体', href: '/approach' },
        ]}
      />

      <div className="page-head">
        <div>
          <p className="page-sub">
            {season.is_live ? '進行中' : '終了'}
          </p>
        </div>
      </div>

      <div className="grid grid-kpi">
        <Kpi label="アプローチ可能圏（推定リーチ）" value={num(reachTotal)}
             tone={reachTotal ? undefined : 'muted'}
             meta="件" />
        <Kpi label="接触機会" value={num(totals?.contact_occasions)}
             tone={Number(totals?.contact_occasions ?? 0) ? undefined : 'muted'}
             meta={`${num(totals?.partners)} 団体`} />
        <Kpi label="団体経由で識別" value={num(identified)}
             tone={identified ? undefined : 'muted'}
             meta="人" />
      </div>

      <div className="section section-fixed" style={{ marginTop: 'var(--space-md)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div className="bl-tabs">
            <Link href={tabHref('list')}
                  className={view !== 'partner' ? 'bl-tab is-on btn-physical' : 'bl-tab btn-physical'}
                  aria-current={view !== 'partner' ? 'page' : undefined}>
              連携団体一覧・編集
            </Link>
            <Link href={tabHref('partner')}
                  className={view === 'partner' ? 'bl-tab is-on btn-physical' : 'bl-tab btn-physical'}
                  aria-current={view === 'partner' ? 'page' : undefined}>
              団体別のリーチ
            </Link>
          </div>
          <form method="get" action="/approach" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input type="hidden" name="season" value={season.id} />
            <input type="hidden" name="view" value={view} />
            <input
              type="search"
              name="q"
              defaultValue={query}
              placeholder="団体名・区分で検索..."
              className="text-input"
              style={{ height: 36, fontSize: 13, minWidth: 200 }}
            />
            <button type="submit" className="button-secondary" style={{ height: 36, padding: '0 12px', fontSize: 13 }}>
              検索
            </button>
          </form>
        </div>
      </div>

      <div className="section" hidden={view === 'partner'}>
        <Card title={`連携団体一覧・編集（${num(filteredPartnerRows.length)} 件）`}>
          {partnerRows.length === 0 ? (
            <Empty>連携団体がまだ1件も登録されていない</Empty>
          ) : filteredPartnerRows.length === 0 ? (
            <Empty>該当する連携団体がありません</Empty>
          ) : (
            <Sheet
              columns={partnerColumns}
              rows={filteredPartnerRows.map((p) => ({
                id: p.partner_id,
                lead: p.name,
                values: {
                  category: p.category ?? '',
                  contactName: p.contact_name ?? '',
                  contactDepartment: p.contact_department ?? '',
                  contactEmail: p.contact_email ?? '',
                  internalOwner: p.internal_owner ?? '',
                  recommendationSeats: p.recommendation_seats === null
                    ? '' : String(p.recommendation_seats),
                  partneredOn: p.partnered_on === null
                    ? '' : String(p.partnered_on).slice(0, 10),
                  bestContactPeriod: p.best_contact_period ?? '',
                  location: p.location ?? '',
                  engagement: p.engagement ?? '',
                  recommendationStateId: p.recommendation_state_id ?? '',
                  staffId: '',
                },
              }))}
              action={savePartnerSheetAction}
              hidden={{ seasonId: season.id }}
              leadLabel="団体"
              detail={{
                href: `/approach?season=${season.id}&view=edit&partner={id}`,
                label: '接触を開く',
              }}
              addLabel="新しい団体の行を追加"
            />
          )}
        </Card>
      </div>

      {openPartner && (
        <div className="section" hidden={view === 'partner'}>
          <p>
            <Link className="hh-more"
                  href={`/reach-zones/${openPartner.partner_id}?season=${season.id}`}>
              {openPartner.name} の面を見る ›
            </Link>
          </p>
          <Card title={`${openPartner.name} の接触`}>
            <Sheet
              columns={reachColumns}
              rows={reaches.map((r) => ({
                id: r.reach_id,
                lead: r.season_label ?? '期なし',
                values: {
                  occurredOn: r.occurred_on,
                  method: r.method ?? '',
                  estimatedReach: r.estimated_reach === null ? '' : String(r.estimated_reach),
                  note: r.note ?? '',
                  staffId: '',
                },
              }))}
              action={saveReachSheetAction}
              hidden={{ partnerId: openPartner.partner_id }}
              leadLabel="期"
            />
          </Card>
        </div>
      )}

      <div className="section" hidden={view !== 'partner'}>
        <Card title="団体別のリーチ">
          {filteredPartners.length === 0 ? (
            <Empty>該当する団体リーチがありません</Empty>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>団体</th>
                    <th>リーチ期間</th>
                    <th className="num">接触機会</th>
                    <th className="num">推定リーチ</th>
                    <th className="num">識別（人）</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPartners.map((p) => (
                    <tr key={p.partner_id}>
                      <td className="cell-name">
                        <Link href={tabHref('edit', { partner: p.partner_id })}
                              className="bl-person">
                          <Avatar src={p.photo_data_url} name={p.partner_name} />
                          {p.partner_name}
                        </Link>
                      </td>
                      <td className="nowrap mono">
                        {ymd(p.first_reach_on)} 〜 {ymd(p.last_reach_on)}
                      </td>
                      <td className="num">{num(p.contact_occasions)}</td>
                      <td className="num">{num(p.estimated_reach_total)}</td>
                      <td className="num">{num(p.identified_count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>


      <div className="section" hidden={view !== 'channel'}>
        <Card title="チャネル別のアトリビューション">
          {attribution.length === 0 ? (
            <Empty>この年度に帰属する接点がまだない</Empty>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>チャネル</th>
                    <th className="num">初回接触</th>
                    <th className="num">最終接触</th>
                    <th className="num">線形</th>
                  </tr>
                </thead>
                <tbody>
                  {attribution.map((c) => (
                    <tr key={c.channel}>
                      <td>
                        {c.channel}
                        {c.self_report_group && (
                          <span className="section-note"> · {c.self_report_group}</span>
                        )}
                      </td>
                      <td className="num">{num(c.first_touch)}</td>
                      <td className="num">{num(c.last_touch)}</td>
                      <td className="num">{Number(c.linear).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th>合計</th>
                    <th className="num">{num(total('first_touch'))}</th>
                    <th className="num">{num(total('last_touch'))}</th>
                    <th className="num">{total('linear').toFixed(2)}</th>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>
      </div>

    </Shell>
  )
}

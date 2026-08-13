import Link from 'next/link'
import { getDb } from '../../src/db/server.ts'
import {
  listSeasons, defaultSeason, getSeason, getPartnerReach, getReachTotals,
  getChannelAttribution, REACH_WINDOW_DAYS,
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
  const seasons = await listSeasons(db)
  if (seasons.length === 0) {
    return <Shell active="approach"><Empty>年度が登録されていない。<code>pnpm db:reset</code> を実行する。</Empty></Shell>
  }

  const season =
    (await getSeason(db, sp.season)) ??
    defaultSeason(seasons)!

  const [partners, totals, attribution, partnerRows, options] = await Promise.all([
    getPartnerReach(db, season.id),
    getReachTotals(db, season.id),
    getChannelAttribution(db, season.id),
    // 実行⑫。表（入力）が読む行。**集計とは別のクエリ**である。
    listPartnerSheetRows(db),
    getIntakeOptions(db),
  ])

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
  const view = sp.view === 'channel' ? 'channel' : sp.view === 'edit' ? 'edit' : 'partner'
  const tabHref = (v: string, extra: Record<string, string> = {}) =>
    `/approach?${new URLSearchParams({ season: season.id, view: v, ...extra })}`
  // 団体の行を開いた先に、その団体の接触の表を出す（依頼者の指示）。
  const openPartnerId = one(sp.partner)
  const openPartner = partnerRows.find((p) => p.partner_id === openPartnerId) ?? null
  const reaches = openPartner ? await listReachSheetRows(db, openPartner.partner_id) : []

  const partnerColumns: SheetColumn[] = [
    { key: 'category', label: '分類', type: 'text', width: 120 },
    { key: 'contactName', label: '窓口', type: 'text', width: 120 },
    { key: 'contactEmail', label: '窓口のメール', type: 'email', width: 190 },
    // NEO としてどう関わるか（0031）。自由入力の1行（依頼者の判断）。
    { key: 'engagement', label: 'NEO としての関わり', type: 'text', width: 220 },
    { key: 'staffId', label: '入力者', type: 'select', options: options.staffs, width: 130 },
  ]

  const reachColumns: SheetColumn[] = [
    { key: 'occurredOn', label: '接触した日', type: 'date' },
    { key: 'method', label: 'やり方', type: 'text', width: 130 },
    // 空は「分からない」。**0 は「届かなかった」**（埋めない）。
    { key: 'estimatedReach', label: '推定リーチ', type: 'number' },
    { key: 'note', label: '記録', type: 'text', width: 260 },
    { key: 'staffId', label: '入力者', type: 'select', options: options.staffs, width: 130 },
  ]

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
          <h1 className="page-title">{seasonLabel(season)}の流入元</h1>
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

      {/*
        「推定リーチに対する識別率」は出さない。分母は推定した接触機会、
        分子は実人数で、単位も数え方も違う。接点継続中から応募への比率を
        削除したのと同じ理由（DECISIONS D-3）。推定リーチから実人数への歩留まりを
        指標にしたいなら、estimated_reach が実測に置き換わってからにする。
      */}

      <div className="section">
        <Link href={`/approach/new?season=${season.id}`} className="hh-more">
          連携団体を追加 ›
        </Link>
      </div>

      <div className="section section-fixed">
        <div className="bl-tabs">
          <Link href={tabHref('partner')}
                className={view === 'partner' ? 'bl-tab is-on btn-physical' : 'bl-tab btn-physical'}
                aria-current={view === 'partner' ? 'page' : undefined}>
            団体別のリーチ
          </Link>
          <Link href={tabHref('channel')}
                className={view === 'channel' ? 'bl-tab is-on btn-physical' : 'bl-tab btn-physical'}
                aria-current={view === 'channel' ? 'page' : undefined}>
            チャネル別のアトリビューション
          </Link>
          {/* 実行⑫。依頼者の指示で、団体の属性をここで直せるようにした。 */}
          <Link href={tabHref('edit')}
                className={view === 'edit' ? 'bl-tab is-on btn-physical' : 'bl-tab btn-physical'}
                aria-current={view === 'edit' ? 'page' : undefined}>
            団体を直す
          </Link>
        </div>
      </div>

      <div className="section" hidden={view !== 'edit'}>
        <Card title="団体">
          {partnerRows.length === 0 ? (
            <Empty>団体がまだ1件も登録されていない</Empty>
          ) : (
            <Sheet
              columns={partnerColumns}
              rows={partnerRows.map((p) => ({
                id: p.partner_id,
                // 名前は表で直せない。**団体の同一性そのもの**である。
                lead: p.name,
                values: {
                  category: p.category ?? '',
                  contactName: p.contact_name ?? '',
                  contactEmail: p.contact_email ?? '',
                  engagement: p.engagement ?? '',
                  staffId: '',
                },
              }))}
              action={savePartnerSheetAction}
              leadLabel="団体"
              detail={{
                href: `/approach?season=${season.id}&view=edit&partner={id}`,
                label: '接触を開く',
              }}
              addLabel="行を追加（団体は「連携団体を追加」から）"
            />
          )}
        </Card>
      </div>

      {/* 団体の行を開いた先。**その団体の接触だけ**を並べる（依頼者の指示）。 */}
      {openPartner && (
        <div className="section" hidden={view !== 'edit'}>
          <Card title={`${openPartner.name} の接触`}>
            <Sheet
              columns={reachColumns}
              rows={reaches.map((r) => ({
                id: r.reach_id,
                // 期は日付から決まるので表では直せない（読み取りで添える）。
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
          {partners.length === 0 ? (
            <Empty>この年度の団体リーチは記録されていない</Empty>
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
                  {partners.map((p) => (
                    <tr key={p.partner_id}>
                      <td className="cell-name">
                        {/* 一覧で終わらせない（C-62）。押すとその団体の接触の表へ。 */}
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

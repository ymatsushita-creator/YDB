import { getDb } from '../../../src/db/server.ts'
import { all } from '../../../src/db/client.ts'
import { listSeasons, defaultSeason, getSeason } from '../../../src/queries/dashboard.ts'
import { getIntakeOptions } from '../../../src/queries/intake.ts'
import { listPartnerSheetRows } from '../../../src/queries/sheet.ts'
import { savePartnerSheetAction } from '../sheet-actions.ts'
import { Card, Empty } from '../../_components/ui.tsx'
import { Shell, Breadcrumb, YearSwitch, seasonLabel } from '../../_components/shell.tsx'
import { Sheet, type SheetColumn, type SheetRowData } from '../../_components/sheet.tsx'

export const dynamic = 'force-dynamic'

/** 候補者編集と同じく、新規と既存の連携団体を1枚の表で扱う（実行⑱）。 */
export default async function NewPartnerPage({ searchParams }: {
  searchParams: Promise<{ season?: string }>
}) {
  const sp = await searchParams
  const db = await getDb()
  const seasons = await listSeasons(db)
  const season = (await getSeason(db, sp.season)) ?? defaultSeason(seasons)
  if (!season) return <Shell active="approach"><Empty>年度が登録されていない。</Empty></Shell>

  const [rows, options, recommendationStates] = await Promise.all([
    listPartnerSheetRows(db, season.id),
    getIntakeOptions(db),
    all<{ id: string; label: string }>(db, `
      SELECT id, label FROM partner_recommendation_states
       WHERE is_active ORDER BY sort_order`),
  ])

  const columns: SheetColumn[] = [
    // 団体名は同一性なので、新規行だけ入力でき、既存行では読み取り専用。
    { key: 'name', label: '団体名', type: 'text', newOnly: true, width: 180 },
    { key: 'category', label: '分類', type: 'text', width: 120 },
    { key: 'contactName', label: '窓口', type: 'text', width: 120 },
    { key: 'contactDepartment', label: '担当部署', type: 'text', width: 180 },
    { key: 'contactEmail', label: '窓口のメール', type: 'email', width: 190 },
    { key: 'internalOwner', label: '社内担当', type: 'text', width: 110 },
    { key: 'recommendationSeats', label: '推薦可能人数', type: 'number', width: 110 },
    { key: 'partneredOn', label: '提携期日', type: 'date', width: 130 },
    { key: 'bestContactPeriod', label: '最適連絡時期', type: 'text', width: 150 },
    { key: 'location', label: '所在地', type: 'text', width: 140 },
    { key: 'engagement', label: 'NEO としての関わり', type: 'text', width: 220 },
    { key: 'recommendationStateId', label: '推薦枠', type: 'select', width: 150,
      options: recommendationStates },
    { key: 'staffId', label: '入力者', type: 'select', options: options.staffs, width: 130 },
  ]

  const sheetRows: SheetRowData[] = rows.map((p) => ({
    id: p.partner_id,
    lead: '',
    values: {
      name: p.name,
      category: p.category ?? '', contactName: p.contact_name ?? '',
      contactDepartment: p.contact_department ?? '', contactEmail: p.contact_email ?? '',
      internalOwner: p.internal_owner ?? '',
      recommendationSeats: p.recommendation_seats === null ? '' : String(p.recommendation_seats),
      partneredOn: p.partnered_on === null ? '' : String(p.partnered_on).slice(0, 10),
      bestContactPeriod: p.best_contact_period ?? '', location: p.location ?? '',
      engagement: p.engagement ?? '', recommendationStateId: p.recommendation_state_id ?? '',
      staffId: '',
    },
  }))

  return (
    <Shell active="approach" seasonId={season.id}
      years={<YearSwitch seasons={seasons} currentId={season.id} basePath="/approach/new" />}>
      <Breadcrumb root={seasonLabel(season)} crumbs={[
        { label: '連携団体', href: `/approach?season=${season.id}` },
        { label: '連携団体を編集' },
      ]} />
      <div className="page-head"><div>
        <h1 className="page-title">連携団体を編集</h1>
        <p className="page-sub">{seasonLabel(season)} ・ 新規と既存を同じ表で編集</p>
      </div></div>
      <div className="section"><Card title="連携団体">
        <Sheet columns={columns} rows={sheetRows} action={savePartnerSheetAction}
          hidden={{ seasonId: season.id }} leadLabel=""
          detail={{ href: `/approach?season=${season.id}&view=edit&partner={id}`, label: '接触を開く' }}
          addLabel="新しい団体の行を追加" />
      </Card></div>
    </Shell>
  )
}

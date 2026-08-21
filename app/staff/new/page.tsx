import Link from 'next/link'
import { getDb } from '../../../src/db/server.ts'
import { all } from '../../../src/db/client.ts'
import { listSeasons, defaultSeason, getSeason } from '../../../src/queries/dashboard.ts'
import { saveStaffSheetAction } from './sheet-actions.ts'
import { Card } from '../../_components/ui.tsx'
import { Shell, Breadcrumb, seasonLabel } from '../../_components/shell.tsx'
import { Sheet, type SheetColumn } from '../../_components/sheet.tsx'

/** 持つのは表示名だけ（依頼者の判断。C-96）。 */
const staffColumns: SheetColumn[] = [
  { key: 'displayName', label: '名前', type: 'text', width: 240 },
]

export const dynamic = 'force-dynamic'

/**
 * 入力者を追加（依頼者の指示。実行⑫）。
 *
 * ★ **これまで職員を足す画面が1つも無かった。** 表の「記録した人」は
 *   職員を選ばせるのに、選択肢を増やす道が取り込みしか無かった（C-75）。
 *
 * ★ 持つのは**表示名だけ**（依頼者の判断）。メールは受け取らない。
 *   したがって**同姓同名を見分ける手段は無い。**
 *   同じ名前でも止めないが、既に居ることは保存のときに伝える。
 *   いま登録されている入力者を下に並べてあるので、打つ前に気付ける。
 */
export default async function NewStaffPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const db = await getDb()

  const seasons = await listSeasons(db)
  const season = (await getSeason(db, Array.isArray(sp.season) ? sp.season[0] : sp.season))
    ?? defaultSeason(seasons)

  const staffs = await all<{ id: string; label: string; is_active: boolean }>(db, `
    SELECT id, display_name AS label, is_active FROM staffs ORDER BY display_name`)

  return (
    <Shell active="headhunting" seasonId={season?.id}>
      <Breadcrumb
        root={season ? seasonLabel(season) : '入力者'}
        crumbs={[
          ...(season
            ? [{ label: '候補者追加', href: `/people/new?season=${season.id}` }]
            : []),
          { label: '入力者を追加' },
        ]}
      />

      <div className="page-head">
        <div>
          <h1 className="page-title">入力者を追加</h1>
        </div>
      </div>

      <div className="section">
        {/* ★ 実行⑬で表（スプシ形式）にした（依頼者の指示 ――
            「面接シート以外のフォームがスプシ形式になっているか」）。
            1件ずつの素のフォームでは**まとめて足せず、打ち間違いも直せなかった。**
            既存の入力者も同じ表に並ぶので、読むための表を別に持たない
            （同じものを2つの形で出さない）。 */}
        <Card title="入力者">
          <Sheet
            columns={staffColumns}
            rows={staffs.map((s) => ({
              id: s.id,
              // 非活性は表の選択肢に出ない。ここには出す ――
              // 「居ないのに選べない」と「非活性で選べない」は別である。
              lead: s.is_active ? '選べる' : '選べない（非活性）',
              values: { displayName: s.label },
            }))}
            action={saveStaffSheetAction}
            leadLabel="選べるか"
            addLabel="行を追加"
          />
        </Card>
      </div>

      {season && (
        <div className="section">
          <Link href={`/people/new?season=${season.id}`} className="hh-more">
            ‹ 候補者追加へ戻る
          </Link>
        </div>
      )}
    </Shell>
  )
}

import { getDb } from '../../../src/db/server.ts'
import { all } from '../../../src/db/client.ts'
import { listSeasons, defaultSeason, getSeason } from '../../../src/queries/dashboard.ts'
import { getEventKind, listEventOwners } from '../../../src/commands/event.ts'
import { saveEventSheetAction } from './sheet-actions.ts'
import { Card, Empty } from '../../_components/ui.tsx'
import { Shell, Breadcrumb, YearSwitch, seasonLabel } from '../../_components/shell.tsx'
import { Sheet, type SheetColumn } from '../../_components/sheet.tsx'

export const dynamic = 'force-dynamic'

/**
 * イベントを追加（依頼者の指示。実行⑯。C-155）。
 *
 * 依頼者の言葉 ――「連携団体を追加タブの下に、イベントを追加タブを作成。
 * これもスプシ形式で、**内容はエクセルを見て決めろ**」。
 *
 * ★ 列はエクセル `4月イベント一覧` の見出しから取った ――
 *   参加有無 / イベント名 / 日程 / 時間 / 場所 / 対応者 / URL（あれば） / 備考
 *
 *   「時間」は開始と終了に割った。**終わりを作らない**ため
 *   （`ends_at` は NOT NULL で、無い時刻をこちらで埋めれば推測になる）。
 *
 *   「参加有無」は**この表では扱わない。** 参加は接点（0028）で、
 *   カレンダーから記録する道が既にある ―― 同じ事実を2箇所に置かない。
 *
 * ★ 置き場所は予定（0019）。種別は 0040 の「イベント」。
 * ★ 表は**足すだけ**。直す道は日程の画面にある（版数の付け方を2箇所に散らさない）。
 */

const eventColumns: SheetColumn[] = [
  { key: 'title', label: 'イベント名', type: 'text', width: 260 },
  { key: 'day', label: '日程', type: 'date', width: 140 },
  { key: 'startsAt', label: '開始', type: 'text', width: 90 },
  { key: 'endsAt', label: '終了', type: 'text', width: 90 },
  { key: 'place', label: '場所', type: 'text', width: 180 },
  { key: 'ownerStaffId', label: '対応者', type: 'select', width: 160 },
  { key: 'url', label: 'URL', type: 'text', width: 220 },
  { key: 'note', label: '備考', type: 'text', width: 260 },
]

export default async function NewEventPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const db = await getDb()

  const seasons = await listSeasons(db)
  const season = (await getSeason(db, Array.isArray(sp.season) ? sp.season[0] : sp.season))
    ?? defaultSeason(seasons)

  if (!season) {
    return (
      <Shell active="approach">
        <div className="hh-empty-shell"><p>年度が1件も登録されていない。</p></div>
      </Shell>
    )
  }

  const [owners, kind, events] = await Promise.all([
    listEventOwners(db),
    getEventKind(db),
    all<{ id: string; title: string; day: string; starts: string; ends: string;
      owner: string | null; note: string | null }>(db, `
      SELECT a.id,
             a.title,
             jst_date(a.starts_at)::text                          AS day,
             to_char(a.starts_at AT TIME ZONE 'Asia/Tokyo', 'HH24:MI') AS starts,
             to_char(a.ends_at   AT TIME ZONE 'Asia/Tokyo', 'HH24:MI') AS ends,
             s.display_name AS owner,
             a.note
        FROM appointments a
        JOIN appointment_kinds k ON k.id = a.kind_id AND k.code = 'event'
        LEFT JOIN staffs s ON s.id = a.owner_staff_id
       WHERE a.season_id = $1 AND a.cancelled_at IS NULL
       ORDER BY a.starts_at DESC`, [season.id]),
  ])

  const columns = eventColumns.map((c) => (
    c.key === 'ownerStaffId' ? { ...c, options: owners } : c))

  return (
    <Shell
      active="approach"
      seasonId={season.id}
      years={<YearSwitch seasons={seasons} currentId={season.id} basePath="/events/new" />}
    >
      <Breadcrumb
        root={seasonLabel(season)}
        crumbs={[
          { label: '連携団体', href: `/approach?season=${season.id}` },
          { label: 'イベントを編集' },
        ]}
      />

      <div className="page-head">
        <div>
          <h1 className="page-title">イベントを編集</h1>
          <p className="page-sub">{seasonLabel(season)}</p>
        </div>
      </div>

      {/* 種別が無ければ、打っても入らない。**打つ前に言う。** */}
      {!kind && (
        <p className="callout">
          イベントの種別が未登録（0040 が未適用）。この表からは記録できない。
        </p>
      )}
      {owners.length === 0 && (
        <p className="callout">
          対応者に選べる入力者が1人も居ない。先に「入力者を追加」から登録する。
        </p>
      )}

      <div className="section">
        <Card title="イベント">
          <p className="section-note">
            時刻は <code>HH:MM</code> で入れる。**終わりの時刻は作らない** ――
            分からなければ、分かってから入れる。
            場所・URL・備考は記録として残る（見出しごと残す）。
          </p>
          <Sheet
            columns={columns}
            rows={[]}
            action={saveEventSheetAction}
            hidden={{ seasonId: season.id }}
            addLabel="行を追加"
          />
        </Card>
      </div>

      <div className="section">
        <Card title={`この年度のイベント（${events.length}）`}>
          {/* ★ 直す道はここに無い（表は足すだけ）。読むための一覧を下に置く。 */}
          {events.length === 0 ? (
            <Empty>まだ1件も登録されていない。</Empty>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>日程</th><th>時間</th><th>イベント名</th>
                    <th>対応者</th><th>記録</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id}>
                      <td className="nowrap">{e.day}</td>
                      <td className="nowrap">{e.starts}–{e.ends}</td>
                      <td>{e.title}</td>
                      <td>{e.owner ?? '未記録'}</td>
                      <td className="hh-memo">{e.note ?? '—'}</td>
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

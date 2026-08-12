import Link from 'next/link'
import { getDb } from '../../../src/db/server.ts'
import { all } from '../../../src/db/client.ts'
import { listSeasons, defaultSeason, getSeason } from '../../../src/queries/dashboard.ts'
import { ADD_STAFF_MESSAGE, STAFF_NAME_MAX } from '../../../src/commands/staff.ts'
import { addStaffAction } from './actions.ts'
import { Card, Empty } from '../../_components/ui.tsx'
import { Shell, Breadcrumb, seasonLabel } from '../../_components/shell.tsx'

export const dynamic = 'force-dynamic'

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

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
  const season = (await getSeason(db, sp.season)) ?? defaultSeason(seasons)

  const staffs = await all<{ id: string; label: string; is_active: boolean }>(db, `
    SELECT id, display_name AS label, is_active FROM staffs ORDER BY display_name`)

  const code = one(sp.add)
  const message = code
    ? ADD_STAFF_MESSAGE[code as keyof typeof ADD_STAFF_MESSAGE] ?? '追加できなかった。'
    : null
  const ok = code === 'saved' || code === 'saved_duplicate'

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

      {message && <p className={`callout${ok ? ' ok' : ''}`}>{message}</p>}

      <div className="page-head">
        <div>
          <h1 className="page-title">入力者を追加</h1>
        </div>
      </div>

      <div className="section">
        <Card title="入力者">
          <form action={addStaffAction} className="editable-region">
            {season && <input type="hidden" name="season" value={season.id} />}
            <label className="iv-field">名前
              <input name="displayName" required maxLength={STAFF_NAME_MAX}
                     autoComplete="off" />
            </label>
            <button type="submit" className="button-primary">追加する</button>
          </form>
        </Card>
      </div>

      <div className="section">
        <Card title="いま登録されている入力者">
          {staffs.length === 0 ? (
            <Empty>まだ1人も登録されていない</Empty>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>名前</th><th>選べるか</th></tr>
                </thead>
                <tbody>
                  {staffs.map((s) => (
                    <tr key={s.id}>
                      <td className="cell-name">{s.label}</td>
                      {/* 非活性の人は表の選択肢に出ない。ここには出す ――
                          「居ないのに選べない」と「非活性で選べない」は別である。 */}
                      <td>{s.is_active ? '選べる' : '選べない（非活性）'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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

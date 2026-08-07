import Link from 'next/link'
import { getDb } from '../../src/db/server.ts'
import { listSeasons, getSeason } from '../../src/queries/dashboard.ts'
import {
  getOpenTasks, getTaskTotals, getWaitingPersons, getForests,
  DORMANT_DAYS, type TaskKind, type ForestRow,
} from '../../src/queries/cockpit.ts'
import { Card, Kpi, SeasonTabs, Empty, num } from '../_components/ui.tsx'

export const dynamic = 'force-dynamic'

/**
 * コックピット。
 *
 * 憲法（director.md）のホーム画面の要求に対する最小の実装である。
 * 答えるのは4つの問いだけで、それ以外は既存の画面へ譲る。
 *
 *   いま何をすべきか / 何が止まっているか / 誰が待っているか / どの森が要注意か
 *
 * 一覧を主役に置かない、という要求との折り合いについて。
 * ここに出ている表は「在庫の一覧」ではなく**やることの列**である。
 * 行が0件になれば表そのものが消える。母集団は v_active_applications
 * （いま誰かが判断すべき応募）なので、動いていないものは並ばない。
 *
 * TODO(MVP): Forest Health / Owner / Relationship は未実装。
 *            手で作るタスク（連絡する・催促する）も表せない。
 *            どちらも記録層に事実が無い（domain.md 9-2）。
 */

const KIND_LABEL: Record<TaskKind, string> = {
  evaluate: '評価する',
  assign:   '担当を決める',
  unhold:   '保留を解く',
  reassign: '担当を替える',
}

const KIND_CLASS: Record<TaskKind, string> = {
  evaluate: 'badge-tag-blue',
  assign:   'badge-tag-purple',
  unhold:   'badge-tag-gray',
  reassign: 'badge-tag-orange',
}

/** 要注意の旗。合成したスコアではなく、事実そのままの理由を並べる。 */
function ForestFlags({ forest }: { forest: ForestRow }) {
  if (forest.flags.length === 0) {
    return <span className="section-note">平常</span>
  }
  return (
    <span className="badge-row">
      {forest.flags.includes('stalled') && (
        <span className="badge-tag-orange">
          滞留 {num(forest.overdue_tasks)} 件
        </span>
      )}
      {forest.flags.includes('untouched') && (
        <span className="badge-tag-gray">接点なし</span>
      )}
      {forest.flags.includes('dormant') && (
        <span className="badge-tag-gray">
          休眠 {num(forest.days_since_touch)} 日
        </span>
      )}
    </span>
  )
}

export default async function CockpitPage(
  { searchParams }: { searchParams: Promise<{ season?: string }> },
) {
  const db = await getDb()
  const seasons = await listSeasons(db)
  if (seasons.length === 0) {
    return <Empty>年度が登録されていない。<code>pnpm db:reset</code> を実行する。</Empty>
  }

  const season =
    (await getSeason(db, (await searchParams).season)) ??
    seasons.find((s) => s.is_live) ?? seasons[0]!

  const [tasks, totals, waiting, forests] = await Promise.all([
    getOpenTasks(db, season.id),
    getTaskTotals(db, season.id),
    getWaitingPersons(db, season.id),
    getForests(db, season.id),
  ])

  const overdue = tasks.filter((t) => t.is_overdue)
  const attention = forests.filter((f) => f.flags.length > 0)

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{season.enrollment_year} 年度の運転席</h1>
          <p className="page-sub">
            {season.is_live
              ? '進行中。いま動いている応募だけを見ている'
              : '終了した年度を表示している。動いている応募は残っていないはず'}
          </p>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <SeasonTabs seasons={seasons} currentId={season.id} basePath="/cockpit" />
        </div>
      </div>

      {/* 4つの問いを、そのまま4枚に置く。 */}
      <div className="grid grid-kpi">
        <Kpi label="いま何をすべきか" value={num(tasks.length)}
             tone={tasks.length ? undefined : 'muted'} meta="未処理のやること（件）" />
        <Kpi label="何が止まっているか" value={num(overdue.length)}
             tone={overdue.length ? undefined : 'muted'} meta="期限を超えたやること（件）" />
        <Kpi label="誰が待っているか" value={num(totals?.waiting_persons ?? 0)}
             tone={Number(totals?.waiting_persons ?? 0) ? undefined : 'muted'}
             meta="判断を待っている人（人）" />
        <Kpi label="どの森が要注意か" value={num(attention.length)}
             tone={attention.length ? undefined : 'muted'}
             meta={`旗が立った森（森）／全 ${num(forests.length)} 森`} />
      </div>

      <div className="section">
        {overdue.length > 0 ? (
          <p className="callout">
            {overdue.length} 件が期限を超えている。最長は {num(overdue[0]!.waiting_days)} 日
            （{overdue[0]!.person_name} ・ {overdue[0]!.step_name}）。
          </p>
        ) : tasks.length > 0 ? (
          <p className="callout ok">
            期限を超えたものは無い。{tasks.length} 件が順番待ちしている。
          </p>
        ) : (
          <p className="callout ok">この年度に、いま誰かが判断すべきものは残っていない。</p>
        )}
      </div>

      {/* 1. いま何をすべきか */}
      <div className="section">
        <Card
          title="いま何をすべきか"
          note="期限を超えたもの → 待ちの長いもの → 選考の早いステップの順"
        >
          {tasks.length === 0 ? <Empty>やることは残っていない</Empty> : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>やること</th>
                    <th>誰について</th>
                    <th>ステップ</th>
                    <th>担当</th>
                    <th className="num">待ち</th>
                    <th className="num">期限</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.slice(0, 40).map((t) => (
                    <tr key={`${t.kind}-${t.source_id}`}>
                      <td>
                        <span className={KIND_CLASS[t.kind]}>{KIND_LABEL[t.kind]}</span>
                        {t.detail && (
                          <>
                            <br />
                            <span className="section-note">{t.detail}</span>
                          </>
                        )}
                      </td>
                      <td className="nowrap">
                        <Link href={`/applications/${t.application_id}`}>{t.person_name}</Link>
                      </td>
                      <td className="nowrap">{t.step_order}. {t.step_name}</td>
                      <td>
                        {t.owner ?? <span className="badge-tag-orange">未割当</span>}
                      </td>
                      <td className="num">
                        {t.is_overdue ? (
                          <strong style={{ color: 'var(--color-semantic-error)' }}>
                            {num(t.waiting_days)} 日
                          </strong>
                        ) : `${num(t.waiting_days)} 日`}
                      </td>
                      <td className="num">{t.sla_days ? `${t.sla_days} 日` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {tasks.length > 40 && (
                <p className="section-note" style={{ padding: 12 }}>
                  上位 40 件を表示（全 {num(tasks.length)} 件）
                </p>
              )}
            </div>
          )}
        </Card>
      </div>

      <div className="section grid grid-2">
        {/* 2. どの森が要注意か */}
        <Card
          title="どの森が要注意か"
          note="期限超過 → 未処理 → 休眠日数の順。旗は事実そのままで、点数ではない"
        >
          {forests.length === 0 ? <Empty>森が登録されていない</Empty> : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>森</th>
                    <th>状態</th>
                    <th className="num">林</th>
                    <th className="num">接点のある人</th>
                    <th className="num">応募</th>
                  </tr>
                </thead>
                <tbody>
                  {forests.map((f) => (
                    <tr key={f.forest_id}>
                      <td>
                        <Link href={`/forests/${f.forest_id}?season=${season.id}`}>
                          {f.name}
                        </Link>
                      </td>
                      <td><ForestFlags forest={f} /></td>
                      <td className="num">{num(f.communities)}</td>
                      <td className="num">{num(f.persons_touched)}</td>
                      <td className="num">{num(f.applications)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* 3. 誰が待っているか */}
        <Card title="誰が待っているか" note="やることを人でまとめ直したもの。件数ではなく人数">
          {waiting.length === 0 ? <Empty>待っている人はいない</Empty> : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>人</th>
                    <th>何を待っているか</th>
                    <th className="num">件</th>
                    <th className="num">最長</th>
                  </tr>
                </thead>
                <tbody>
                  {waiting.slice(0, 20).map((w) => (
                    <tr key={w.person_id}>
                      <td className="nowrap">
                        <Link href={`/people/${w.person_id}`}>{w.person_name}</Link>
                      </td>
                      <td className="nowrap">
                        <span className={KIND_CLASS[w.kind]}>{KIND_LABEL[w.kind]}</span>
                        <br />
                        <span className="section-note">{w.step_name}</span>
                      </td>
                      <td className="num">{num(w.tasks)}</td>
                      <td className="num">
                        {w.overdue ? (
                          <strong style={{ color: 'var(--color-semantic-error)' }}>
                            {num(w.waiting_days)} 日
                          </strong>
                        ) : `${num(w.waiting_days)} 日`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {waiting.length > 20 && (
                <p className="section-note" style={{ padding: 12 }}>
                  上位 20 人を表示（全 {num(waiting.length)} 人）
                </p>
              )}
            </div>
          )}
        </Card>
      </div>

      <p className="unit-note">
        <strong>単位と母集団。</strong>
        「やること」は<strong>件</strong>、「待っている人」は<strong>人</strong>。
        1人が複数のやることを持つため、この2つは一致しない。
        母集団は<code>いま選考が動いている応募</code>で、
        取り下げ・合格・不合格の済んだ応募と、個人情報削除を受けた人は入らない。
        森の「接点のある人」と「応募」は {season.enrollment_year} 年度の数、
        休眠日数は<strong>年度を問わない</strong>最終接触日から数えている。
        森の行は<strong>足せない</strong>（同じ人が複数の森に接点を持つ）。
      </p>

      <p className="footnote">
        やることは <code>v_open_tasks</code>（既存の事実からの導出）。
        Task の記録層はまだ無いため、手で作るタスクは表せない。
        休眠は最終接触から {DORMANT_DAYS} 日以上。この日数は運用時に決める仮の値。
        待ち日数は <code>jst_today() - jst_date(assigned_at)</code>。
        {forests.some((f) => f.estimated_reach !== null) && (
          <>
            {' '}森の推定リーチは<strong>接触機会の推定値</strong>で、
            接点のある実人数とは単位が違う。並べても割らない。
          </>
        )}
      </p>
    </>
  )
}

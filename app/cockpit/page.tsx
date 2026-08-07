import Link from 'next/link'
import { getDb } from '../../src/db/server.ts'
import { listSeasons, getSeason } from '../../src/queries/dashboard.ts'
import {
  getOpenTasks, getTaskTotals, getWaitingPersons, getForests,
  DORMANT_DAYS, type TaskKind, type ForestRow,
} from '../../src/queries/cockpit.ts'
import {
  listAssignableStaff, parseAssignCode, ASSIGN_CODE_MESSAGE,
  parseReassignCode, REASSIGN_CODE_MESSAGE,
  type AssignableStaff,
} from '../../src/commands/assign.ts'
import { parseUnholdCode, UNHOLD_CODE_MESSAGE } from '../../src/commands/unhold.ts'
import { assignAction, unholdAction, reassignAction } from './actions.ts'
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
    <>
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
    </>
  )
}

/**
 * 森の区画。
 *
 * 憲法は「テーブルを作らない」「森が主役」と定めている。実行⑥の第1版は
 * 表で出していたが、それに対する指示が「マップにする」だったので置き換えた。
 *
 * ★ 出している数は3つだけで、**すべて実測値である。**
 *   Health（健康度）は出していない。原典の実装段階[3]（スコアリング）で、
 *   原典自身が着手判断を1年後と書いており、`process.md` の Freeze Core
 *   Concepts も Forest Health を暫定扱いに置いている。いま % を出すと、
 *   根拠のない数字が一目で読める場所に座ることになる。
 *   代わりに、要注意の理由を**旗**として名指しする（C-18）。
 *   TODO(MVP): Health と Owner（担当）は、記録層に事実ができてから。
 *
 * ★ 推定リーチをこの3つに混ぜない。あれは接触機会の推定値で、
 *   接点のある人（実人数）とは単位が違う（domain.md 8節）。
 *   足元に別行で、単位を書いて出す。
 */
function ForestNode({ forest, seasonId }: { forest: ForestRow; seasonId: string }) {
  // 枠は「旗が立っているか」、地の色は「眠っているか」。2つは別の軸である。
  // 休眠の森を地の色だけで示すと、並び順では前に居るのに一番弱く見える。
  const flagged = forest.flags.length > 0
  const asleep = forest.flags.includes('untouched') || forest.flags.includes('dormant')
  const stat = (label: string, value: number) => (
    <div className="forest-stat">
      <span className="forest-stat-label">{label}</span>
      <span className={`forest-stat-value${Number(value) === 0 ? ' zero' : ''}`}>
        {num(value)}
      </span>
    </div>
  )

  return (
    <div className={`forest-node${flagged ? ' alert' : ''}${asleep ? ' quiet' : ''}`}>
      <span className="forest-node-name">
        <span className="leaf" aria-hidden="true">●</span>
        <Link href={`/forests/${forest.forest_id}?season=${seasonId}`}>
          {forest.name}
        </Link>
      </span>

      <div className="forest-stats">
        {stat('接点のある人', forest.persons_touched)}
        {stat('応募', forest.applications)}
        {stat('合格', forest.accepted)}
      </div>

      <div className="forest-node-foot">
        <ForestFlags forest={forest} />
        {Number(forest.communities) > 0 && <span>林 {num(forest.communities)}</span>}
        {/* 旗が最終接触の話をしているときは、同じ日数を2度書かない。
            「休眠 934 日」の隣に「最終接触 934 日前」が並ぶと、
            2つの事実があるように読める。 */}
        {!asleep && forest.days_since_touch !== null && (
          <span>最終接触 {num(forest.days_since_touch)} 日前</span>
        )}
        {/* リーチの記録が無い森に「—（接触機会）」と出ていた。単位だけが残って
            意味をなさないので、記録が無いことをそのまま書く。 */}
        <span>
          {forest.estimated_reach === null
            ? 'リーチの記録なし'
            : `推定リーチ ${num(forest.estimated_reach)}（接触機会）`}
        </span>
      </div>
    </div>
  )
}

/**
 * 担当を決めるフォーム。
 *
 * 素の `<form action={...}>` である。`'use client'` を1つも増やしていないので、
 * **JavaScript を無効にしても動く。** 状態を持つ対話部品（`useActionState` など）
 * を入れるとクライアント境界の新設になるため、そこには踏み込まない。
 * 結果は同じ画面へコードを付けて戻すこと（PRG）で伝える。
 *
 * 面接官は「抱えている判断待ちが少ない順」に並ぶ。偏りが見えないまま
 * 選ばせると、いつも同じ人に積む（/operations の面接官別の負荷と同じ狙い）。
 */
function AssignForm({
  evaluationId, seasonId, staff, mode = 'assign',
}: {
  evaluationId: string
  seasonId: string
  staff: AssignableStaff[]
  /** 決めるか、替えるか。**成り立つ条件が逆**なので、送る先を分ける。 */
  mode?: 'assign' | 'reassign'
}) {
  if (staff.length === 0) {
    return <span className="section-note">選べる職員がいない</span>
  }
  return (
    <form action={mode === 'assign' ? assignAction : reassignAction}
          className="assign-form">
      <input type="hidden" name="evaluationId" value={evaluationId} />
      <input type="hidden" name="seasonId" value={seasonId} />
      <label className="visually-hidden" htmlFor={`staff-${evaluationId}`}>
        担当にする面接官
      </label>
      <select id={`staff-${evaluationId}`} name="staffId" defaultValue="" required>
        <option value="" disabled>
          {mode === 'assign' ? '担当を選ぶ…' : '別の担当を選ぶ…'}
        </option>
        {staff.map((s) => (
          <option key={s.staff_id} value={s.staff_id}>
            {s.display_name}（待ち {s.pending}）
          </option>
        ))}
      </select>
      <button type="submit" className="button-primary">
        {mode === 'assign' ? '決める' : '替える'}
      </button>
    </form>
  )
}

/**
 * 保留を解くフォーム。
 *
 * 選ぶものが無いのでボタン1つである。`AssignForm` と同じく素の
 * `<form action={...}>` で、`'use client'` は増やしていない。
 *
 * 確認を挟んでいない。**解いても失われるものが無い**（理由は残る）ので、
 * 取り消しの重さに見合わない。消える操作を足すときに考える。
 */
function UnholdForm({
  evaluationId, seasonId,
}: { evaluationId: string; seasonId: string }) {
  return (
    <form action={unholdAction} className="assign-form">
      <input type="hidden" name="evaluationId" value={evaluationId} />
      <input type="hidden" name="seasonId" value={seasonId} />
      <button type="submit" className="button-secondary">保留を解く</button>
    </form>
  )
}

export default async function CockpitPage(
  { searchParams }: {
    searchParams: Promise<{
      season?: string; assign?: string; unhold?: string; reassign?: string
    }>
  },
) {
  const db = await getDb()
  const params = await searchParams
  const seasons = await listSeasons(db)
  if (seasons.length === 0) {
    return <Empty>年度が登録されていない。<code>pnpm db:reset</code> を実行する。</Empty>
  }

  const season =
    (await getSeason(db, params.season)) ??
    seasons.find((s) => s.is_live) ?? seasons[0]!

  const [tasks, totals, waiting, forests, staff] = await Promise.all([
    getOpenTasks(db, season.id),
    getTaskTotals(db, season.id),
    getWaitingPersons(db, season.id),
    getForests(db, season.id),
    listAssignableStaff(db, season.id),
  ])

  // 直前の書き込みの結果。知らないコードは「何も起きていない」として捨てる。
  const assigned = parseAssignCode(params.assign)
  const unheld = parseUnholdCode(params.unhold)
  const reassigned = parseReassignCode(params.reassign)

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
        {/* 0 でないこと自体が問題なので、0 のときと見た目を変える。 */}
        <Kpi label="何が止まっているか" value={num(overdue.length)}
             tone={overdue.length ? 'alert' : 'muted'} meta="期限を超えたやること（件）" />
        <Kpi label="誰が待っているか" value={num(totals?.waiting_persons ?? 0)}
             tone={Number(totals?.waiting_persons ?? 0) ? undefined : 'muted'}
             meta="判断を待っている人（人）" />
        <Kpi label="どの森が要注意か" value={num(attention.length)}
             tone={attention.length ? undefined : 'muted'}
             meta={`旗が立った森（森）／全 ${num(forests.length)} 森`} />
      </div>

      {assigned && (
        <div className="section">
          <p className={`callout${assigned === 'ok' ? ' ok' : ''}`}>
            {ASSIGN_CODE_MESSAGE[assigned]}
            {assigned === 'ok' && (
              <span className="section-note">
                やること・待っている人・森の数は、この画面で作り直してある
              </span>
            )}
          </p>
        </div>
      )}
      {unheld && (
        <div className="section">
          <p className={`callout${unheld === 'unheld' ? ' ok' : ''}`}>
            {UNHOLD_CODE_MESSAGE[unheld]}
            {unheld === 'unheld' && (
              <span className="section-note">
                保留の理由は消していない。応募の画面でそのまま読める
              </span>
            )}
          </p>
        </div>
      )}

      {reassigned && (
        <div className="section">
          <p className={`callout${reassigned === 'reassigned' ? ' ok' : ''}`}>
            {REASSIGN_CODE_MESSAGE[reassigned]}
            {reassigned === 'reassigned' && (
              <span className="section-note">
                利益相反はこれで消える。前の担当が誰だったかは残らない
              </span>
            )}
          </p>
        </div>
      )}

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

      {/* 2. どの森が要注意か — 表ではなくマップで出す */}
      <div className="section">
        <Card
          title="森のマップ（アプローチできる生態系）"
          note="旗が立った森が先（滞留 → 接点なし・休眠 → 平常）。旗は事実そのままで、点数ではない"
        >
          {forests.length === 0 ? <Empty>森が登録されていない</Empty> : (
            <div className="forest-map">
              {forests.map((f) => (
                <ForestNode key={f.forest_id} forest={f} seasonId={season.id} />
              ))}
            </div>
          )}
        </Card>
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
                    <tr key={`${t.kind}-${t.source_id}`}
                        className={t.is_overdue ? 'overdue' : undefined}>
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
                      <td className="nowrap">
                        {t.step_order}. {t.step_name}
                        {/* 入力の進み具合。着手前か途中かが1行で読める。 */}
                        {t.kind === 'evaluate' && Number(t.criteria_total) > 0 && (
                          <>
                            <br />
                            <span className="section-note">
                              {num(t.criteria_scored)}/{num(t.criteria_total)} 軸
                              {Number(t.criteria_scored) === 0 && ' ・ 未着手'}
                            </span>
                          </>
                        )}
                      </td>
                      <td>
                        <div className="owner-cell">
                        {t.owner
                          ? <span className="owner-current">{t.owner}</span>
                          : t.kind === 'assign'
                            ? null
                            : <span className="badge-tag-orange">未割当</span>}
                        {t.kind === 'assign' && (
                          <AssignForm evaluationId={t.source_id}
                                      seasonId={season.id} staff={staff} />
                        )}
                        {/* 保留は担当が付いていても解く操作が要る。
                            担当欄の下に置き、行の意味（誰の手番か）を保つ。 */}
                        {t.kind === 'unhold' && (
                          <UnholdForm evaluationId={t.source_id} seasonId={season.id} />
                        )}
                        {/* 利益相反。いまの担当を出したうえで、替える欄を置く。
                            誰から誰に替えるのかが見えないと選べない。 */}
                        {t.kind === 'reassign' && (
                          <AssignForm evaluationId={t.source_id} seasonId={season.id}
                                      staff={staff} mode="reassign" />
                        )}
                        </div>
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

      <div className="section">
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
        森の「接点のある人」「応募」「合格」は {season.enrollment_year} 年度の数で、
        休眠日数は<strong>年度を問わない</strong>最終接触日から数えている。
        <strong>推定リーチは接触機会の推定値</strong>で、接点のある人（実人数）とは
        単位が違う。同じ人へ2回リーチすれば2と数えるので、<strong>割らない</strong>。
        森の区画は<strong>足せない</strong>（同じ人が複数の森に接点を持つ）。
        <strong>健康度（Health）は出していない。</strong>記録層にその事実が無く、
        いま合成すると根拠のない数字になる。要注意は旗で名指ししている。
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

import Link from 'next/link'
import { getDb } from '../../src/db/server.ts'
import { listSeasons, getSeason, getStepFlow } from '../../src/queries/dashboard.ts'
import {
  getOpenTasks, getTaskTotals, getForests, getCommunityMap,
  DORMANT_DAYS, type TaskKind, type ForestRow, type CommunityMapRow,
} from '../../src/queries/cockpit.ts'
import {
  getApplication, getApplicationEvaluations, getApplicationTimeline, getPersonTouchpoints,
} from '../../src/queries/drilldown.ts'
import {
  listAssignableStaff, parseAssignCode, ASSIGN_CODE_MESSAGE,
  parseReassignCode, REASSIGN_CODE_MESSAGE, type AssignableStaff,
} from '../../src/commands/assign.ts'
import { parseUnholdCode, UNHOLD_CODE_MESSAGE } from '../../src/commands/unhold.ts'
import { assignAction, unholdAction, reassignAction } from './actions.ts'
import { Card, Empty, SeasonTabs, jstDateTime, jstDay, num } from '../_components/ui.tsx'

export const dynamic = 'force-dynamic'

const KIND_LABEL: Record<TaskKind, string> = {
  evaluate: '評価する',
  assign: '担当を決める',
  unhold: '保留を解く',
  reassign: '担当を替える',
}

const KIND_CLASS: Record<TaskKind, string> = {
  evaluate: 'badge-tag-blue',
  assign: 'badge-tag-purple',
  unhold: 'badge-tag-gray',
  reassign: 'badge-tag-orange',
}

function FactFlags({ flags, overdueTasks }: { flags: string[]; overdueTasks?: number }) {
  return (
    <div className="fact-flags">
      {flags.includes('stalled') && <span className="badge-tag-orange">滞留 {num(overdueTasks)} 件</span>}
      {flags.includes('untouched') && <span className="badge-tag-gray">接点なし</span>}
      {flags.includes('dormant') && <span className="badge-tag-gray">休眠</span>}
      {flags.length === 0 && <span className="section-note">旗なし</span>}
    </div>
  )
}

function AssignForm({
  evaluationId, seasonId, staff, mode = 'assign',
}: {
  evaluationId: string
  seasonId: string
  staff: AssignableStaff[]
  mode?: 'assign' | 'reassign'
}) {
  if (staff.length === 0) return <span className="section-note">選べる職員がいない</span>
  return (
    <form action={mode === 'assign' ? assignAction : reassignAction} className="context-action-form">
      <input type="hidden" name="evaluationId" value={evaluationId} />
      <input type="hidden" name="seasonId" value={seasonId} />
      <label className="visually-hidden" htmlFor={`staff-${evaluationId}`}>担当にする面接官</label>
      <select id={`staff-${evaluationId}`} name="staffId" defaultValue="" required>
        <option value="" disabled>{mode === 'assign' ? '担当を選ぶ…' : '別の担当を選ぶ…'}</option>
        {staff.map((member) => (
          <option key={member.staff_id} value={member.staff_id}>
            {member.display_name}（待ち {member.pending}）
          </option>
        ))}
      </select>
      <button type="submit" className="button-primary">{mode === 'assign' ? '担当を決める' : '担当を替える'}</button>
    </form>
  )
}

function TaskAction({
  task, seasonId, staff,
}: { task: Awaited<ReturnType<typeof getOpenTasks>>[number]; seasonId: string; staff: AssignableStaff[] }) {
  if (task.kind === 'assign') return <AssignForm evaluationId={task.source_id} seasonId={seasonId} staff={staff} />
  if (task.kind === 'reassign') {
    return <AssignForm evaluationId={task.source_id} seasonId={seasonId} staff={staff} mode="reassign" />
  }
  if (task.kind === 'unhold') {
    return (
      <form action={unholdAction} className="context-action-form">
        <input type="hidden" name="evaluationId" value={task.source_id} />
        <input type="hidden" name="seasonId" value={seasonId} />
        <button type="submit" className="button-primary">保留を解く</button>
      </form>
    )
  }
  return <Link className="button-primary context-action-link" href={`/applications/${task.application_id}`}>評価する</Link>
}

function ForestCard({ forest, seasonId }: { forest: ForestRow; seasonId: string }) {
  return (
    <Link href={`/forests/${forest.forest_id}?season=${seasonId}`} className="forest-focus-card">
      <div className="forest-focus-head">
        <span className="forest-marker" aria-hidden="true">●</span>
        <span>{forest.name}</span>
        <span className="section-note">Forest</span>
      </div>
      <FactFlags flags={forest.flags} overdueTasks={forest.overdue_tasks} />
      <div className="forest-fact-grid">
        <div className="estimate-fact"><span>推定 Reach</span><strong>{forest.estimated_reach === null ? '記録なし' : num(forest.estimated_reach)}</strong><small>接触機会・推定</small></div>
        <div><span>接点のある実人数</span><strong>{num(forest.persons_touched)} 人</strong><small>当該年度</small></div>
        <div><span>進行中の応募</span><strong>{num(forest.applications)} 件</strong><small>当該年度</small></div>
        <div><span>未処理タスク</span><strong>{num(forest.open_tasks)} 件</strong><small>当該年度</small></div>
      </div>
      <p className="forest-card-note">推定 Reach・実人数・応募件数は単位が異なります</p>
    </Link>
  )
}

function CommunityNode({ community, forestId, seasonId }: {
  community: CommunityMapRow
  forestId: string
  seasonId: string
}) {
  return (
    <Link href={`/forests/${forestId}?season=${seasonId}`} className={`community-node${community.flags.length > 0 ? ' needs-attention' : ''}`}>
      <div className="community-node-top">
        <span className="community-node-name">{community.name}</span>
        {community.open_tasks > 0 && <span className="task-count">未処理 {num(community.open_tasks)} 件</span>}
      </div>
      <div className="community-node-facts">
        <span>接点のある実人数 <strong>{num(community.persons_touched)} 人</strong></span>
        <span>{community.last_touch_on ? `最終接点 ${jstDay(community.last_touch_on)}` : '最終接点の記録なし'}</span>
      </div>
      <FactFlags flags={community.flags} overdueTasks={community.overdue_tasks} />
    </Link>
  )
}

export default async function CockpitPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; assign?: string; unhold?: string; reassign?: string }>
}) {
  const db = await getDb()
  const params = await searchParams
  const seasons = await listSeasons(db)
  if (seasons.length === 0) return <Empty>年度が登録されていない。</Empty>

  const season = (await getSeason(db, params.season)) ?? seasons.find((item) => item.is_live) ?? seasons[0]!
  const [tasks, totals, forests, staff, steps] = await Promise.all([
    getOpenTasks(db, season.id), getTaskTotals(db, season.id), getForests(db, season.id),
    listAssignableStaff(db, season.id), getStepFlow(db, season.id),
  ])
  const selectedTask = tasks[0] ?? null
  const selectedForest = forests[0] ?? null
  const [selectedApplication, evaluations, timeline, touchpoints, communities] = selectedTask && selectedForest
    ? await Promise.all([
      getApplication(db, selectedTask.application_id),
      getApplicationEvaluations(db, selectedTask.application_id),
      getApplicationTimeline(db, selectedTask.application_id),
      getPersonTouchpoints(db, selectedTask.person_id),
      getCommunityMap(db, selectedForest.forest_id, season.id),
    ])
    : [null, [], [], [], []]

  const overdue = tasks.filter((task) => task.is_overdue)
  const attention = forests.filter((forest) => forest.flags.length > 0)
  const assigned = parseAssignCode(params.assign)
  const unheld = parseUnholdCode(params.unhold)
  const reassigned = parseReassignCode(params.reassign)
  const nextEvaluation = evaluations.find((evaluation) => evaluation.can_score)
  const activeEvaluation = evaluations.find((evaluation) => evaluation.evaluation_id === selectedTask?.source_id)
  const firstTouch = touchpoints[touchpoints.length - 1]
  const lastTouch = touchpoints[0]

  return (
    <>
      <div className="cockpit-head">
        <div>
          <p className="eyebrow">FOREST OPERATIONS</p>
          <h1 className="page-title">{season.enrollment_year} 年度の運転席</h1>
          <p className="page-sub">今日、選考を前へ進めるための作業場所</p>
        </div>
        <SeasonTabs seasons={seasons} currentId={season.id} basePath="/cockpit" />
      </div>

      {(assigned || unheld || reassigned) && (
        <p className="callout ok">
          {assigned ? ASSIGN_CODE_MESSAGE[assigned] : unheld ? UNHOLD_CODE_MESSAGE[unheld] : REASSIGN_CODE_MESSAGE[reassigned!]}
        </p>
      )}

      <div className="cockpit-layout">
        <main className="cockpit-workspace">
          <section className="today-section" aria-labelledby="today-title">
            <div className="section-heading-row">
              <div>
                <p className="eyebrow">PRIORITY 01</p>
                <h2 id="today-title" className="workspace-title">今日やること <span>{num(tasks.length)} 件</span></h2>
              </div>
              <p className="section-note">期限超過 → 待ち日数 → 選考ステップの順</p>
            </div>
            {tasks.length === 0 ? <Empty>いま判断すべき応募はありません。</Empty> : (
              <div className="task-queue">
                {tasks.slice(0, 7).map((task, index) => (
                  <Link href={`/applications/${task.application_id}`} className={`task-row${task.is_overdue ? ' is-overdue' : ''}${index === 0 ? ' is-selected' : ''}`} key={`${task.kind}-${task.source_id}`}>
                    <span className="task-priority">{index + 1}</span>
                    <div className="task-main">
                      <div className="task-label-row"><span className={KIND_CLASS[task.kind]}>{KIND_LABEL[task.kind]}</span>{task.is_overdue && <span className="overdue-label">期限超過</span>}</div>
                      <strong>{task.person_name}</strong>
                      <span>{task.step_order}. {task.step_name}{task.detail && ` ・ ${task.detail}`}</span>
                    </div>
                    <div className="task-owner"><span>担当</span><strong>{task.owner ?? '未設定'}</strong></div>
                    <div className="task-wait"><span>待ち</span><strong>{num(task.waiting_days)} 日</strong></div>
                    <span className="task-arrow" aria-hidden="true">→</span>
                  </Link>
                ))}
              </div>
            )}
            {tasks.length > 7 && <p className="section-note task-more">上位 7 件を表示 ／ 全 {num(tasks.length)} 件</p>}
          </section>

          <section className="forest-section" aria-labelledby="forest-title">
            <div className="section-heading-row">
              <div><p className="eyebrow">PRIORITY 03</p><h2 id="forest-title" className="workspace-title">Forest と Community</h2></div>
              <p className="section-note">要注意 {num(attention.length)} 森 ／ 滞留・休眠・接点なしは事実フラグ</p>
            </div>
            {selectedForest ? <ForestCard forest={selectedForest} seasonId={season.id} /> : <Empty>Forest が登録されていない。</Empty>}
            {selectedForest && (
              <div className="community-map">
                <div className="map-connection" aria-hidden="true" />
                {communities.map((community) => <CommunityNode key={community.community_id} community={community} forestId={selectedForest.forest_id} seasonId={season.id} />)}
              </div>
            )}
            <p className="map-caption">Community を開くと Person へ、Person を選ぶと右側の作業コンテキストへ進みます。</p>
          </section>

          <section className="pipeline-section" aria-labelledby="pipeline-title">
            <div className="section-heading-row"><div><p className="eyebrow">PRIORITY 04</p><h2 id="pipeline-title" className="workspace-title">現在の選考状況</h2></div><p className="section-note">応募件数。人ではありません</p></div>
            <div className="application-flow">
              {steps.map((step, index) => {
                const denominator = index === 0 ? null : Number(steps[index - 1]!.reached)
                const rate = denominator && denominator > 0 ? `${((Number(step.reached) / denominator) * 100).toFixed(1)}%` : null
                return <div className="application-stage" key={step.sort_order}>
                  <span>{step.sort_order}. {step.name}</span>
                  <strong>{num(step.reached)} 件</strong>
                  <small>{rate ? `前段 ${num(denominator)} 件に対する到達率 ${rate}` : '提出応募を母集団とする'}</small>
                </div>
              })}
            </div>
          </section>
        </main>

        <aside className="person-context" aria-label="選択中の Person と Application">
          {selectedTask && selectedApplication ? (
            <>
              <div className="context-topline"><span className="context-live-dot" />選択中の Person / Application</div>
              <section className="context-person">
                <div className="person-avatar" aria-hidden="true">{selectedApplication.applicant_name.slice(0, 1)}</div>
                <div><h2>{selectedApplication.applicant_name}</h2><p>{selectedApplication.school_name}</p></div>
              </section>
              <section className="context-block">
                <p className="context-label">対象年度と現在の選考ステップ</p>
                <strong>{selectedApplication.enrollment_year} 年度 ・ {selectedTask.step_order}. {selectedTask.step_name}</strong>
                <span className={KIND_CLASS[selectedTask.kind]}>{KIND_LABEL[selectedTask.kind]}</span>
              </section>
              <section className="context-block context-details">
                <div><span>現在の担当者</span><strong>{selectedTask.owner ?? '未設定'}</strong></div>
                <div><span>期限</span><strong>{selectedTask.sla_days ? `${num(selectedTask.sla_days)} 日` : '設定なし'}</strong></div>
                <div><span>停止理由</span><strong>{activeEvaluation?.hold_reason ?? 'なし'}</strong></div>
              </section>
              <section className="context-block context-next-action">
                <p className="context-label">推奨される次の操作</p>
                <h3>{KIND_LABEL[selectedTask.kind]}</h3>
                <TaskAction task={selectedTask} seasonId={season.id} staff={staff} />
              </section>
              <section className="context-block">
                <p className="context-label">評価の進捗</p>
                <div className="evaluation-progress">
                  <strong>{num(selectedTask.criteria_scored)} / {num(selectedTask.criteria_total)} 軸</strong>
                  <span>{nextEvaluation ? `次に評価できる: ${nextEvaluation.step_name}` : '評価待ちの軸はありません'}</span>
                </div>
              </section>
              <section className="context-block">
                <p className="context-label">接点</p>
                <div className="touchpoint-facts">
                  <div><span>初回接点</span><strong>{firstTouch ? jstDateTime(firstTouch.occurred_at) : '記録なし'}</strong></div>
                  <div><span>最終接点</span><strong>{lastTouch ? jstDateTime(lastTouch.occurred_at) : '記録なし'}</strong></div>
                  <div><span>接点回数</span><strong>{num(touchpoints.length)} 件</strong></div>
                  <div><span>最近の接点種別</span><strong>{lastTouch?.channel ?? '記録なし'}</strong></div>
                </div>
                <p className="touchpoint-note"><span>接点メモ</span>{lastTouch?.note ?? '記録なし'}</p>
              </section>
              <section className="context-block context-history">
                <p className="context-label">選考履歴</p>
                {timeline.length === 0 ? <span className="section-note">選考履歴はまだありません</span> : timeline.slice(-3).reverse().map((entry) => <div className="history-item" key={entry.history_id}><span>{jstDateTime(entry.occurred_at)}</span><strong>{entry.transition_type === 'advance' ? '通過' : entry.transition_type === 'reject' ? '不合格' : entry.transition_type === 'withdraw' ? '辞退' : '差し戻し'}{entry.step_name && ` ・ ${entry.step_name}`}</strong></div>)}
              </section>
              <Link href={`/applications/${selectedApplication.application_id}`} className="context-detail-link">応募の詳細を開く →</Link>
            </>
          ) : <Empty>選択できる応募がありません。</Empty>}
        </aside>
      </div>

      <p className="unit-note cockpit-unit-note">
        <strong>単位と母集団。</strong> 「今日やること」「未処理タスク」は件、「接点のある実人数」は人、「現在の選考状況」は年度内の応募件数です。推定 Reach は接触機会の推定値であり、実人数・応募件数とは単位が異なるため、比率や進捗バーにしていません。休眠は最終接点から {DORMANT_DAYS} 日以上、要注意は合成スコアではなく滞留・休眠・接点なしの事実を表示しています。
      </p>
    </>
  )
}

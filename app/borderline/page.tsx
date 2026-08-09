import Link from 'next/link'
import { getDb } from '../../src/db/server.ts'
import { listSeasons, getSeason } from '../../src/queries/dashboard.ts'
import {
  listManualTasks, listDerivedTasks, listCandidatesByConfidence, listStepTabs,
  listCandidatesByStep, listAppointments, getBorderlinePanel,
} from '../../src/queries/borderline.ts'
import { jstDay, num, filled, NotDerived } from '../_components/ui.tsx'
import { Shell, Breadcrumb, YearSwitch, seasonLabel } from '../_components/shell.tsx'
import { ApproachChip, Confidence, RankDelta, taskSentence } from '../_components/headhunting.tsx'
import { WeekCalendar, mondayOf, addDays, Rank, Avatar } from '../_components/borderline.tsx'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
const DAY = /^\d{4}-\d{2}-\d{2}$/

/** 1ページの行数。画像は 1-5 / 120名 だった。 */
const PAGE_SIZE = 5

/**
 * ★ タブは画像の4つで固定する（依頼者の判断）。
 *
 * 実際の選考ステップは年度ごとの登録で、名前も数も違う。
 * 固定すると**タブに載らないステップが出る**ので、その分は
 * 一覧の下に件数付きで明示する。**黙って隠さない。**
 */
const FIXED_TABS: Array<{ id: string; label: string; stepOrder: number | null }> = [
  { id: 'confidence', label: '1. 確度順候補者リスト', stepOrder: null },
  { id: 'step1', label: '2. 書類選考', stepOrder: 1 },
  { id: 'step3', label: '3. 2次選考', stepOrder: 3 },
  { id: 'step4', label: '4. 最終選考', stepOrder: 4 },
]

export default async function BorderlinePage({
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
      <Shell active="borderline">
        <p className="hh-empty-shell">
          年度が1件も登録されていない。選考は年度ごとに動くため、
          年度が無いと候補者を置く場所が決まらない。
        </p>
      </Shell>
    )
  }

  const [manual, derived, stepTabs] = await Promise.all([
    listManualTasks(db, season.id),
    listDerivedTasks(db, season.id),
    listStepTabs(db, season.id),
  ])

  // --- やること。出どころが2つあるので、ここで初めて合流させる ---
  const tasks = [
    ...manual.map((t) => ({
      key: `m-${t.manual_task_id}`,
      title: t.title,
      person_name: t.person_name,
      owner: t.owner_name,
      urgency: t.is_overdue ? 'overdue' : t.urgency,
      due_on: t.due_on as Date | null,
      due_time: t.due_time,
      waiting_days: null as number | null,
      href: null as string | null,
    })),
    ...derived.map((t) => ({
      key: `d-${t.source_id}`,
      title: taskSentence(t.kind, t.person_name, t.step_name),
      person_name: t.person_name,
      owner: t.owner,
      urgency: t.is_overdue ? 'overdue' : 'due',
      due_on: null as Date | null,
      due_time: null as string | null,
      waiting_days: t.waiting_days as number | null,
      href: `/applications/${t.source_id}`,
    })),
  ].sort((a, b) => {
    const rank = (u: string) => (u === 'overdue' ? 0 : u === 'due' ? 1 : u === 'in_progress' ? 2 : 3)
    return rank(a.urgency) - rank(b.urgency)
  })

  // --- 一覧のタブ ---
  const tabId = one(sp.tab) ?? 'confidence'
  const tab = FIXED_TABS.find((t) => t.id === tabId) ?? FIXED_TABS[0]!
  const step = tab.stepOrder === null
    ? null
    : stepTabs.find((s) => s.sort_order === tab.stepOrder) ?? null

  const pageParam = Number(one(sp.page) ?? '1')
  const page = Number.isInteger(pageParam) && pageParam >= 1 ? pageParam : 1

  const [candidates, stepRows] = await Promise.all([
    tab.stepOrder === null
      ? listCandidatesByConfidence(db, season.id, {
        limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE,
      })
      : Promise.resolve(null),
    step ? listCandidatesByStep(db, season.id, step.selection_step_id) : Promise.resolve(null),
  ])

  // 先頭4件しか出さないので、出ていない分を数で示す。
  // **並びは緊急度順**（期限超過が先）なので、放っておくと
  // 「進行中」「タスク」が一度も画面に現れない年度がある。
  const byUrgency = {
    overdue: tasks.filter((t) => t.urgency === 'overdue').length,
    due: tasks.filter((t) => t.urgency === 'due').length,
    in_progress: tasks.filter((t) => t.urgency === 'in_progress').length,
    later: tasks.filter((t) => t.urgency === 'later').length,
  }

  const totalPages = candidates ? Math.max(1, Math.ceil(candidates.total / PAGE_SIZE)) : 1

  // タブに載っていないステップ。件数ごと出して、隠れていないことを示す。
  const shownOrders = FIXED_TABS.flatMap((t) => (t.stepOrder === null ? [] : [t.stepOrder]))
  const hiddenSteps = stepTabs.filter((s) => !shownOrders.includes(s.sort_order))

  // --- 右のパネル。指定が無ければ一覧の先頭 ---
  const requested = one(sp.person)
  const personId = requested && UUID.test(requested)
    ? requested
    : (candidates?.rows[0]?.person_id ?? stepRows?.[0]?.person_id ?? null)
  const panel = personId ? await getBorderlinePanel(db, personId, season.id) : null

  // --- 週の日程 ---
  const weekParam = one(sp.week)
  const anchor = weekParam && DAY.test(weekParam)
    ? weekParam
    : new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
  const monday = mondayOf(anchor)
  const sunday = addDays(monday, 6)
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
  const appointments = await listAppointments(db, season.id, monday, sunday)

  const href = (q: Record<string, string>) =>
    `/borderline?${new URLSearchParams({ season: season.id, tab: tab.id, ...q })}`

  return (
    <Shell
      active="borderline"
      years={<YearSwitch seasons={seasons} currentId={season.id} basePath="/borderline" />}
    >
      <Breadcrumb
        root={seasonLabel(season)}
        crumbs={[
          { label: 'ボーダーライン', href: `/borderline?season=${season.id}` },
          ...(panel ? [{ label: panel.person_name }] : []),
        ]}
      />

      <div className="hh-grid">
        <div className="hh-col-main">
          {/* --- やること --- */}
          <section className="panel-card">
            <header className="hh-head">
              <h2>やること</h2>
              <Link href={`/operations?season=${season.id}`} className="hh-more">すべて見る ›</Link>
            </header>
            {tasks.length === 0 ? (
              <p className="hh-empty">開いているやることは無い。</p>
            ) : (
              <ul className="hh-tasks">
                {tasks.slice(0, 4).map((t) => (
                  <li key={t.key} className="task-card">
                    <span className={
                      t.urgency === 'overdue' ? 'chip-amber'
                        : t.urgency === 'in_progress' ? 'chip-green'
                          : t.urgency === 'due' ? 'chip-blue' : 'chip-gray'
                    }>
                      {t.urgency === 'overdue' ? '期限超過'
                        : t.urgency === 'in_progress' ? '進行中'
                          : t.urgency === 'due' ? '要対応' : 'タスク'}
                    </span>
                    <p className="task-title">
                      {t.href ? <Link href={t.href}>{t.title}</Link> : t.title}
                    </p>
                    <p className="task-meta">
                      {t.due_on !== null && (
                        <>{jstDay(t.due_on)}
                          {t.due_time ? ` ${t.due_time.slice(0, 5)} まで` : ' まで'}</>
                      )}
                      {t.waiting_days !== null && <>{t.waiting_days} 日待ち</>}
                      {t.owner ? <> ・ 担当 {t.owner}</> : <> ・ 担当未割当</>}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <p className="hh-note">
              単位は件（1人が複数持ちうる）。開いているやること {num(tasks.length)} 件のうち、
              <strong>期限の近い順に先頭4件</strong>だけを出している。
              内訳は 期限超過 {num(byUrgency.overdue)} ・ 要対応 {num(byUrgency.due)} ・
              進行中 {num(byUrgency.in_progress)} ・ タスク {num(byUrgency.later)}。
              <strong>出どころは2つ</strong> ―― 人が作ったもの {num(manual.length)} 件と、
              選考の記録から導いたもの {num(derived.length)} 件。
              期限の時刻は、決まっているものにだけ出る（無いことを 0:00 と読み替えない）。
            </p>
          </section>

          {/* --- 候補者リスト --- */}
          <section className="panel-card">
            <header className="hh-head">
              <h2>{tab.stepOrder === null ? '確度順候補者リスト' : `${tab.label.replace(/^\d+\. /, '')}の候補者`}</h2>
            </header>

            <div className="bl-tabs">
              {FIXED_TABS.map((t) => (
                <Link
                  key={t.id}
                  href={`/borderline?season=${season.id}&tab=${t.id}`}
                  className={t.id === tab.id ? 'bl-tab is-on btn-physical' : 'bl-tab btn-physical'}
                  aria-current={t.id === tab.id ? 'page' : undefined}
                >
                  {t.label}
                </Link>
              ))}
            </div>

            {tab.stepOrder !== null && !step && (
              <p className="hh-empty">
                このタブに対応する選考ステップが、この年度には登録されていない。
              </p>
            )}

            {candidates && (
              candidates.rows.length === 0 ? (
                <p className="hh-empty">この年度の対象者がまだ1人も登録されていない。</p>
              ) : (
                <table className="hh-table bl-table">
                  <thead>
                    <tr>
                      <th className="num">確度</th><th>順位</th><th>名前</th>
                      <th>学校・学部</th><th>最終接触日</th><th>次のアクション</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.rows.map((r) => (
                      <tr key={r.person_id} className={r.person_id === personId ? 'is-current' : ''}>
                        <td className="num strong">
                          <Confidence ratio={r.confidence_ratio} />
                          <RankDelta delta={r.rank_delta} hasPrevious={r.has_previous_run} />
                        </td>
                        <td><Rank rank={r.rank_in_season} /></td>
                        <td>
                          <Link href={href({ person: r.person_id })} className="bl-person">
                            <Avatar src={r.photo_data_url} name={r.person_name} />
                            {r.person_name}
                          </Link>
                        </td>
                        <td className="dim">{r.school}{r.faculty && <> ・ {r.faculty}</>}</td>
                        <td className="dim">
                          {r.last_touchpoint_on ? jstDay(r.last_touchpoint_on) : 'この年度は接点なし'}
                        </td>
                        <td>
                          {r.approach_code && r.approach_label
                            ? <ApproachChip code={r.approach_code} label={r.approach_label} />
                            : <span className="muted-note">未登録</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            )}

            {stepRows && (
              stepRows.length === 0 ? (
                <p className="hh-empty">このステップで動いている応募は無い。</p>
              ) : (
                <table className="hh-table bl-table">
                  <thead>
                    <tr>
                      <th className="num">100点換算</th><th className="num">軸</th><th>名前</th>
                      <th>学校・学部</th><th className="num">待ち</th><th>担当</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stepRows.map((r) => (
                      <tr key={r.application_id} className={r.person_id === personId ? 'is-current' : ''}>
                        <td className="num strong">{r.score_100 ?? <NotDerived />}</td>
                        <td className="num dim">{r.scored_criteria}</td>
                        <td>
                          <Link href={href({ person: r.person_id })} className="bl-person">
                            <Avatar src={r.photo_data_url} name={r.person_name} />
                            {r.person_name}
                          </Link>
                        </td>
                        <td className="dim">{r.school}{r.faculty && <> ・ {r.faculty}</>}</td>
                        <td className="num dim">{r.waiting_days} 日</td>
                        <td className="dim">{r.owner ?? '未割当'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            )}

            {candidates && candidates.total > PAGE_SIZE && (
              <div className="bl-pager">
                <span className="hh-note">
                  {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, candidates.total)} /{' '}
                  {num(candidates.total)} 名
                </span>
                <span className="bl-pages">
                  {page > 1 && (
                    <Link className="bl-page btn-physical" href={href({ page: String(page - 1) })}>‹</Link>
                  )}
                  <span className="bl-page is-on">{page}</span>
                  {page < totalPages && (
                    <Link className="bl-page btn-physical" href={href({ page: String(page + 1) })}>›</Link>
                  )}
                  <span className="hh-note">/ {totalPages}</span>
                </span>
              </div>
            )}

            <p className="hh-note">
              {tab.stepOrder === null ? (
                <>
                  単位は人。母集団は見送りに至っておらず、個人情報の削除依頼も
                  受けていないこの年度の対象者 {num(candidates?.total ?? 0)} 人。
                  <strong>順位と確度は凍結された値</strong>で、算出日より後の接点は
                  反映されていない。確度が無い人は後ろに回している。
                </>
              ) : (
                <>
                  単位は応募（人ではない）。母集団はこのステップに
                  <strong>まだ提出されていない評価がある応募</strong>。
                  100点換算は<strong>実際に受けた軸の満点</strong>で割った達成率で、
                  「軸」が少ないほど根拠は薄い。
                </>
              )}
              {hiddenSteps.length > 0 && (
                <>
                  <br />
                  <strong>タブに載っていない選考ステップがある</strong>:{' '}
                  {hiddenSteps.map((s) => `${s.step_name}（${s.open_applications} 件）`).join(' ・ ')}。
                  タブは4つ固定のため、ここからは開けない。
                </>
              )}
            </p>
          </section>
        </div>

        <div className="hh-col-side">
          {/* --- 候補者パネル --- */}
          <section className="panel-card">
            {!panel ? (
              <p className="hh-empty">候補者がまだ1人も居ない。</p>
            ) : (
              <>
                <header className="hh-person-head">
                  <div className="bl-person-head">
                    <Avatar src={panel.photo_data_url} name={panel.person_name} />
                    <div>
                      <h2 className="hh-person-name">{panel.person_name}</h2>
                      {panel.person_kana && <p className="hh-person-kana">{panel.person_kana}</p>}
                    </div>
                  </div>
                  <div className="bl-person-chips">
                    <span className="chip-green"><Confidence ratio={panel.confidence_ratio} /></span>
                    {panel.approach_code && panel.approach_label && (
                      <ApproachChip code={panel.approach_code} label={panel.approach_label} />
                    )}
                  </div>
                </header>

                <h3 className="hh-sub">基本情報</h3>
                <dl className="hh-facts">
                  <dt>学校</dt><dd>{panel.school}</dd>
                  <dt>学部・学科</dt><dd>{filled(panel.faculty)}</dd>
                  <dt>メール</dt><dd>{panel.email}</dd>
                  <dt>電話番号</dt><dd>{filled(panel.phone)}</dd>
                  <dt>生年月日</dt><dd>{jstDay(panel.birth_date)}（{panel.age} 歳）</dd>
                  <dt>最終接触日</dt>
                  <dd>{panel.last_touchpoint_on ? jstDay(panel.last_touchpoint_on) : 'この年度は接点なし'}</dd>
                  <dt>順位</dt>
                  <dd>{panel.rank_in_season !== null
                    ? `${panel.rank_in_season} 位` : <NotDerived>確度がまだ無い</NotDerived>}</dd>
                  <dt>成績（100点換算）</dt>
                  <dd>{panel.score_100 ?? <NotDerived>評価がまだ無い</NotDerived>}</dd>
                </dl>

                {panel.note && (
                  <>
                    <h3 className="hh-sub">メモ</h3>
                    <p className="hh-memo">{panel.note}</p>
                  </>
                )}

                <Link href={`/people/${panel.person_id}?season=${season.id}`} className="hh-more">
                  詳細を見る ›
                </Link>
              </>
            )}
          </section>

          {/* --- 日程カレンダー --- */}
          <section className="panel-card">
            <header className="hh-head">
              <h2>日程カレンダー</h2>
              <span className="bl-week-nav">
                <Link className="bl-page btn-physical" href={href({ week: addDays(monday, -7) })}>‹</Link>
                <Link className="bl-page btn-physical" href={href({ week: today })}>今日</Link>
                <Link className="bl-page btn-physical" href={href({ week: addDays(monday, 7) })}>›</Link>
              </span>
            </header>
            <p className="hh-note" style={{ marginTop: 0 }}>
              {monday.replace(/-/g, '/')} 〜 {sunday.replace(/-/g, '/')}
            </p>
            {appointments.length === 0 ? (
              <p className="hh-empty">この週に登録された予定は無い。</p>
            ) : (
              <WeekCalendar monday={monday} appointments={appointments} today={today} />
            )}
            <p className="hh-note">
              単位は件。母集団はこの年度の、取り消されていない予定 {num(appointments.length)} 件。
              <strong>予定は接点とは別の記録</strong>で、起きたかどうかは分からない
              （実際に会った事実は接点として別に記録する）。
            </p>
          </section>
        </div>
      </div>

      <details className="panel-card hh-gaps">
        <summary>この画面にまだ無いもの（記録層に事実が無い）</summary>
        <ul>
          <li><strong>評価サマリーの4軸</strong>（スキル・ポテンシャル・カルチャーフィット・リーダーシップ）— 実際の軸は年度ごとの登録で、名前も数も違う</li>
          <li><strong>通知</strong> — 記録層が無い</li>
          <li><strong>アカウント・設定・ログアウト</strong> — 認証がまだ無い</li>
          <li><strong>並べ替えと絞り込みの操作</strong> — 並びは確度順で固定。切り替える記録も要件もまだ無い</li>
          <li><strong>予定が実際に起きたかの記録</strong> — 予定と接点をつなぐ手当てが未実装</li>
          <li><strong>やることを画面から作る・終える操作</strong> — 記録層はあるが、書き込む入口がまだ無い</li>
          <li><strong>手で作ったやることの全件一覧</strong> — 「すべて見る」は選考オペレーション（導出のぶん）へ行く</li>
          <li><strong>予定を画面から作る・動かす操作</strong> — 記録層と変更履歴はあるが、入口がまだ無い</li>
        </ul>
      </details>
    </Shell>
  )
}

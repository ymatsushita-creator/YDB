import Link from 'next/link'
import { getDb } from '../../src/db/server.ts'
import { listSeasons, defaultSeason, getSeason } from '../../src/queries/dashboard.ts'
import {
  listCandidatesByConfidence, listStepTabs,
  listCandidatesByStep, listAppointments, getBorderlinePanel, getScoringSheet,
  countAwaitingDecision,
  listPersonNotes, getAppointmentDetail, listAttendanceCandidates,
} from '../../src/queries/borderline.ts'
import { APPLY_AI_LOGIC_MESSAGE } from '../../src/commands/ai_pre_assessment.ts'
import {
  parseSaveScoreCode, SAVE_SCORE_CODE_MESSAGE,
} from '../../src/commands/score.ts'
import { parseDecideCode, DECIDE_CODE_MESSAGE } from '../../src/commands/decide.ts'
import { parseAddNoteCode, NOTE_MESSAGE } from '../../src/commands/note.ts'
import { parseAttendanceCode, ATTENDANCE_MESSAGE } from '../../src/commands/attend.ts'
import { ScoreSheet } from '../_components/scoring.tsx'
import { num, NotDerived } from '../_components/ui.tsx'
import { Shell, Breadcrumb, YearSwitch, seasonLabel } from '../_components/shell.tsx'
import { ApproachChip, Confidence, RankDelta, PersonHoverCard } from '../_components/headhunting.tsx'
import {
  WeekCalendar, mondayOf, addDays, Rank, Avatar, MemoPopup, AttendancePopup,
} from '../_components/borderline.tsx'
import { currentTier } from '../../src/auth/current.ts'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
const DAY = /^\d{4}-\d{2}-\d{2}$/

const LIST_LIMIT = 2000

const FIXED_TABS: Array<{ id: string; label: string; stepName: string | null }> = [
  { id: 'confidence', label: '1. 確度順候補者リスト', stepName: null },
  { id: 'step1', label: '2. 書類選考', stepName: '書類選考' },
  { id: 'step3', label: '3. 2次選考', stepName: 'グループ面接' },
  { id: 'step4', label: '4. 最終選考', stepName: '最終面接' },
]

export default async function BorderlinePage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const db = await getDb()
  const [tier, seasons, seasonByParam] = await Promise.all([
    currentTier(),
    listSeasons(db),
    sp.season ? getSeason(db, sp.season) : Promise.resolve(null),
  ])
  const showAi = tier === 'all'
  const season = seasonByParam ?? defaultSeason(seasons)

  if (!season) {
    return (
      <Shell active="borderline">
        <p className="hh-empty-shell">年度が1件も登録されていない。</p>
      </Shell>
    )
  }

  const stepTabs = await listStepTabs(db, season.id)

  const tabId = one(sp.tab) ?? 'confidence'
  const tab = FIXED_TABS.find((t) => t.id === tabId) ?? FIXED_TABS[0]!
  const step = tab.stepName === null
    ? null
    : stepTabs.find((s) => s.step_name === tab.stepName) ?? null

  const [candidates, stepRows] = await Promise.all([
    tab.stepName === null
      ? listCandidatesByConfidence(db, season.id, {
        limit: LIST_LIMIT, offset: 0,
      })
      : Promise.resolve(null),
    step ? listCandidatesByStep(db, season.id, step.selection_step_id) : Promise.resolve(null),
  ])

  // 検索クエリ適用
  const query = (one(sp.q) ?? '').trim().toLowerCase()
  const filteredCandidateRows = candidates && query
    ? candidates.rows.filter((r) => r.person_name.toLowerCase().includes(query) || r.school?.toLowerCase().includes(query))
    : candidates?.rows
  const filteredStepRows = stepRows && query
    ? stepRows.filter((r) => r.person_name.toLowerCase().includes(query) || r.school?.toLowerCase().includes(query))
    : stepRows

  const awaitingDecision = step
    ? await countAwaitingDecision(db, season.id, step.selection_step_id)
    : 0

  const shownNames = FIXED_TABS.flatMap((t) => (t.stepName === null ? [] : [t.stepName]))
  const hiddenSteps = stepTabs.filter((s) => !shownNames.includes(s.step_name))

  const memoParam = one(sp.memo)
  const memoPersonId = memoParam && UUID.test(memoParam) ? memoParam : null
  const requested = memoPersonId ?? one(sp.person)
  const personId = requested && UUID.test(requested)
    ? requested
    : (filteredCandidateRows?.[0]?.person_id ?? filteredStepRows?.[0]?.person_id ?? null)
  const panel = personId ? await getBorderlinePanel(db, personId, season.id) : null

  const notes = memoPersonId ? await listPersonNotes(db, memoPersonId) : []

  const scoringRow = filteredStepRows?.find((r) => r.person_id === personId) ?? null
  const sheet = scoringRow ? await getScoringSheet(db, scoringRow.evaluation_id) : null

  const savedScore = parseSaveScoreCode(sp.score)
  const savedDecide = parseDecideCode(sp.decide)

  const weekParam = one(sp.week)
  const anchor = weekParam && DAY.test(weekParam)
    ? weekParam
    : new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
  const monday = mondayOf(anchor)
  const sunday = addDays(monday, 6)
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
  const appointments = await listAppointments(db, season.id, monday, sunday)

  const apptParam = one(sp.appt)
  const apptId = apptParam && UUID.test(apptParam) ? apptParam : null
  const appointment = apptId ? await getAppointmentDetail(db, apptId, season.id) : null
  const attendees = appointment
    ? await listAttendanceCandidates(db, appointment.appointment_id, season.id)
    : []

  const href = (q: Record<string, string>) =>
    `/borderline?${new URLSearchParams({ season: season.id, tab: tab.id, ...q })}`

  const hereHref = (q: Record<string, string>) =>
    `/borderline?${new URLSearchParams({
      season: season.id, tab: tab.id, week: monday, ...q,
    })}`

  const scoreHref = (personId: string) =>
    `/borderline/${personId}?${new URLSearchParams({ season: season.id, tab: tab.id })}`

  const savedNote = parseAddNoteCode(sp.note)
  const savedAttend = parseAttendanceCode(sp.attend)

  return (
    <Shell
      active="borderline"
      seasonId={season.id}
      years={<YearSwitch seasons={seasons} currentId={season.id} basePath="/borderline" />}
    >
      <Breadcrumb
        root={seasonLabel(season)}
        crumbs={[
          { label: '通常選考', href: `/borderline?season=${season.id}` },
          ...(panel ? [{ label: panel.person_name }] : []),
        ]}
      />

      {/* 検索・絞り込みフォーム */}
      <div className="section" style={{ marginTop: 'var(--space-xs)', marginBottom: 'var(--space-xs)' }}>
        <form method="get" action="/borderline" className="conf-row">
          <input type="hidden" name="season" value={season.id} />
          <input type="hidden" name="tab" value={tab.id} />
          <input
            className="text-input"
            name="q"
            defaultValue={query}
            placeholder="氏名・学校名で絞り込み..."
            style={{ maxWidth: '300px' }}
          />
          <button type="submit" className="button-secondary">絞り込む</button>
          {query && (
            <Link href={`/borderline?season=${season.id}&tab=${tab.id}`} className="button-secondary-sm">
              クリア
            </Link>
          )}
        </form>
      </div>

      <div className="hh-grid">
        <div className="hh-col-main">
          {/* --- 候補者リスト --- */}
          <section className="panel-card">
            <header className="hh-head">
              <h2>{tab.stepName === null ? '確度順候補者リスト' : `${tab.label.replace(/^\d+\. /, '')}の候補者`}</h2>
            </header>

            <div className="bl-tabs">
              {FIXED_TABS.map((t) => (
                <Link
                  key={t.id}
                  href={`/borderline?season=${season.id}&tab=${t.id}${query ? `&q=${encodeURIComponent(query)}` : ''}`}
                  className={t.id === tab.id ? 'bl-tab is-on btn-physical' : 'bl-tab btn-physical'}
                  aria-current={t.id === tab.id ? 'page' : undefined}
                >
                  {t.label}
                </Link>
              ))}
            </div>

            {tab.id === 'step1' && showAi && (
              <p className="pilot-entry">
                採点 ›{' '}
                <Link href={`/ai?season=${season.id}`} className="hh-more">AI分析 ›</Link>
              </p>
            )}

            {tab.stepName !== null && !step && (
              <p className="hh-empty">この期にこの選考は無い。</p>
            )}

            {filteredCandidateRows && (
              candidates?.rows.length === 0 ? (
                <p className="hh-empty">この年度の対象者がまだ1人も登録されていない。</p>
              ) : filteredCandidateRows.length === 0 ? (
                <p className="hh-empty">該当する候補者がありません。</p>
              ) : (
                <div className="scroll-pane">
                  <table className="hh-table bl-table candidate-unified-table">
                    <thead>
                      <tr>
                        <th>顔写真</th><th>番号</th><th className="num">確度</th><th>順位</th>
                        <th>氏名</th>
                        <th>生年月日</th><th>学校</th><th>学部・学科</th>
                        <th>メール</th><th>電話番号</th><th>LINE ID</th>
                        <th>流入元</th><th>接点の日</th><th>アプローチ状態</th>
                        <th>担当者メモ</th><th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCandidateRows.map((r) => (
                        <tr key={r.person_id}
                          className={`row-link${r.person_id === personId ? ' is-current' : ''}`}>
                          <td className="candidate-photo-cell">
                            {r.has_photo
                              ? <img className="avatar" src={`/people/new/photo/${r.person_id}`}
                                     alt={`${r.person_name}さんの顔写真`}
                                     width={32} height={32} loading="lazy" />
                              : <Avatar src={null} name={r.person_name} />}
                          </td>
                          <td className="num dim">{r.number ?? '—'}</td>
                          <td className="num strong">
                            <Confidence ratio={r.confidence_ratio} />
                            <RankDelta delta={r.rank_delta} hasPrevious={r.has_previous_run} />
                          </td>
                          <td><Rank rank={r.rank_in_season} /></td>
                          <td>
                            <PersonHoverCard
                              personId={r.person_id}
                              seasonId={season.id}
                              name={r.person_name}
                              photoUrl={r.has_photo ? `/people/new/photo/${r.person_id}` : null}
                              confidenceRatio={r.confidence_ratio}
                            >
                              {r.person_name}
                            </PersonHoverCard>
                          </td>
                          <td className="nowrap dim">{r.birth_date ?? '—'}</td>
                          <td>{r.school}</td>
                          <td className="dim">{r.faculty ?? '—'}</td>
                          <td>{r.email ?? '—'}</td>
                          <td className="nowrap">{r.phone ?? '—'}</td>
                          <td>{r.line_user_id ?? '—'}</td>
                          <td>{r.first_channel_name ?? '—'}</td>
                          <td className="nowrap dim">{r.first_contacted_on ?? '—'}</td>
                          <td>
                            {r.approach_code && r.approach_label
                              ? <ApproachChip code={r.approach_code} label={r.approach_label} />
                              : <span className="muted-note">未登録</span>}
                          </td>
                          <td>{r.note ?? '—'}</td>
                          <td className="candidate-row-actions">
                            <div className="row-actions-wrap">
                              <Link href={`/people/${r.person_id}?season=${season.id}`}
                                    className="row-detail"
                                    aria-label={`${r.person_name} の記録を開く`}>›</Link>
                              <span className="row-actions">
                                <Link className="row-action btn-physical"
                                      href={hereHref({
                                        person: r.person_id, open: r.person_id,
                                        memo: r.person_id,
                                      })}>メモ</Link>
                                <Link className="row-action btn-physical"
                                      href={scoreHref(r.person_id)}>採点</Link>
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}

            {filteredStepRows && (
              stepRows?.length === 0 ? (
                <p className="hh-empty">
                  このステップで動いている応募は無い。
                  選考は「1. 確度順候補者リスト」で人を選び、
                  右の「詳細を見る」→「選考を始める」から始まる。
                </p>
              ) : filteredStepRows.length === 0 ? (
                <p className="hh-empty">該当する候補者がありません。</p>
              ) : (
                <div className="scroll-pane">
                  <table className="hh-table bl-table">
                    <thead>
                      <tr>
                        <th className="num">100点換算</th><th className="num">軸</th><th>名前（ホバーで概要/クリックで詳細）</th>
                        <th>学校・学部</th><th className="num">待ち</th><th>担当</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredStepRows.map((r) => (
                        <tr key={r.application_id}
                          className={`row-link${r.person_id === personId ? ' is-current' : ''}`}>
                          <td className="num strong">{r.score_100 ?? <NotDerived />}</td>
                          <td className="num dim">{r.scored_criteria}</td>
                          <td>
                            <PersonHoverCard
                              personId={r.person_id}
                              seasonId={season.id}
                              name={r.person_name}
                              photoUrl={r.photo_data_url}
                              score100={r.score_100}
                            >
                              <Avatar src={r.photo_data_url} name={r.person_name} />
                              {r.person_name}
                            </PersonHoverCard>
                            <Link href={`/applications/${r.application_id}`}
                                  className="row-detail"
                                  aria-label={`${r.person_name} の応募を開く`}>›</Link>
                            <span className="row-actions">
                              <Link className="row-action btn-physical"
                                    href={hereHref({
                                      person: r.person_id, open: r.person_id,
                                      memo: r.person_id,
                                    })}>メモ</Link>
                              <Link className="row-action btn-physical"
                                    href={scoreHref(r.person_id)}>採点</Link>
                            </span>
                          </td>
                          <td className="dim">{r.school}{r.faculty && <> ・ {r.faculty}</>}</td>
                          <td className="num dim">{r.waiting_days} 日</td>
                          <td className="dim">{r.owner ?? '未割当'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}

            {step && awaitingDecision > 0 && (
              <p className="section-note">
                この段で確定済み・判定待ちが {num(awaitingDecision)} 件ある。
                判定は、その応募の画面（氏名の隣の「›」）で行う。
              </p>
            )}

            {hiddenSteps.length > 0 && (
              <p className="section-note">
                タブに無い段:{' '}
                {hiddenSteps.map((s) => `${s.step_name} ${num(s.open_applications)} 件`).join(' / ')}
              </p>
            )}

            <p className="section-note" style={{ marginTop: 'var(--space-xs)' }}>
              <Link href={`/pilot?season=${season.id}`} className="section-note">
                試運転の手順
              </Link>
            </p>
          </section>
        </div>

        <div className="hh-col-side">
          {!candidates && !panel && (
            <section className="panel-card">
              <p className="hh-empty">
                この段に候補者が居ない。「1. 確度順候補者リスト」から人を選ぶ。
              </p>
            </section>
          )}

          {sheet && panel && (
            <section className="panel-card">
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

              <div className="scroll-pane">
                {(savedScore || savedDecide) && (
                  <>
                    {savedScore && (
                      <p className={`callout${savedScore === 'saved' ? ' ok' : ''}`}>
                        {SAVE_SCORE_CODE_MESSAGE[savedScore]}
                      </p>
                    )}
                    {typeof sp.ai === 'string' && APPLY_AI_LOGIC_MESSAGE[sp.ai] && (
                      <p className={`callout${sp.ai === 'applied' ? ' ok' : ''}`}>
                        {APPLY_AI_LOGIC_MESSAGE[sp.ai]}
                      </p>
                    )}
                    {savedDecide && (
                      <p className={`callout${savedDecide === 'submitted' ? ' ok' : ''}`}>
                        {DECIDE_CODE_MESSAGE[savedDecide]}
                      </p>
                    )}
                  </>
                )}
                <ScoreSheet
                  sheet={sheet}
                  showAi={showAi}
                  context={{
                    seasonId: season.id,
                    tab: tab.id,
                    personId: sheet.person_id,
                    week: monday,
                  }}
                />
              </div>
            </section>
          )}

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
              <WeekCalendar
                monday={monday} appointments={appointments} today={today}
                hrefFor={(id) => hereHref({ appt: id })}
              />
            )}
          </section>
        </div>
      </div>

      {memoPersonId && panel && (
        <MemoPopup
          personName={panel.person_name}
          notes={notes}
          closeHref={hereHref({ person: memoPersonId, open: memoPersonId })}
          message={savedNote ? NOTE_MESSAGE[savedNote] : null}
          ok={savedNote === 'saved' || savedNote === 'undone'}
          context={{
            personId: memoPersonId, seasonId: season.id, tab: tab.id, week: monday,
          }}
        />
      )}

      {appointment && (
        <AttendancePopup
          appointment={appointment}
          candidates={attendees}
          closeHref={hereHref({})}
          message={savedAttend ? ATTENDANCE_MESSAGE[savedAttend] : null}
          ok={savedAttend === 'saved'}
          context={{ seasonId: season.id, tab: tab.id, week: monday }}
        />
      )}
    </Shell>
  )
}


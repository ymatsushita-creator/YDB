import Link from 'next/link'
import { getDb } from '../../src/db/server.ts'
import { listSeasons, defaultSeason, getSeason } from '../../src/queries/dashboard.ts'
import {
  listCandidatesByConfidence, listStepTabs,
  listCandidatesByStep, listAppointments, getBorderlinePanel, getScoringSheet,
  listPersonNotes, getAppointmentDetail, listAttendanceCandidates,
} from '../../src/queries/borderline.ts'
import {
  parseSaveScoreCode, SAVE_SCORE_CODE_MESSAGE,
} from '../../src/commands/score.ts'
import { parseDecideCode, DECIDE_CODE_MESSAGE } from '../../src/commands/decide.ts'
import { parseAddNoteCode, NOTE_MESSAGE } from '../../src/commands/note.ts'
import { parseAttendanceCode, ATTENDANCE_MESSAGE } from '../../src/commands/attend.ts'
import { ScoreSheet } from '../_components/scoring.tsx'
import { jstDay, num, filled, NotDerived } from '../_components/ui.tsx'
import { Shell, Breadcrumb, YearSwitch, seasonLabel } from '../_components/shell.tsx'
import { ApproachChip, Confidence, RankDelta } from '../_components/headhunting.tsx'
import {
  WeekCalendar, mondayOf, addDays, Rank, Avatar, MemoPopup, AttendancePopup,
} from '../_components/borderline.tsx'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
const DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * 一覧は**全件出す**（依頼者の指示）。
 *
 * かつては1ページ5行で送っていた。48人の期で**10ページ**になり、
 * 「確度順の候補者リスト」なのに**上位5人しか一覧できなかった。**
 * 表はカードの中で送れる（`.scroll-pane`）ので、ページに割る理由が無い。
 */
/**
 * 一覧の上限。**表示を切るためではなく、暴走を止めるための数である。**
 *
 * ★ 500 だと、実データ（1期で 294 人）はまだ入るが、
 *   期をまたいで積み上がれば黙って切れる。**切るなら言う**（下）。
 */
const LIST_LIMIT = 2000

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
    ?? defaultSeason(seasons)

  if (!season) {
    return (
      <Shell active="borderline">
        <p className="hh-empty-shell">年度が1件も登録されていない。</p>
      </Shell>
    )
  }

  const stepTabs = await listStepTabs(db, season.id)

  // --- 一覧のタブ ---
  const tabId = one(sp.tab) ?? 'confidence'
  const tab = FIXED_TABS.find((t) => t.id === tabId) ?? FIXED_TABS[0]!
  const step = tab.stepOrder === null
    ? null
    : stepTabs.find((s) => s.sort_order === tab.stepOrder) ?? null

  const [candidates, stepRows] = await Promise.all([
    tab.stepOrder === null
      ? listCandidatesByConfidence(db, season.id, {
        limit: LIST_LIMIT, offset: 0,
      })
      : Promise.resolve(null),
    step ? listCandidatesByStep(db, season.id, step.selection_step_id) : Promise.resolve(null),
  ])

  // タブに載っていないステップ。件数ごと出して、隠れていないことを示す。
  const shownOrders = FIXED_TABS.flatMap((t) => (t.stepOrder === null ? [] : [t.stepOrder]))
  const hiddenSteps = stepTabs.filter((s) => !shownOrders.includes(s.sort_order))

  // --- 右のパネル。指定が無ければ一覧の先頭 ---
  // ★ メモを開いているなら、その人をパネルにも出す。
  //   別の人のパネルを横に置いたままメモを開くと、どちらの人の話か分からなくなる。
  const memoParam = one(sp.memo)
  const memoPersonId = memoParam && UUID.test(memoParam) ? memoParam : null
  const requested = memoPersonId ?? one(sp.person)
  const personId = requested && UUID.test(requested)
    ? requested
    : (candidates?.rows[0]?.person_id ?? stepRows?.[0]?.person_id ?? null)
  const panel = personId ? await getBorderlinePanel(db, personId, season.id) : null

  // 名前を押した人。押すとその行に「メモ」と「採点」が出る（実行⑪）。
  const openParam = one(sp.open)
  const openPersonId = openParam && UUID.test(openParam) ? openParam : memoPersonId

  const notes = memoPersonId ? await listPersonNotes(db, memoPersonId) : []

  // --- 採点シート（実行⑩）---
  // 選考タブに居るときだけ。**一覧の行が名指しした評価をそのまま渡す。**
  // ここで「この人のこのステップの評価」を引き直すと、面接官が2人のときに
  // 一覧が畳んだのとは別の評価へ点が入りうる（src/queries/borderline.ts）。
  const scoringRow = stepRows?.find((r) => r.person_id === personId) ?? null
  const sheet = scoringRow ? await getScoringSheet(db, scoringRow.evaluation_id) : null

  // 直前の保存の結果。知らないコードは「何も起きていない」として捨てる。
  const savedScore = parseSaveScoreCode(sp.score)
  const savedDecide = parseDecideCode(sp.decide)

  // --- 週の日程 ---
  const weekParam = one(sp.week)
  const anchor = weekParam && DAY.test(weekParam)
    ? weekParam
    : new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
  const monday = mondayOf(anchor)
  const sunday = addDays(monday, 6)
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
  const appointments = await listAppointments(db, season.id, monday, sunday)

  // --- 予定の参加者（実行⑪）---
  const apptParam = one(sp.appt)
  const apptId = apptParam && UUID.test(apptParam) ? apptParam : null
  const appointment = apptId ? await getAppointmentDetail(db, apptId, season.id) : null
  const attendees = appointment
    ? await listAttendanceCandidates(db, appointment.appointment_id, season.id)
    : []

  const href = (q: Record<string, string>) =>
    `/borderline?${new URLSearchParams({ season: season.id, tab: tab.id, ...q })}`

  /** 見ている週を落とさずに戻る先。ポップアップの開閉で週が今週へ戻らない。 */
  const hereHref = (q: Record<string, string>) =>
    `/borderline?${new URLSearchParams({
      season: season.id, tab: tab.id, week: monday, ...q,
    })}`

  /** 氏名を押したときの行き先 ―― 採点レイヤー。どのタブから来たかを持たせる。 */
  const scoreHref = (personId: string) =>
    `/borderline/${personId}?${new URLSearchParams({ season: season.id, tab: tab.id })}`

  // 直前の保存の結果（メモ・参加者）。
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

      {/* ★ 試運転の手順（`/pilot`）へ入る道。**その画面は「通常選考 › 試運転」と
          名乗っているのに、どこからもリンクされていなかった**（実行⑬で数えて分かった）。
          名乗った親から繋ぐ ―― 手打ちのURLでしか開けない画面は、無いのと同じである。
          Pilot は HOLD のままで、これは足場である（観測が取れたら消してよい）。 */}
      <p className="pilot-entry">
        <Link href={`/pilot?season=${season.id}`} className="hh-more">
          試運転の手順（30 分）›
        </Link>
      </p>

      <div className="hh-grid">
        <div className="hh-col-main">
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
              <p className="hh-empty">この期にこの選考は無い。</p>
            )}

            {candidates && (
              candidates.rows.length === 0 ? (
                <p className="hh-empty">この年度の対象者がまだ1人も登録されていない。</p>
              ) : (
                <div className="scroll-pane">
                  <table className="hh-table bl-table candidate-unified-table">
                    <thead>
                      <tr>
                        <th>顔写真</th><th>番号</th><th className="num">確度</th><th>順位</th>
                        <th>姓</th><th>名</th><th>姓（かな）</th><th>名（かな）</th>
                        <th>生年月日</th><th>学校</th><th>学部・学科</th>
                        <th>メール</th><th>電話番号</th><th>LINE ID</th>
                        <th>流入元</th><th>接点の日</th><th>アプローチ状態</th>
                        <th>担当者メモ</th><th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {candidates.rows.map((r) => (
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
                            {/* 姓を押すと、その行に「メモ」と「採点」が出る
                                （実行⑪。依頼者の指示）。押しただけでは何も起きず、
                                行き先は出てきたボタンが決める。
                                右の「›」はその人の記録。 */}
                            <Link href={hereHref({ person: r.person_id, open: r.person_id })}
                                  className="bl-person">
                              {r.family_name}
                            </Link>
                          </td>
                          <td>{r.given_name}</td>
                          <td className="dim">{r.family_name_kana ?? '—'}</td>
                          <td className="dim">{r.given_name_kana ?? '—'}</td>
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
                            <Link href={`/people/${r.person_id}?season=${season.id}`}
                                  className="row-detail"
                                  aria-label={`${r.person_name} の記録を開く`}>›</Link>
                            {openPersonId === r.person_id && (
                              <span className="row-actions">
                                <Link className="row-action btn-physical"
                                      href={hereHref({
                                        person: r.person_id, open: r.person_id,
                                        memo: r.person_id,
                                      })}>メモ</Link>
                                <Link className="row-action btn-physical"
                                      href={scoreHref(r.person_id)}>採点</Link>
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}

            {stepRows && (
              stepRows.length === 0 ? (
                <p className="hh-empty">このステップで動いている応募は無い。</p>
              ) : (
                <div className="scroll-pane">
                  <table className="hh-table bl-table">
                    <thead>
                      <tr>
                        <th className="num">100点換算</th><th className="num">軸</th><th>名前</th>
                        <th>学校・学部</th><th className="num">待ち</th><th>担当</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stepRows.map((r) => (
                        <tr key={r.application_id}
                          className={`row-link${r.person_id === personId ? ' is-current' : ''}`}>
                          <td className="num strong">{r.score_100 ?? <NotDerived />}</td>
                          <td className="num dim">{r.scored_criteria}</td>
                          <td>
                            <Link href={hereHref({ person: r.person_id, open: r.person_id })}
                                  className="bl-person">
                              <Avatar src={r.photo_data_url} name={r.person_name} />
                              {r.person_name}
                            </Link>
                            <Link href={`/applications/${r.application_id}`}
                                  className="row-detail"
                                  aria-label={`${r.person_name} の応募を開く`}>›</Link>
                            {openPersonId === r.person_id && (
                              <span className="row-actions">
                                <Link className="row-action btn-physical"
                                      href={hereHref({
                                        person: r.person_id, open: r.person_id,
                                        memo: r.person_id,
                                      })}>メモ</Link>
                                <Link className="row-action btn-physical"
                                      href={scoreHref(r.person_id)}>採点</Link>
                              </span>
                            )}
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

                <div className="scroll-pane">
                {/* 採点（実行⑩）。選考タブで、その人がその段に居るときだけ出す。
                    出す条件は一覧と同じ行から来ている ―― 一覧に居ない人の
                    採点欄は出ない（母集団の一致。CLAUDE.md）。 */}
                {sheet && (
                  <>
                    {(savedScore || savedDecide) && (
                      <>
                        {savedScore && (
                          <p className={`callout${savedScore === 'saved' ? ' ok' : ''}`}>
                            {SAVE_SCORE_CODE_MESSAGE[savedScore]}
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
                      context={{
                        seasonId: season.id,
                        tab: tab.id,
                        personId: sheet.person_id,
                        week: monday,
                      }}
                    />
                  </>
                )}

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
                </div>
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
              <WeekCalendar
                monday={monday} appointments={appointments} today={today}
                hrefFor={(id) => hereHref({ appt: id })}
              />
            )}
          </section>
        </div>
      </div>

      {/* --- メモ（実行⑪。依頼者の指示）--- */}
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

      {/* --- 予定の参加者（実行⑪。依頼者の指示）--- */}
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

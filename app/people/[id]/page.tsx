import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getDb } from '../../../src/db/server.ts'
import { ACTIVE_WINDOW_DAYS } from '../../../src/queries/dashboard.ts'
import {
  getPerson, getPersonSeasonStates, getPersonApplications, getPersonTouchpoints,
  OUTCOME_LABEL,
} from '../../../src/queries/drilldown.ts'
import { listPersonInterviews } from '../../../src/queries/interview.ts'
import { listNoteHistory } from '../../../src/queries/intake.ts'
import { RECOMMENDATION_LABEL } from '../../../src/commands/interview.ts'
import {
  Card, Kpi, Empty, LevelBadge, num, ymd, jstDay, jstDateTime, filled,
} from '../../_components/ui.tsx'
import { Shell, Breadcrumb } from '../../_components/shell.tsx'

export const dynamic = 'force-dynamic'

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const db = await getDb()
  const { id } = await params

  const person = await getPerson(db, id)
  // 知らない id・壊れた id・個人情報削除済みは、すべて「無い」で返す。
  // 削除済みだけ別の応答にすると、その差が「その人は存在した」を漏らす。
  if (!person) notFound()

  const [states, applications, touchpoints, interviews, noteHistory] = await Promise.all([
    getPersonSeasonStates(db, person.person_id),
    getPersonApplications(db, person.person_id),
    getPersonTouchpoints(db, person.person_id),
    // 詳細画面から面接画面へ行くための入口（依頼者の指示。実行⑩）。
    // 期で絞らない ―― 再応募した人の前年度の面接も、ここから開ける。
    listPersonInterviews(db, person.person_id),
    // 担当者メモの履歴（C-177。依頼者の指示）。記録層は前から持っていた。
    listNoteHistory(db, person.person_id),
  ])

  const kana = [person.family_name_kana, person.given_name_kana].filter(Boolean).join(' ')

  return (
    <Shell active="headhunting">
      {/* 年度を持たない画面。この人の記録は年度をまたぐので、根に年度を置けない。 */}
      <Breadcrumb
        crumbs={[
          { label: '特別選考', href: '/headhunting' },
          { label: '人を探す', href: '/people' },
          { label: `${person.family_name} ${person.given_name}` },
        ]}
      />

      <div className="page-head">
        <div>
          <h1 className="page-title">
            {person.family_name} {person.given_name}
          </h1>
          <p className="page-sub">
            {kana && <>{kana} ・ </>}
            {person.school_name}
            {person.faculty && <> {person.faculty}</>}
            {person.birth_date && <>{' ・ '}{ymd(person.birth_date)} 生</>}
            {person.staff_display_name && (
              <span className="badge-tag-purple" style={{ marginLeft: 8 }}>
                スタッフ {person.staff_display_name}
              </span>
            )}
          </p>
        </div>
        {/* 編集フォーム（深い層）へ直接行く。実行⑩で編集を深い層へ移したとき、
            このボタンだけ古い行き先（/headhunting?person=…）のまま残っていて、
            押しても編集できなかった。行き先を編集ページに正す（実行⑪）。 */}
        <Link className="button button-secondary" href={`/people/${person.person_id}/edit`}>
          基本情報を編集
        </Link>
      </div>

      <div className="grid grid-kpi">
        <Kpi label="応募（生涯）" value={num(person.application_count)}
             tone={person.application_count ? undefined : 'muted'}
             meta={person.has_ever_been_accepted ? '合格したことがある' : '合格歴なし'} />
        <Kpi label="接点" value={num(person.touchpoint_count)}
             meta={`最終接触 ${jstDay(person.last_touch_at)}`} />
        <Kpi label="識別された日" value={jstDay(person.identified_at)}
             meta="登録日" />
        <Kpi label="この人が紹介した人" value={num(person.referred_count)}
             tone={person.referred_count ? undefined : 'muted'}
             meta="人" />
      </div>


      <div className="section grid grid-2">
        <Card title="連絡先と紐づき">
          <table className="data">
            <tbody>
              <tr><td>メール</td><td className="mono">{person.email}</td></tr>
              <tr><td>電話</td><td className="mono">{filled(person.phone)}</td></tr>
              <tr><td>LINE</td><td className="mono">{filled(person.line_user_id)}</td></tr>
              <tr>
                <td>紹介者</td>
                <td>
                  {person.referrer_person_id
                    ? (person.referrer_name
                        ? <Link href={`/people/${person.referrer_person_id}`}>{person.referrer_name}</Link>
                        : <span className="section-note">削除済みの Person</span>)
                    : '—'}
                </td>
              </tr>
              <tr>
                <td>個人情報の扱い</td>
                <td>
                  {person.anonymized_at
                    ? <span className="badge-tag-orange">匿名化済み {jstDay(person.anonymized_at)}</span>
                    : <span className="section-note">通常</span>}
                </td>
              </tr>
            </tbody>
          </table>
          {person.note && <p className="unit-note">{person.note}</p>}

          {/* ★ 担当者メモの履歴（依頼者の指示。実行⑰。C-177）――
              「このメモは蓄積していって、過去のものまで見れるように」。
              いちばん上が現在のメモなので、**2件目から**を過去として出す。
              1件しか無い（＝一度も書き換えていない）ときは何も出さない。 */}
          {noteHistory.length > 1 && (
            <details className="note-history">
              <summary>担当者メモの履歴（{num(noteHistory.length - 1)} 件）</summary>
              <ul className="note-history-list">
                {noteHistory.slice(1).map((h) => (
                  <li key={h.revision_number}>
                    <span className="section-note">{jstDay(h.changed_at)}</span>
                    {/* 消したことも履歴である。空欄を「無かった」ことにしない。 */}
                    <span className={h.note ? '' : 'section-note'}>
                      {h.note ?? '（メモを消した）'}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Card>

        <Card title="年度ごとの現在地">
          {states.length === 0 ? <Empty>どの年度の母集団にも入っていない</Empty> : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>年度</th>
                    <th>段</th>
                    <th className="num">応募</th>
                    <th>基準日</th>
                    <th>基準日までの最終接触</th>
                  </tr>
                </thead>
                <tbody>
                  {states.map((s) => (
                    <tr key={s.season_id}>
                      <td className="nowrap">{s.enrollment_year} 年度</td>
                      <td><LevelBadge level={s.current_level} inWindow={s.in_active_window} /></td>
                      <td className="num">{num(s.application_count)}</td>
                      <td className="nowrap">{ymd(s.as_of)}</td>
                      <td className="nowrap">{jstDay(s.last_touch_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="section">
        <Card
          title="応募"
        >
          {applications.length === 0 ? <Empty>応募したことがない</Empty> : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>年度</th>
                    <th>提出</th>
                    <th>結果</th>
                    <th>集計</th>
                    <th className="num">評価</th>
                    <th className="num">遷移</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {applications.map((a) => (
                    <tr key={a.application_id}>
                      <td className="nowrap">
                        {a.enrollment_year} 年度
                        {a.is_reapplication && (
                          <span className="badge-tag-purple" style={{ marginLeft: 6 }}>再応募</span>
                        )}
                      </td>
                      <td className="nowrap">{jstDateTime(a.submitted_at)}</td>
                      <td>
                        {/* 結末の定義は v_application_outcome。応募の画面と同じ値を出す。
                            画面ごとにラダーを書くと、同じ応募の結末が食い違う（A-14）。 */}
                        <span className={OUTCOME_LABEL[a.outcome].cls}>
                          {OUTCOME_LABEL[a.outcome].label}
                        </span>
                      </td>
                      <td>
                        {a.is_countable
                          ? (a.is_voided
                              ? <span className="badge-tag-orange">数える（無効化済み）</span>
                              : <span className="section-note">数える</span>)
                          : <span className="badge-tag-gray">数えない</span>}
                        {a.void_reason_label && (
                          <div className="section-note">{a.void_reason_label}</div>
                        )}
                      </td>
                      <td className="num">{num(a.evaluation_count)}</td>
                      <td className="num">{num(a.history_count)}</td>
                      <td>
                        <Link href={`/applications/${a.application_id}`}>評価と履歴</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* 面接（実行⑩）。**詳細画面から面接画面へ行く入口はここ。**
          特別選考・通常選考・名前検索、どこから来ても
          氏名を押せばこの画面に着き、ここから面接シートを開く。 */}
      <div className="section">
        <Card title="面接">
          {interviews.length === 0 ? <Empty>面接がまだ生成されていない</Empty> : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>期</th>
                    <th>段</th>
                    <th>面接官</th>
                    <th>面接日</th>
                    <th className="num">点</th>
                    <th>所見</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {interviews.map((iv) => (
                    <tr key={iv.evaluation_id}>
                      <td className="nowrap">
                        {iv.cohort_number !== null
                          ? `${iv.cohort_number}期` : `${iv.enrollment_year}年度`}
                      </td>
                      <td className="nowrap">
                        {iv.step_name}
                        {iv.attempt > 1 && (
                          <span className="badge-tag-purple" style={{ marginLeft: 6 }}>
                            {iv.attempt} 回目
                          </span>
                        )}
                      </td>
                      <td>{iv.interviewer_name ?? (
                        <span className="badge-tag-orange">未割当</span>
                      )}</td>
                      <td className="nowrap">
                        {iv.interviewed_on ? jstDay(iv.interviewed_on) : '—'}
                      </td>
                      <td className="num">
                        {num(iv.scored_criteria)}
                        <span className="section-note"> / {num(iv.total_criteria)}</span>
                      </td>
                      <td>
                        {iv.recommendation
                          ? RECOMMENDATION_LABEL[
                            iv.recommendation as keyof typeof RECOMMENDATION_LABEL]
                          : <span className="section-note">—</span>}
                      </td>
                      <td>
                        <Link href={`/interviews/${iv.evaluation_id}`}>
                          {iv.has_sheet ? '面接シート' : '面接シートを書く'}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="section">
        <Card title="接点">
          {touchpoints.length === 0 ? <Empty>接点が記録されていない</Empty> : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>日時</th>
                    <th>チャネル</th>
                    <th>団体</th>
                    <th>年度</th>
                    <th>申込 / 参加</th>
                  </tr>
                </thead>
                <tbody>
                  {touchpoints.map((t) => (
                    <tr key={t.touchpoint_id}>
                      <td className="nowrap">{jstDateTime(t.occurred_at)}</td>
                      <td>
                        {t.channel}
                        {t.is_scout && (
                          <span className="badge-tag-purple" style={{ marginLeft: 6 }}>スカウト</span>
                        )}
                        {t.is_self_reported && (
                          <span className="badge-tag-gray" style={{ marginLeft: 6 }}>自己申告</span>
                        )}
                      </td>
                      <td>{t.partner_name ?? '—'}</td>
                      <td className="nowrap">
                        {t.enrollment_year
                          ? `${t.enrollment_year} 年度`
                          : <span className="badge-tag-gray">未割当</span>}
                      </td>
                      <td className="nowrap">
                        {t.applied_at ? jstDay(t.applied_at) : '—'}
                        {' / '}
                        {t.attended_at
                          ? jstDay(t.attended_at)
                          : t.applied_at
                            ? <span className="badge-tag-orange">不参加</span>
                            : '—'}
                      </td>
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

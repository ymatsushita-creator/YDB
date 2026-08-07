import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getDb } from '../../../src/db/server.ts'
import { ACTIVE_WINDOW_DAYS } from '../../../src/queries/dashboard.ts'
import {
  getPerson, getPersonSeasonStates, getPersonApplications, getPersonTouchpoints,
  OUTCOME_LABEL,
} from '../../../src/queries/drilldown.ts'
import {
  Card, Kpi, Empty, LevelBadge, num, ymd, jstDay, jstDateTime,
} from '../../_components/ui.tsx'

export const dynamic = 'force-dynamic'

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const db = await getDb()
  const { id } = await params

  const person = await getPerson(db, id)
  // 知らない id・壊れた id・個人情報削除済みは、すべて「無い」で返す。
  // 削除済みだけ別の応答にすると、その差が「その人は存在した」を漏らす。
  if (!person) notFound()

  const [states, applications, touchpoints] = await Promise.all([
    getPersonSeasonStates(db, person.person_id),
    getPersonApplications(db, person.person_id),
    getPersonTouchpoints(db, person.person_id),
  ])

  const kana = [person.family_name_kana, person.given_name_kana].filter(Boolean).join(' ')

  return (
    <>
      <div className="page-head">
        <div>
          <p className="page-sub">
            <Link href="/people">人を探す</Link> ／ 個人
          </p>
          <h1 className="page-title">
            {person.family_name} {person.given_name}
          </h1>
          <p className="page-sub">
            {kana && <>{kana} ・ </>}
            {person.school_name}
            {person.faculty && <> {person.faculty}</>}
            {' ・ '}{ymd(person.birth_date)} 生
            {person.staff_display_name && (
              <span className="badge-tag-purple" style={{ marginLeft: 8 }}>
                スタッフ {person.staff_display_name}
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="grid grid-kpi">
        <Kpi label="応募（生涯）" value={num(person.application_count)}
             tone={person.application_count ? undefined : 'muted'}
             meta={person.has_ever_been_accepted ? '合格したことがある' : '合格歴なし'} />
        <Kpi label="接点" value={num(person.touchpoint_count)}
             meta={`最終接触 ${jstDay(person.last_touch_at)}`} />
        <Kpi label="識別された日" value={jstDay(person.identified_at)}
             meta="林に入った日。persons.created_at" />
        <Kpi label="この人が紹介した人" value={num(person.referred_count)}
             tone={person.referred_count ? undefined : 'muted'}
             meta="紹介チャネルの検証に使う" />
      </div>

      <div className="section grid grid-2">
        <Card title="連絡先と紐づき" note="運用のための情報。集計には使わない">
          <table className="data">
            <tbody>
              <tr><td>メール</td><td className="mono">{person.email}</td></tr>
              <tr><td>電話</td><td className="mono">{person.phone ?? '—'}</td></tr>
              <tr><td>LINE</td><td className="mono">{person.line_user_id ?? '—'}</td></tr>
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
        </Card>

        <Card title="年度ごとの現在地" note="段は年度内の最高到達点。窓は接点の鮮度">
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
          <p className="unit-note">
            「林 休眠」は、その年度に応募しておらず、基準日から遡って
            {' '}{ACTIVE_WINDOW_DAYS} 日以内に接点も無い状態。年度サマリの林には
            数えられていない。段（林・木・幹）と窓は別の軸なので、
            木や幹でも接点が続いていれば林に数えられている。
          </p>
        </Card>
      </div>

      <div className="section">
        <Card
          title="応募"
          note="無効化されたものも出す。集計に数えるかどうかは別の列で示す"
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
          <p className="unit-note">
            無効化された応募は、理由の <code>counts_as_application</code> によって
            木に数えるかどうかが決まる（名寄せ誤りは数えない、取り下げは数える）。
            数えない応募も、そこにぶら下がった評価と遷移は記録層に残っているので、
            個別の画面からは消さない。集計の都合で事実を隠さないため。
          </p>
        </Card>
      </div>

      <div className="section">
        <Card title="接点" note="集客の経緯そのもの。年度帰属は接点の日付から都度判定する">
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
          <p className="unit-note">
            「未割当」は、どの年度の期間にも入らない接点。集計から落とすだけだと
            チャネル別の人数が実際の接点数に届かない理由が画面に出ないので、
            (4)流入元でも件数として出している。
          </p>
        </Card>
      </div>

      <p className="footnote">
        表示している日時はすべて運用タイムゾーン（Asia/Tokyo）。
        集計の日付境界も同じタイムゾーンで揃えており、表示側とずれない。
        年度の段と接点の鮮度は、直近 {ACTIVE_WINDOW_DAYS} 日以内に接点があるかで集計側が決めており、
        画面側では数え直していない。
      </p>
    </>
  )
}

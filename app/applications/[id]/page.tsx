import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getDb } from '../../../src/db/server.ts'
import {
  getApplication, getApplicationTimeline, getApplicationEvaluations, OUTCOME_LABEL,
} from '../../../src/queries/drilldown.ts'
import { Card, Empty, num, jstDateTime } from '../../_components/ui.tsx'

export const dynamic = 'force-dynamic'

const TRANSITION: Record<string, string> = {
  advance: '通過',
  reject: '不合格',
  withdraw: '辞退',
  revert: '差し戻し',
}

const STATE: Record<string, string> = {
  pending: '判断待ち',
  submitted: '提出済み',
  held: '保留',
}

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const db = await getDb()
  const { id } = await params

  const app = await getApplication(db, id)
  if (!app) notFound()

  const [timeline, evaluations] = await Promise.all([
    getApplicationTimeline(db, app.application_id),
    getApplicationEvaluations(db, app.application_id),
  ])

  // 結末は v_application_outcome（0011）が決める。画面では組み立てない。
  // 「数える／数えない」は結末とは別の軸なので、別のバッジで出す。
  const result = OUTCOME_LABEL[app.outcome]

  return (
    <>
      <div className="page-head">
        <div>
          <p className="page-sub">
            <Link href="/people">人を探す</Link> ／{' '}
            <Link href={`/people/${app.person_id}`}>{app.applicant_name}</Link> ／ 応募
          </p>
          <h1 className="page-title">
            {app.enrollment_year} 年度の応募
          </h1>
          <p className="page-sub">
            {app.applicant_name}（{app.school_name}）・
            {jstDateTime(app.submitted_at)} 提出
            {app.is_reapplication && (
              <span className="badge-tag-purple" style={{ marginLeft: 8 }}>再応募</span>
            )}
            <span className={result.cls} style={{ marginLeft: 8 }}>{result.label}</span>
            {/* 結末と、木に数えるかは別の軸。1つのバッジに畳むと片方が消える。 */}
            {!app.is_countable && (
              <span className="badge-tag-gray" style={{ marginLeft: 6 }}>集計対象外</span>
            )}
          </p>
        </div>
      </div>

      {app.is_voided && (
        <div className="section">
          <p className="callout">
            この応募は {jstDateTime(app.voided_at)} に無効化されている
            （{app.void_reason_label ?? '理由未記録'}）。
            {app.is_countable
              ? '無効化理由に代替の応募が生まれないため、応募が起きた事実として木には数える。'
              : '無効化理由に代替の応募が生まれるため、木には数えない。'
                + ' 下の評価と遷移は記録層に残っているものをそのまま出している。'}
          </p>
        </div>
      )}

      <div className="section">
        <Card
          title="状態遷移の履歴"
          note="訂正で打ち消された記録も残す。結論ではなく経緯が答えになる"
        >
          {timeline.length === 0 ? <Empty>まだ遷移が記録されていない</Empty> : (
            <div className="timeline">
              {timeline.map((h) => (
                <div className="timeline-row" key={h.history_id}>
                  <div className="nowrap section-note">{jstDateTime(h.occurred_at)}</div>
                  <div className="timeline-rail">
                    <span className={h.is_effective ? 'timeline-dot on' : 'timeline-dot'} />
                  </div>
                  <div>
                    <div className={h.is_effective ? undefined : 'struck'}>
                      <strong>{TRANSITION[h.transition_type] ?? h.transition_type}</strong>
                      {h.step_name && <> ・ {h.step_order}. {h.step_name}</>}
                      {h.withdraw_reason_label && <> ・ {h.withdraw_reason_label}</>}
                      {' ・ '}<span className="section-note">{h.changed_by}</span>
                    </div>
                    {h.note && <div className="section-note">{h.note}</div>}
                    {h.is_correction && (
                      <div className="section-note">
                        <span className="badge-tag-purple">訂正</span>{' '}
                        前の記録を打ち消して記録し直したもの
                      </div>
                    )}
                    {h.corrected_by_history_id && (
                      <div className="section-note">
                        {h.is_effective
                          ? 'この記録は一度打ち消されたが、その訂正がさらに訂正されたため有効に戻っている'
                          : 'この記録は後の訂正で打ち消されている'}
                      </div>
                    )}
                    {!h.step_name && h.transition_type !== 'advance' && (
                      <div className="section-note">
                        ステップの記録なし（<code>reject</code> と <code>withdraw</code> は
                        選考ステップを持たない）
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="unit-note">
            訂正は打ち消しの追記で表現し、元の記録は残す（設計原則5）。
            訂正をさらに訂正すると元が有効に戻るため、
            「訂正された＝無効」ではない。いま有効かどうかは左の点で示している
            （塗りが有効）。この解決は <code>v_effective_status_histories</code> が行っており、
            画面側では判定していない。
            {' '}「幹（合格）」の定義は最終ステップ「{app.final_step_name}」への有効な通過。
          </p>
        </Card>
      </div>

      <div className="section">
        <Card
          title="評価"
          note="誰が、どのステップで、何を根拠に判断したか"
        >
          {evaluations.length === 0 ? <Empty>まだ評価が生成されていない</Empty> : (
            <div className="stack" style={{ gap: 'var(--space-md)' }}>
              {evaluations.map((e) => (
                <div className="card-base" key={e.evaluation_id}>
                  <div className="row-between" style={{ flexWrap: 'wrap' }}>
                    <div>
                      <strong>{e.step_order}. {e.step_name}</strong>
                      {e.attempt > 1 && (
                        <span className="badge-tag-purple" style={{ marginLeft: 6 }}>
                          {e.attempt} 回目
                        </span>
                      )}
                      {' ・ '}
                      {e.interviewer ?? <span className="badge-tag-orange">担当未割当</span>}
                      {e.conflict_type && (
                        <span className="badge-tag-orange" style={{ marginLeft: 6 }}>
                          利益相反（{e.conflict_type === 'self' ? '本人' : '紹介者'}）
                        </span>
                      )}
                    </div>
                    <div className="section-note nowrap">
                      {STATE[e.state] ?? e.state}
                      {' ・ 割当 '}{jstDateTime(e.assigned_at)}
                      {e.submitted_at && <> ・ 提出 {jstDateTime(e.submitted_at)}</>}
                    </div>
                  </div>

                  {/* 保留を解いても hold_reason は消していない（C-21）。
                      制約は「保留なら理由が要る」であって「保留でなければ
                      持てない」ではないため、解除後も残せる。
                      ただしラベルを「保留」のままにすると、いま止まって
                      いるように読める。state で呼び分ける。 */}
                  {e.hold_reason && (
                    <p className={`callout${e.state === 'held' ? '' : ' ok'}`}
                       style={{ marginTop: 'var(--space-sm)' }}>
                      {e.state === 'held' ? '保留：' : '保留を解いた（理由）：'}
                      {e.hold_reason}
                    </p>
                  )}
                  {e.handover_note && (
                    <p className="unit-note">申し送り：{e.handover_note}</p>
                  )}

                  {/* E1: 何を評価するのかを出す。
                      かつては「判断がまだ下りていないため、点も根拠も無い」と
                      しか出しておらず、運転席が「評価する」と言っている相手に
                      ついて**何を見るのかがどこにも無かった**。
                      点の入力そのものは次のサイクル（E2）。 */}
                  {e.pending_criteria.length > 0 && (
                    <div style={{ marginTop: 'var(--space-sm)' }}>
                      <p className="section-note">
                        これから点と根拠を付ける軸（{e.pending_criteria.length} 件）
                      </p>
                      <ul className="criteria-list">
                        {e.pending_criteria.map((c) => (
                          <li key={c.criteria_name} className="criteria-row">
                            <span>{c.criteria_name}</span>
                            <span className="section-note">
                              {c.scale_max} 点満点
                              {c.applies_to === 'reapplicant_only' && ' ・ 再応募者のみ'}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {e.scores.length === 0 ? (
                    <p className="section-note" style={{ marginTop: 'var(--space-sm)' }}>
                      {e.pending_criteria.length > 0
                        ? '点はまだ1つも付いていない。根拠は必須なので、空では保存できない'
                        : '判断がまだ下りていないため、点も根拠も無い'}
                    </p>
                  ) : (
                    <div className="table-wrap" style={{ marginTop: 'var(--space-sm)' }}>
                      <table className="data">
                        <thead>
                          <tr>
                            <th>評価軸</th>
                            <th className="num">点</th>
                            <th>根拠エピソード</th>
                          </tr>
                        </thead>
                        <tbody>
                          {e.scores.map((s) => (
                            <tr key={s.criteria_name}>
                              <td className="nowrap">
                                {s.criteria_name}
                                {s.applies_to === 'reapplicant_only' && (
                                  <span className="badge-tag-purple" style={{ marginLeft: 6 }}>
                                    再応募のみ
                                  </span>
                                )}
                              </td>
                              <td className="num">
                                {num(s.score)}
                                <span className="section-note"> / {num(s.scale_max)}</span>
                              </td>
                              <td>{s.rationale}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <p className="unit-note">
            根拠エピソードは必須（資料5-3）。空白だけの入力も制約で弾いている。
            点だけが残って理由が残らない評価は、後から誰も説明できない。
            判断待ち・保留の評価も落とさずに出す。判断が下りていないことも事実で、
            落とすと「いま誰の判断待ちか」がこの画面から消える。
          </p>
        </Card>
      </div>

      <p className="footnote">
        この画面は集計ではないので、無効化された応募も個人情報削除の対象外なら表示する。
        逆に個人情報削除（<code>deleted_at</code>）を受けた Person の応募は、
        集計からもこの画面からも外れる。
        <code>form_response_id</code>{': '}
        <code>{app.form_response_id ?? '（取り込み経由ではない）'}</code>
      </p>
    </>
  )
}

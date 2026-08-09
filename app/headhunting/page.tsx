import Link from 'next/link'
import { getDb } from '../../src/db/server.ts'
import { listSeasons, getSeason } from '../../src/queries/dashboard.ts'
import {
  listHeadhunting, getApproachTotals, listConfidence, getConfidenceMeta,
  listApplicantScores, getPersonPanel, listCriterionScores, listHeadhuntingTasks,
  getProfileEditOptions,
} from '../../src/queries/headhunting.ts'
import { jstDay, num, ymd, filled, NotDerived } from '../_components/ui.tsx'
import {
  ApproachChip, RankMark, RankDelta, Stars, Confidence, taskSentence,
} from '../_components/headhunting.tsx'
import { updateProfileAction, updateApproachAction } from './actions.ts'
import { Shell, Breadcrumb, YearSwitch, seasonLabel } from '../_components/shell.tsx'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

/**
 * ヘッドハンティング（実行⑨）。
 *
 * 依頼者から届いた画面画像の構造をそのまま作る。
 * 画像に描かれていて記録層に事実が無いものは、**作らずに、無いと書く。**
 * 画面の下に「画像にあって、まだ出せないもの」を一覧で置いてある。
 * 黙って省くと、次に触る人が「実装漏れ」と読んで作り直しにかかる。
 */
export default async function HeadhuntingPage({
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
      <Shell active="headhunting">
        <div className="hh-empty-shell">
        <p>年度が1件も登録されていない。ヘッドハンティングは年度ごとに動くため、
            年度が無いと対象者を置く場所が決まらない。</p>
        </div>
      </Shell>
    )
  }

  const [tasks, scores, confidence, confidenceMeta, list, totals] = await Promise.all([
    listHeadhuntingTasks(db, season.id),
    listApplicantScores(db, season.id),
    listConfidence(db, season.id),
    getConfidenceMeta(db, season.id),
    listHeadhunting(db, season.id),
    getApproachTotals(db, season.id),
  ])

  // 右のパネルに映す1人。指定が無ければ確度の1位。
  // 一覧が空なら誰も映らない。**空を埋めるために別の年度から連れてこない。**
  const requested = one(sp.person)
  const personId = requested && UUID.test(requested)
    ? requested
    : (list[0]?.person_id ?? null)

  const [panel, criteria, editOptions] = personId
    ? await Promise.all([
      getPersonPanel(db, personId, season.id),
      listCriterionScores(db, personId, season.id),
      getProfileEditOptions(db, personId),
    ])
    : [null, [], null]

  const editResult = one(sp.edit)
  const editMessage = editResult === 'saved' ? 'プロフィールを保存しました。'
    : editResult === 'approach_saved' ? 'アプローチ状態を記録しました。'
      : editResult ? '保存できませんでした。入力内容を確認してください。' : null

  const href = (q: Record<string, string>) =>
    `/headhunting?${new URLSearchParams({ season: season.id, ...q })}`

  return (
    <Shell active="headhunting" years={<YearSwitch seasons={seasons} currentId={season.id} basePath="/headhunting" />}>
      <Breadcrumb
        root={seasonLabel(season)}
        crumbs={[
          { label: 'ヘッドハンティング', href: '/headhunting' },
          ...(panel ? [{ label: panel.person_name }] : []),
        ]}
      />

      <div className="hh-grid">
        <div className="hh-col-main">
          {/* --- C 最新やること --- */}
          <section className="panel-card">
            <header className="hh-head">
              <h2>最新やること</h2>
              <Link href="/borderline" className="hh-more">すべて見る ›</Link>
            </header>
            {tasks.length === 0 ? (
              <p className="hh-empty">いま判断待ちのものは無い。</p>
            ) : (
              <ul className="hh-tasks">
                {tasks.map((t) => (
                  <li key={t.source_id} className="task-card">
                    <span className={t.is_overdue ? 'chip-amber' : 'chip-blue'}>
                      {t.is_overdue ? '期限超過' : '要対応'}
                    </span>
                    <p className="task-title">
                      {taskSentence(t.kind, t.person_name, t.step_name)}
                    </p>
                    <p className="task-meta">
                      {t.waiting_days} 日待ち
                      {t.sla_days !== null && <> ・ 目安 {t.sla_days} 日</>}
                      {t.owner ? <> ・ 担当 {t.owner}</> : <> ・ 担当未割当</>}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <p className="hh-note">単位は件。母集団はこの期で動いている応募。</p>
          </section>

          <div className="hh-rankings">
            {/* --- D 応募者成績ランキング --- */}
            <section className="panel-card">
              <header className="hh-head">
                <h2>応募者成績ランキング</h2>
                <Link href={`/operations?season=${season.id}`} className="hh-more">すべて見る ›</Link>
              </header>
              {scores.length === 0 ? (
                <p className="hh-empty">提出済みの評価がまだ無い。</p>
              ) : (
                <div className="scroll-pane">
                  <table className="hh-table">
                    <thead>
                      <tr>
                        <th>順位</th><th>名前</th>
                        <th className="num">100点換算</th>
                        <th className="num">素点</th>
                        <th className="num">軸</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scores.map((r) => (
                        <tr key={r.application_id}>
                          <td><RankMark rank={Number(r.rank_in_season)} /></td>
                          <td>
                            <Link href={`/people/${r.person_id}?season=${season.id}`}>
                              {r.person_name}
                            </Link>
                          </td>
                          <td className="num strong">{r.score_100 ?? <NotDerived />}</td>
                          <td className="num dim">{r.earned} / {r.possible}</td>
                          <td className="num dim">{r.scored_criteria}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="hh-note">
                単位は点。母集団は評価が1件以上ある応募。
                分母は<strong>実際に受けた軸の満点</strong>。
                「軸」は点が付いた軸の数で、少ないほど根拠は薄い。
              </p>
            </section>

            {/* --- E 候補者確度ランキング --- */}
            <section className="panel-card">
              <header className="hh-head">
                <h2>候補者確度ランキング</h2>
              </header>
              {confidence.length === 0 ? (
                <p className="hh-empty">
                  確度がまだ算出されていない。算出の規則（どの事実に何点を付けるか）が
                  登録されていないため、順位を出す根拠が無い。
                </p>
              ) : (
                <div className="scroll-pane">
                  <table className="hh-table">
                    <thead>
                      <tr><th>順位</th><th>名前</th><th className="num">確度</th><th>前回比</th></tr>
                    </thead>
                    <tbody>
                      {confidence.map((r) => (
                        <tr key={r.person_id}>
                          <td><RankMark rank={Number(r.rank_in_season)} /></td>
                          <td>
                            <Link href={href({ person: r.person_id })}>{r.person_name}</Link>
                          </td>
                          <td className="num strong"><Confidence ratio={r.confidence_ratio} /></td>
                          <td>
                            <RankDelta delta={r.rank_delta} hasPrevious={r.has_previous_run} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {confidenceMeta && (
                <p className="hh-note">
                  {jstDay(confidenceMeta.calculated_on)} 時点の値。
                  母集団は対象者 {num(confidenceMeta.population)} 人。
                  満点 {num(confidenceMeta.max_points)} 点に対する割合で、
                  <strong>合格率でも内定確率でもない</strong>。
                </p>
              )}
            </section>
          </div>
        </div>

        <div className="hh-col-side">
          {/* --- F 候補者パネル --- */}
          <section className="panel-card">
            {editMessage && (
              <p className={editResult === 'saved' || editResult === 'approach_saved' ? 'edit-result ok' : 'edit-result error'}>
                {editMessage}
              </p>
            )}
            {!panel ? (
              <p className="hh-empty">対象者がまだ1人も居ない。</p>
            ) : (
              <>
                <header className="hh-person-head">
                  <div className="hh-person-identity">
                    {panel.photo_data_url
                      ? <img className="hh-photo" src={panel.photo_data_url} alt={`${panel.person_name}さんの顔写真`} />
                      : <span className="hh-photo-placeholder" aria-label="顔写真未設定">
                          {panel.family_name.slice(0, 1)}{panel.given_name.slice(0, 1)}
                        </span>}
                    <div>
                      <h2 className="hh-person-name">{panel.person_name}</h2>
                      {panel.person_kana && <p className="hh-person-kana">{panel.person_kana}</p>}
                    </div>
                  </div>
                  {panel.approach_code && panel.approach_label && (
                    <ApproachChip code={panel.approach_code} label={panel.approach_label} />
                  )}
                </header>

                <div className="scroll-pane">
                <h3 className="hh-sub">基本情報</h3>
                <dl className="hh-facts">
                  <dt>生年月日</dt><dd>{ymd(panel.birth_date)}</dd>
                  <dt>学校</dt><dd>{panel.school}</dd>
                  <dt>学部・学科</dt><dd>{filled(panel.faculty)}</dd>
                  <dt>メール</dt><dd>{panel.email}</dd>
                  <dt>電話番号</dt><dd>{filled(panel.phone)}</dd>
                  <dt>LINE ID</dt><dd>{filled(panel.line_user_id)}</dd>
                  <dt>最後の接点</dt><dd>{panel.last_touchpoint_on ? jstDay(panel.last_touchpoint_on) : 'この年度は接点なし'}</dd>
                </dl>

                <h3 className="hh-sub">評価サマリー</h3>
                {criteria.length === 0 ? (
                  <p className="hh-empty">提出済みの評価がまだ無い。</p>
                ) : (
                  <ul className="hh-criteria">
                    {criteria.map((c, i) => (
                      <li key={`${c.step_name}-${c.criteria_name}-${i}`}>
                        <span className="hh-criteria-name">{c.criteria_name}</span>
                        <Stars score={c.score} scaleMax={c.scale_max} />
                        <span className="hh-criteria-raw">{c.score} / {c.scale_max}</span>
                      </li>
                    ))}
                  </ul>
                )}

                <dl className="hh-facts hh-facts-tight">
                  <dt>成績（100点換算）</dt>
                  <dd>{panel.score_100 ?? <NotDerived>評価がまだ無い</NotDerived>}</dd>
                  <dt>確度</dt>
                  <dd>
                    <Confidence ratio={panel.confidence_ratio} />
                    {panel.rank_in_season !== null && <> ・ {panel.rank_in_season} 位</>}
                  </dd>
                </dl>

                {panel.note && (
                  <>
                    <h3 className="hh-sub">メモ</h3>
                    <p className="hh-memo">{panel.note}</p>
                  </>
                )}

                <Link href={`/people/${panel.person_id}?season=${season.id}`} className="hh-more">
                  この人の全体を見る ›
                </Link>

                {editOptions && (
                  <>
                    <details className="edit-disclosure">
                      <summary className="btn-physical">基本情報・顔写真を編集</summary>
                      <form action={updateProfileAction} className="profile-edit-form editable-region">
                        <input type="hidden" name="personId" value={panel.person_id} />
                        <input type="hidden" name="seasonId" value={season.id} />
                        <div className="edit-grid two">
                          <label>姓<input name="familyName" required defaultValue={panel.family_name} /></label>
                          <label>名<input name="givenName" required defaultValue={panel.given_name} /></label>
                          <label>姓（かな）<input name="familyNameKana" defaultValue={panel.family_name_kana ?? ''} /></label>
                          <label>名（かな）<input name="givenNameKana" defaultValue={panel.given_name_kana ?? ''} /></label>
                          <label>生年月日<input name="birthDate" type="date" required defaultValue={ymd(panel.birth_date)} /></label>
                          <label>学校
                            <select name="schoolId" required defaultValue={panel.school_id}>
                              {editOptions.schools.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                            </select>
                          </label>
                          <label>学部・学科<input name="faculty" defaultValue={panel.faculty ?? ''} /></label>
                          <label>メール<input name="email" type="email" required defaultValue={panel.email} /></label>
                          <label>電話番号<input name="phone" defaultValue={panel.phone ?? ''} /></label>
                          <label>LINE ID<input name="lineUserId" defaultValue={panel.line_user_id ?? ''} /></label>
                          <label>紹介者
                            <select name="referrerPersonId" defaultValue={panel.referrer_person_id ?? ''}>
                              <option value="">なし</option>
                              {editOptions.people.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                            </select>
                          </label>
                          <label>顔写真
                            <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" />
                            <small>JPEG / PNG / WebP、2MB以下</small>
                          </label>
                        </div>
                        {panel.photo_data_url && (
                          <label className="inline-check"><input type="checkbox" name="removePhoto" value="1" /> 顔写真を削除</label>
                        )}
                        <label>担当者メモ<textarea name="note" rows={4} defaultValue={panel.note ?? ''} /></label>
                        <button className="button-primary" type="submit">変更を保存</button>
                      </form>
                    </details>

                    <details className="edit-disclosure">
                      <summary className="btn-physical">アプローチ状態を編集</summary>
                      <form action={updateApproachAction} className="profile-edit-form editable-region">
                        <input type="hidden" name="personId" value={panel.person_id} />
                        <input type="hidden" name="seasonId" value={season.id} />
                        <label>状態
                          <select name="stateId" required>
                            {editOptions.approachStates.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                          </select>
                        </label>
                        <label>記録担当者
                          <select name="staffId" required>
                            {editOptions.staffs.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                          </select>
                        </label>
                        <label>状態変更メモ<textarea name="approachNote" rows={3} /></label>
                        <button className="button-primary" type="submit">状態を記録</button>
                      </form>
                    </details>

                    <p className="hh-note">
                      成績・根拠・判定は導出値を直接書き換えず、
                      <Link href={`/people/${panel.person_id}?season=${season.id}`}>候補者の選考記録</Link>
                      から編集します。確度と順位は記録から再計算されるため編集対象ではありません。
                    </p>
                  </>
                )}
                </div>
              </>
            )}
          </section>

          {/* --- G ヘッドハンティングリスト --- */}
          <section className="panel-card">
            <header className="hh-head">
              <h2>ヘッドハンティングリスト</h2>
            </header>
            {list.length === 0 ? (
              <p className="hh-empty">
                この年度の対象者がまだ1人も登録されていない。
              </p>
            ) : (
              <ul className="hh-list">
                {list.map((r) => (
                  <li key={r.person_id} className={r.person_id === personId ? 'is-current' : ''}>
                    <Link href={href({ person: r.person_id })} className="hh-list-name">
                      {r.person_name}
                    </Link>
                    <Link href={`/people/${r.person_id}?season=${season.id}`}
                          className="row-detail" aria-label={`${r.person_name} の詳細`}>›</Link>
                    <span className="hh-list-conf"><Confidence ratio={r.confidence_ratio} /></span>
                    <ApproachChip code={r.approach_code} label={r.approach_label} />
                  </li>
                ))}
              </ul>
            )}
            {totals && (
              <p className="hh-note">
                単位は人。母集団は見送りに至っておらず、個人情報の削除依頼も
                受けていないこの年度の対象者 {num(totals.candidates)} 人。
                未アプローチ {num(totals.not_approached)} ・
                検討中 {num(totals.considering)} ・
                アプローチ中 {num(totals.approaching)} ・
                面談調整中 {num(totals.scheduling)}。
              </p>
            )}
          </section>
        </div>
      </div>
    </Shell>
  )
}

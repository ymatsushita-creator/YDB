import Link from 'next/link'
import { getDb } from '../../src/db/server.ts'
import { listSeasons, defaultSeason, getSeason } from '../../src/queries/dashboard.ts'
import {
  listHeadhunting, listApplicantScores, getPersonPanel, listCriterionScores,
} from '../../src/queries/headhunting.ts'
import { jstDay, ymd, filled, NotDerived } from '../_components/ui.tsx'
import { ApproachChip, RankMark, Stars } from '../_components/headhunting.tsx'
import { listConfidenceGrades } from '../../src/commands/confidence.ts'
import { setConfidenceAction } from './actions.ts'
import { Avatar } from '../_components/borderline.tsx'
import { Shell, Breadcrumb, YearSwitch, seasonLabel } from '../_components/shell.tsx'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

/** 一覧の上限。表示を切るためではなく、暴走を止めるための数である。 */
/**
 * 一覧の上限。**表示を切るためではなく、暴走を止めるための数である。**
 *
 * ★ 500 だと、実データ（1期で 294 人）はまだ入るが、
 *   期をまたいで積み上がれば黙って切れる。**切るなら言う**（下）。
 */
const LIST_LIMIT = 2000

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
    ?? defaultSeason(seasons)

  if (!season) {
    return (
      <Shell active="headhunting">
        <div className="hh-empty-shell">
        <p>年度が1件も登録されていない。</p>
        </div>
      </Shell>
    )
  }

  // ★ 「最新やること」は**出さない**（依頼者の指示。実行⑬で受けたが、
  //   外した先が通常選考だった ―― ここ特別選考に残っていた。C-136）。
  //   出さないものは**問い合わせもしない。**
  // ★ 「候補者確度ランキング」は**出さない**（依頼者の指示。実行⑯。C-150）。
  //   出さないものは**問い合わせもしない** ―― 確度の順位も算出規則の有無も
  //   聞かなくなったので、この画面の往復は5本から3本に減る。
  const [scores, list, grades] = await Promise.all([
    // 一覧は詰め込める分だけ出す。カードの中で送れるので、5件で切る理由が無い。
    listApplicantScores(db, season.id, LIST_LIMIT),
    listHeadhunting(db, season.id, LIST_LIMIT),
    listConfidenceGrades(db),
  ])

  // 記入の結果。**理由ごとに文言を分ける**（何が悪かったのか分からない画面にしない）。
  const CONF_ERROR: Record<string, string> = {
    nf: '相手か年度が見つからない。',
    del: '削除済みの候補者には記入できない。',
    grade: '段階が選ばれていない。',
    who: '記入者を入れる。',
    wholong: '記入者が長すぎる（60文字まで）。',
    notelong: '補足が長すぎる（2000文字まで）。',
  }
  const confError = CONF_ERROR[one(sp.e) ?? ''] ?? null

  // 右のパネルに映す1人。指定が無ければ確度の1位。
  // 一覧が空なら誰も映らない。**空を埋めるために別の年度から連れてこない。**
  const requested = one(sp.person)
  const personId = requested && UUID.test(requested)
    ? requested
    : (list[0]?.person_id ?? null)

  const [panel, criteria] = personId
    ? await Promise.all([
      getPersonPanel(db, personId, season.id),
      listCriterionScores(db, personId, season.id),
    ])
    : [null, []]

  const href = (q: Record<string, string>) =>
    `/headhunting?${new URLSearchParams({ season: season.id, ...q })}`

  return (
    <Shell active="headhunting" seasonId={season.id}
      years={<YearSwitch seasons={seasons} currentId={season.id} basePath="/headhunting" />}>
      <Breadcrumb
        root={seasonLabel(season)}
        crumbs={[
          { label: '特別選考', href: '/headhunting' },
          ...(panel ? [{ label: panel.person_name }] : []),
        ]}
      />

      <div className="hh-grid">
        <div className="hh-col-main">
          <div className="hh-rankings">
            {/* --- D 欲しい人ランキング（依頼者の指示。実行⑮。C-138）――
                 出す語は「欲しい人ランキング」。**中身は変えていない**
                 （提出済みの評価の点で並べる）。名前だけを依頼者の語に戻した。 */}
            <section className="panel-card">
              <header className="hh-head">
                <h2>欲しい人ランキング</h2>
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
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {scores.map((r) => (
                        <tr key={r.application_id}>
                          <td><RankMark rank={Number(r.rank_in_season)} /></td>
                          {/* ★ 名前は**この画面の右へ出す**（依頼者の指示。実行⑯。C-150）。
                              押すたびに人の画面へ飛ぶと、一覧へ戻る操作が要る。
                              人の画面へは**「詳細」から行く。** */}
                          <td>
                            <Link href={href({ person: r.person_id })} className="bl-person">
                              <Avatar src={r.photo_data_url} name={r.person_name} />
                              {r.person_name}
                            </Link>
                          </td>
                          <td className="num strong">{r.score_100 ?? <NotDerived />}</td>
                          <td className="num dim">{r.earned} / {r.possible}</td>
                          <td className="num dim">{r.scored_criteria}</td>
                          <td>
                            <Link href={`/people/${r.person_id}?season=${season.id}`}
                                  className="row-detail-button">詳細</Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* ★ ここに「候補者確度ランキング」があった。外した（C-150）。
                外した分の高さは、上のランキングがそのまま受け取る
                （`.hh-rankings` は枚数で割り付けが変わる。C-137）。 */}
          </div>
        </div>

        <div className="hh-col-side">
          {/* --- F 候補者パネル --- */}
          <section className="panel-card">
            {!panel ? (
              <p className="hh-empty">対象者がまだ1人も居ない。</p>
            ) : (
              <>
                <header className="hh-person-head">
                  <div className="hh-person-identity">
                    {panel.photo_data_url
                      ? <img className="hh-photo" src={panel.photo_data_url} alt={`${panel.person_name}さんの顔写真`} />
                      : <span className="hh-photo-placeholder" role="img" aria-label="顔写真未設定">
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
                  <dt>生年月日</dt><dd>{filled(ymd(panel.birth_date))}</dd>
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
                    {criteria.map((c) => (
                      <li key={`${c.step_name}-${c.criteria_name}`}>
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
                </dl>

                {/* --- 確度（S/A/B/C）――**記入するもの**（C-151）---
                     計算値ではないので、いつでも書き直せる。書き直しは
                     打ち消し行＋新しい記入で残る（0039）。 */}
                <h3 className="hh-sub">確度</h3>
                <form action={setConfidenceAction} className="conf-form editable-region">
                  <input type="hidden" name="personId" value={panel.person_id} />
                  <input type="hidden" name="seasonId" value={season.id} />
                  <div className="conf-grades">
                    {grades.map((g) => (
                      <label key={g.code}
                             className={`conf-grade${panel.grade_code === g.code ? ' is-on' : ''}`}>
                        <input type="radio" name="grade" value={g.code}
                               defaultChecked={panel.grade_code === g.code} required />
                        <span className="conf-grade-code">{g.code}</span>
                        {/* 基準は**依頼者の文面のまま**。選ぶ人がこれを見て決める。 */}
                        <span className="conf-grade-def">{g.definition}</span>
                      </label>
                    ))}
                  </div>
                  <div className="conf-row">
                    <input className="text-input" name="recordedBy" required
                           maxLength={60} placeholder="記入者"
                           defaultValue={panel.graded_by ?? ''} />
                    <input className="text-input" name="note" maxLength={2000}
                           placeholder="補足（任意）" />
                    <button className="button-primary" type="submit">記入する</button>
                  </div>
                  {panel.grade_code ? (
                    <p className="conf-current">
                      いまは <strong>{panel.grade_code}</strong>
                      {panel.graded_by && <> ・ {panel.graded_by}</>}
                      {panel.graded_at && <> ・ {jstDay(panel.graded_at)}</>}
                      {panel.grade_note && <> ・ {panel.grade_note}</>}
                    </p>
                  ) : (
                    <p className="conf-current">まだ記入されていない。</p>
                  )}
                  {confError && <p className="login-error">{confError}</p>}
                </form>

                {panel.note && (
                  <>
                    <h3 className="hh-sub">メモ</h3>
                    <p className="hh-memo">{panel.note}</p>
                  </>
                )}

                <Link href={`/people/${panel.person_id}?season=${season.id}`} className="hh-more">
                  この人の全体を見る ›
                </Link>

                {/* 編集は**深い層に出した**（依頼者の指示。実行⑩）。
                    幅 340px のパネルに12項目のフォームを畳んで入れていたが、
                    書く場所としては狭すぎるし、一覧を見ながら書くものでもない。 */}
                <Link href={`/people/${panel.person_id}/edit?season=${season.id}`}
                      className="hh-more">
                  プロフィールを編集 ›
                </Link>
                </div>
              </>
            )}
          </section>

          {/* --- G 特別選考リスト（画面の語だけ変えた。実行⑫） --- */}
          <section className="panel-card">
            <header className="hh-head">
              <h2>特別選考リスト</h2>
              <Link href={`/people/new?season=${season.id}`} className="hh-more">
                候補者を編集 ›
              </Link>
            </header>
            {list.length === 0 ? (
              <p className="hh-empty">対象者がまだ1人も居ない。</p>
            ) : (
              <ul className="hh-list">
                {list.map((r) => (
                  <li key={r.person_id} className={r.person_id === personId ? 'is-current' : ''}>
                    <Link href={href({ person: r.person_id })} className="hh-list-name bl-person">
                      <Avatar src={r.photo_data_url} name={r.person_name} />
                      {r.person_name}
                    </Link>
                    <Link href={`/people/${r.person_id}?season=${season.id}`}
                          className="row-detail-button">詳細</Link>
                    <span className="hh-list-conf">
                      {r.grade_code
                        ? <span className={`conf-mark conf-${r.grade_code}`}>{r.grade_code}</span>
                        : <span className="conf-mark conf-none">未記入</span>}
                    </span>
                    <ApproachChip code={r.approach_code} label={r.approach_label} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </Shell>
  )
}

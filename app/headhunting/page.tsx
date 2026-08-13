import Link from 'next/link'
import { getDb } from '../../src/db/server.ts'
import { listSeasons, defaultSeason, getSeason } from '../../src/queries/dashboard.ts'
import {
  listHeadhunting, getApproachTotals, listConfidence, getConfidenceMeta,
  listApplicantScores, getPersonPanel, listCriterionScores,
} from '../../src/queries/headhunting.ts'
import { jstDay, num, ymd, filled, NotDerived } from '../_components/ui.tsx'
import {
  ApproachChip, RankMark, RankDelta, Stars, Confidence,
} from '../_components/headhunting.tsx'
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
  const [scores, confidence, confidenceMeta, list, totals] = await Promise.all([
    // 一覧は詰め込める分だけ出す。カードの中で送れるので、5件で切る理由が無い。
    listApplicantScores(db, season.id, LIST_LIMIT),
    listConfidence(db, season.id, LIST_LIMIT),
    getConfidenceMeta(db, season.id),
    listHeadhunting(db, season.id, LIST_LIMIT),
    getApproachTotals(db, season.id),
  ])

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
                            <Link href={`/people/${r.person_id}?season=${season.id}`}
                                  className="bl-person">
                              <Avatar src={r.photo_data_url} name={r.person_name} />
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
            </section>

            {/* --- E 候補者確度ランキング --- */}
            <section className="panel-card">
              <header className="hh-head">
                <h2>候補者確度ランキング</h2>
              </header>
              {confidence.length === 0 ? (
                <p className="hh-empty">確度の算出規則が未登録。</p>
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
                            <Link href={href({ person: r.person_id })} className="bl-person">
                              <Avatar src={r.photo_data_url} name={r.person_name} />
                              {r.person_name}
                            </Link>
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
            </section>
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
                候補者を追加 ›
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
                          className="row-detail" aria-label={`${r.person_name} の詳細`}>›</Link>
                    <span className="hh-list-conf"><Confidence ratio={r.confidence_ratio} /></span>
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

import { APPLY_AI_LOGIC_MESSAGE } from '../../../src/commands/ai_pre_assessment.ts'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getDb } from '../../../src/db/server.ts'
import { listSeasons, defaultSeason, getSeason } from '../../../src/queries/dashboard.ts'
import {
  getBorderlinePanel, getScoringSheet, listPersonEvaluationIds,
} from '../../../src/queries/borderline.ts'
import { parseSaveScoreCode, SAVE_SCORE_CODE_MESSAGE } from '../../../src/commands/score.ts'
import { parseDecideCode, DECIDE_CODE_MESSAGE } from '../../../src/commands/decide.ts'
import { jstDay, num, filled, NotDerived } from '../../_components/ui.tsx'
import { Shell, Breadcrumb, YearSwitch, seasonLabel } from '../../_components/shell.tsx'
import { Avatar } from '../../_components/borderline.tsx'
import { currentTier } from '../../../src/auth/current.ts'
import { Confidence, ApproachChip } from '../../_components/headhunting.tsx'
import { ScoreSheet } from '../../_components/scoring.tsx'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

/**
 * 採点レイヤー（実行⑩。依頼者の指示 ――「個人名押したら採点できるレイヤー」）。
 *
 * 一覧の氏名を押すと、ここへ来る。**採点者が面接中に開く画面である。**
 *
 * ★ 段で絞らない。その期のその人の評価を**すべて**並べる。
 *   一覧のタブは「いまその段に居る応募」しか出さないが、採点する人が
 *   見たいのは候補者1人の採点用紙そのものである。前の段で何点だったかを
 *   見ずに次の段は付けられない。確定済みも落とさない。
 *
 * ★ ここでも判定は書き写していない。点を付けられるかは `v_open_tasks`、
 *   保存できるかは記録層の CHECK とトリガが決める（C-25）。
 *   一覧の右パネルと同じ `ScoreSheet` を使うので、**入口が2つでも規則は1つ。**
 *
 * ★ この画面は縦に送る。段が3本も4本もあると、比率固定では1枚が潰れる。
 *   **潰さない。並べる**（C-62）。
 */
export default async function BorderlineScorePage({
  params, searchParams,
}: {
  params: Promise<{ person: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { person } = await params
  const sp = await searchParams
  if (!UUID.test(person)) notFound()

  const db = await getDb()
  const showAi = await currentTier() === 'all'
  const seasons = await listSeasons(db)
  const season = (await getSeason(db, sp.season))
    ?? defaultSeason(seasons)
  if (!season) notFound()

  const panel = await getBorderlinePanel(db, person, season.id)
  if (!panel) notFound()

  const ids = await listPersonEvaluationIds(db, person, season.id)
  const sheets = (await Promise.all(ids.map((r) => getScoringSheet(db, r.evaluation_id))))
    .filter((s) => s !== null)

  const savedScore = parseSaveScoreCode(sp.score)
  const savedDecide = parseDecideCode(sp.decide)

  // 戻り先を持ち回る。どのタブから来たかを失うと、
  // 「戻る」が一覧の先頭に落ちて、さっきまで見ていた並びが消える。
  const tab = one(sp.tab)
  const backQuery = new URLSearchParams({ season: season.id })
  if (tab) backQuery.set('tab', tab)
  backQuery.set('person', person)
  const backHref = `/borderline?${backQuery}`

  return (
    <Shell
      active="borderline"
      seasonId={season.id}
      years={<YearSwitch seasons={seasons} currentId={season.id} basePath="/borderline" />}
    >
      <Breadcrumb
        root={seasonLabel(season)}
        crumbs={[
          { label: '通常選考', href: backHref },
          { label: panel.person_name },
        ]}
      />

      {/* ★ AIの点を入れた結果（C-211）。 */}
      {typeof sp.ai === 'string' && APPLY_AI_LOGIC_MESSAGE[sp.ai] && (
        <p className={`callout${sp.ai === 'applied' ? ' ok' : ''}`}>
          {APPLY_AI_LOGIC_MESSAGE[sp.ai]}
        </p>
      )}
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

      <div className="section">
        <section className="card-base">
          <header className="bl-person-head">
            <Avatar src={panel.photo_data_url} name={panel.person_name} />
            <div>
              <h1 className="hh-person-name">{panel.person_name}</h1>
              {panel.person_kana && <p className="hh-person-kana">{panel.person_kana}</p>}
            </div>
            <div className="bl-person-chips" style={{ marginLeft: 'auto' }}>
              <span className="chip-green"><Confidence ratio={panel.confidence_ratio} /></span>
              {panel.approach_code && panel.approach_label && (
                <ApproachChip code={panel.approach_code} label={panel.approach_label} />
              )}
            </div>
          </header>

          <dl className="hh-facts">
            <dt>学校</dt><dd>{panel.school}</dd>
            <dt>学部・学科</dt><dd>{filled(panel.faculty)}</dd>
            <dt>生年月日</dt><dd>{jstDay(panel.birth_date)}（{panel.age} 歳）</dd>
            <dt>順位</dt>
            <dd>{panel.rank_in_season !== null
              ? `${panel.rank_in_season} 位` : <NotDerived>確度がまだ無い</NotDerived>}</dd>
            <dt>成績（100点換算）</dt>
            <dd>{panel.score_100 ?? <NotDerived>評価がまだ無い</NotDerived>}</dd>
          </dl>
          {panel.note && <p className="hh-memo">{panel.note}</p>}
        </section>
      </div>

      {sheets.length === 0 ? (
        <div className="section">
          <p className="hh-empty">この期の評価がまだ無い。</p>
        </div>
      ) : (
        sheets.map((sheet) => (
          <div className="section" key={sheet.evaluation_id}>
            <section className="card-base">
              <ScoreSheet
                sheet={sheet}
                showAi={showAi}
                context={{
                  seasonId: season.id,
                  tab: tab ?? '',
                  personId: person,
                  // 打った場所へ戻す。一覧の右パネルではなく、この画面へ。
                  layer: '1',
                }}
              />
            </section>
          </div>
        ))
      )}

      <div className="section">
        <Link href={backHref} className="hh-more">‹ 一覧へ戻る</Link>
        {' 　'}
        <Link href={`/people/${person}?season=${season.id}`} className="hh-more">
          この人の記録 ›
        </Link>
      </div>
    </Shell>
  )
}

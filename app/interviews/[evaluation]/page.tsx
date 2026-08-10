import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getDb } from '../../../src/db/server.ts'
import { getInterviewSheet, listInterviewRevisions } from '../../../src/queries/interview.ts'
import { listDecidingStaff } from '../../../src/commands/decide.ts'
import {
  RECOMMENDATIONS, RECOMMENDATION_LABEL, INTERVIEW_FIELDS,
  parseSaveInterviewCode, SAVE_INTERVIEW_MESSAGE,
} from '../../../src/commands/interview.ts'
import { parseSaveScoreCode, SAVE_SCORE_CODE_MESSAGE } from '../../../src/commands/score.ts'
import { saveInterviewAction, saveInterviewScoreAction } from './actions.ts'
import { jstDay, num, jstDateTime } from '../../_components/ui.tsx'
import { Shell, Breadcrumb, seasonLabel } from '../../_components/shell.tsx'
import { Avatar } from '../../_components/borderline.tsx'

export const dynamic = 'force-dynamic'

/**
 * 面接画面（依頼者の指示。実行⑩）。様式は依頼者から届いたもの。
 *
 * ★ 1つの面接 = 1つの評価。面接官が2人なら評価が2件あり、**シートも2枚**になる。
 *   だから URL の鍵は評価の ID である。応募でも候補者でもない。
 *
 * ★ 評価軸は**この画面に書かない。** 年度ごとの登録（`evaluation_criteria`）を
 *   そのまま出す。6軸と決め打ちすると、軸が5つの年度で1つ消える。
 *
 * ★ 最終判定（合格・ボーダー・不合格）は**選考の判定ではない。**
 *   選考の通過・不合格は応募の画面が書く。ここは面接官の所見で、
 *   「ボーダー」は選考の側に存在しない。
 *
 * ★ 点と記入欄は**別の入口**にしてある。点は1軸ずつ、記入欄はまとめて。
 *   一緒に送ると、根拠が1つ空いているだけで記入欄まで保存できなくなる。
 *
 * 素の `<form>` である。`'use client'` は増やしていない。
 */

export default async function InterviewPage({
  params, searchParams,
}: {
  params: Promise<{ evaluation: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { evaluation } = await params
  const sp = await searchParams

  const db = await getDb()
  const sheet = await getInterviewSheet(db, evaluation)
  if (!sheet) notFound()

  const [revisions, staffs] = await Promise.all([
    listInterviewRevisions(db, evaluation),
    listDecidingStaff(db),
  ])

  const savedSheet = parseSaveInterviewCode(sp.sheet)
  const savedScore = parseSaveScoreCode(sp.score)

  const value = (v: string | null) => v ?? ''
  const hidden = (
    <>
      <input type="hidden" name="evaluationId" value={sheet.evaluation_id} />
      <input type="hidden" name="applicationId" value={sheet.application_id} />
      <input type="hidden" name="personId" value={sheet.person_id} />
    </>
  )

  return (
    <Shell active="interview" seasonId={sheet.season_id}>
      <Breadcrumb
        root={seasonLabel(sheet)}
        crumbs={[
          { label: '面接', href: `/interviews?season=${sheet.season_id}` },
          {
            label: sheet.person_name,
            href: `/borderline/${sheet.person_id}?season=${sheet.season_id}`,
          },
          { label: sheet.step_name },
        ]}
      />

      {savedSheet && (
        <p className={`callout${savedSheet === 'saved' ? ' ok' : ''}`}>
          {SAVE_INTERVIEW_MESSAGE[savedSheet]}
        </p>
      )}
      {savedScore && (
        <p className={`callout${savedScore === 'saved' ? ' ok' : ''}`}>
          {SAVE_SCORE_CODE_MESSAGE[savedScore]}
        </p>
      )}

      <div className="page-head">
        <div className="bl-person-head">
          <Avatar src={sheet.photo_data_url} name={sheet.person_name} />
          <div>
            <h1 className="page-title">{sheet.person_name}</h1>
            <p className="page-sub">
              {sheet.person_kana && <>{sheet.person_kana} ・ </>}
              {sheet.school} ・ {sheet.step_name}
              {sheet.attempt > 1 && <> ・ {sheet.attempt} 回目</>}
              {sheet.interviewer_name && <> ・ 面接官 {sheet.interviewer_name}</>}
            </p>
          </div>
        </div>
      </div>

      {/* --- 評価軸。年度ごとの登録をそのまま出す --- */}
      <div className="section">
        <section className="card-base">
          <h2 className="section-title">評価</h2>
          {sheet.criteria.length === 0 ? (
            <p className="hh-empty">この選考には評価軸が登録されていない。</p>
          ) : (
            <ul className="criteria-list">
              {sheet.criteria.map((c) => (
                <li key={c.criteria_id} className="criteria-row">
                  <span>
                    <strong>{c.criteria_name}</strong>
                    <span className="section-note">
                      {' '}1〜{num(c.scale_max)}
                      {c.applies_to === 'reapplicant_only' && ' ・ 再応募者のみ'}
                    </span>
                    {c.score !== null && (
                      <span className="section-note" style={{ display: 'block' }}>
                        {c.rationale}
                      </span>
                    )}
                  </span>
                  {c.score !== null ? (
                    <span className="strong nowrap">
                      {num(c.score)}
                      <span className="section-note"> / {num(c.scale_max)}</span>
                    </span>
                  ) : (
                    <form action={saveInterviewScoreAction}
                          className="score-form editable-inline">
                      {hidden}
                      <input type="hidden" name="criteriaId" value={c.criteria_id} />
                      <label className="visually-hidden" htmlFor={`iv-score-${c.criteria_id}`}>
                        {c.criteria_name} の点
                      </label>
                      <input id={`iv-score-${c.criteria_id}`} name="score" type="number"
                             min={1} max={c.scale_max} step={1} required
                             className="score-input" placeholder="点" />
                      <label className="visually-hidden" htmlFor={`iv-why-${c.criteria_id}`}>
                        その点にした根拠
                      </label>
                      <input id={`iv-why-${c.criteria_id}`} name="rationale" type="text" required
                             className="rationale-input"
                             placeholder="何を見てその点にしたか（必須）" />
                      <button type="submit" className="button-secondary">保存</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* --- 記入事項・最終判定。まとめて1回で保存する ---
          `editable-region` は「ここは書ける」という印（C-56）。
          **書ける場所は面の色で分かるようにする**ので、書き込む form には必ず付ける。 */}
      <form action={saveInterviewAction} className="editable-region">
        {hidden}

        <div className="section">
          <section className="card-base">
            <h2 className="section-title">記入事項</h2>
            <div className="iv-grid">
              <label className="iv-field">面接日
                <input name="interviewedOn" type="date"
                       defaultValue={sheet.interviewed_on
                         ? jstDay(sheet.interviewed_on).replace(/\//g, '-') : ''} />
              </label>
              <label className="iv-field">書いた人
                {/* 認証が無いので選ばせる。変更ログに残るのはこの人である。 */}
                <select name="staffId" defaultValue="" required>
                  <option value="" disabled>選ぶ…</option>
                  {staffs.map((s) => (
                    <option key={s.staff_id} value={s.staff_id}>{s.display_name}</option>
                  ))}
                </select>
              </label>
            </div>

            {INTERVIEW_FIELDS.map((f) => (
              <label key={f.name} className="iv-field iv-field-wide">{f.label}
                <textarea name={f.name} rows={f.rows}
                          defaultValue={value(sheet[f.column] as string | null)} />
              </label>
            ))}
          </section>
        </div>

        <div className="section">
          <section className="card-base">
            <h2 className="section-title">最終判定</h2>
            <div className="iv-radios">
              {RECOMMENDATIONS.map((r) => (
                <label key={r} className="iv-radio">
                  <input type="radio" name="recommendation" value={r}
                         defaultChecked={sheet.recommendation === r} />
                  {RECOMMENDATION_LABEL[r]}
                </label>
              ))}
              <label className="iv-radio">
                <input type="radio" name="recommendation" value=""
                       defaultChecked={sheet.recommendation === null} />
                まだ出さない
              </label>
            </div>
            <label className="iv-field iv-field-wide">判定理由・条件など
              <textarea name="recommendationNote" rows={3}
                        defaultValue={value(sheet.recommendation_note)} />
            </label>
            <button type="submit" className="button-primary">面接シートを保存する</button>
          </section>
        </div>
      </form>

      {/* --- 変更ログ --- */}
      <div className="section">
        <section className="card-base">
          <h2 className="section-title">変更ログ</h2>
          {revisions.length === 0 ? (
            <p className="hh-empty">まだ保存されていない。</p>
          ) : (
            <div className="timeline">
              {revisions.map((r) => (
                <div className="timeline-row" key={r.revision_number}>
                  <div className="nowrap section-note">{jstDateTime(r.changed_at)}</div>
                  <div className="timeline-rail">
                    <span className={r.revision_number === revisions.length
                      ? 'timeline-dot' : 'timeline-dot on'} />
                  </div>
                  <div>
                    <div>
                      <strong>第 {r.revision_number} 版</strong>
                      {' ・ '}<span className="section-note">{r.changed_by ?? '記録なし'}</span>
                      {r.recommendation && (
                        <span className="badge-tag-purple" style={{ marginLeft: 6 }}>
                          {RECOMMENDATION_LABEL[
                            r.recommendation as keyof typeof RECOMMENDATION_LABEL]}
                        </span>
                      )}
                    </div>
                    {r.overall_comment && (
                      <div className="section-note">{r.overall_comment}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="section">
        <Link href={`/interviews?season=${sheet.season_id}`} className="hh-more">
          ‹ 面接の一覧へ戻る
        </Link>
        {' 　'}
        <Link href={`/borderline/${sheet.person_id}?season=${sheet.season_id}`}
              className="hh-more">採点 ›</Link>
        {' 　'}
        <Link href={`/people/${sheet.person_id}?season=${sheet.season_id}`}
              className="hh-more">この人の記録 ›</Link>
        {' 　'}
        <Link href={`/applications/${sheet.application_id}`} className="hh-more">
          応募の経緯 ›
        </Link>
      </div>
    </Shell>
  )
}

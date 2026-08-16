import Link from 'next/link'
import type { ScoringSheet } from '../../src/queries/borderline.ts'
import { num } from './ui.tsx'
import { shownRationale } from '../../src/records/placeholder.ts'
import {
  scoreOnBorderlineAction, correctScoreOnBorderlineAction, submitOnBorderlineAction,
} from '../borderline/actions.ts'

/**
 * 採点シート（実行⑩。依頼者の指示 ――「そこで採点入力する」）。
 *
 * 選考タブは成績を出しているのに、点を入れる入口が無かった。
 * 入れられるのは応募の画面だけで、そこへは「やること」からしか行けない。
 *
 * ★ 1軸ずつ保存する。**まとめて保存にしない。**
 *   記録層の単位が `(evaluation_id, criteria_id)` の1行で、面接の途中で
 *   1つだけ書き留められることに意味がある（`src/commands/score.ts`）。
 *
 * ★ 検証をここに書いていない。`max` と `required` は補助であって判定ではない。
 *   判定は記録層（CHECK とトリガ）にあり、失敗は結果コードで返る（C-25）。
 *
 * 素の `<form action={...}>` である。`'use client'` は増やしていない。
 */
export function ScoreSheet({ sheet, context, showAi = false }: {
  sheet: ScoringSheet
  context: Record<string, string>
  showAi?: boolean
}) {
  const hidden = (
    <>
      {Object.entries(context).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input type="hidden" name="applicationId" value={sheet.application_id} />
      <input type="hidden" name="evaluationId" value={sheet.evaluation_id} />
    </>
  )

  return (
    <>
      <h3 className="hh-sub">
        採点 ・ {sheet.step_name}
        {sheet.attempt > 1 && (
          <span className="badge-tag-purple" style={{ marginLeft: 6 }}>{sheet.attempt} 回目</span>
        )}
      </h3>
      <p className="hh-note" style={{ marginTop: 0 }}>
        担当 {sheet.interviewer ?? <span className="badge-tag-orange">未割当</span>}
        {' ・ '}
        {sheet.no_criteria
          ? '評価軸が未登録'
          : `残り ${num(sheet.unscored_count)} / ${num(sheet.criteria.length)} 軸`}
      </p>

      {sheet.no_criteria ? (
        // 軸が無いことを「採点済み」に見せない。足りないのは点ではなく軸である。
        <p className="hh-empty">評価軸が未登録。</p>
      ) : !sheet.can_score && sheet.state !== 'submitted' ? (
        // ★ 確定済みには理由を出さない。`blocked_by` は「この応募はもう
        //   動いていない」と言うが、確定した評価に対しては嘘に読める ――
        //   止まっているのではなく、終わっている。下の「確定済み」で足りる。
        <p className="callout">{sheet.blocked_by}</p>
      ) : null}

      {sheet.criteria.length > 0 && (
        <ul className="criteria-list">
          {sheet.criteria.map((c) => (
            <li key={c.criteria_id} className="criteria-row">
              <span>
                {c.criteria_name}
                <span className="section-note">
                  {' '}{num(c.scale_max)} 点満点
                  {c.applies_to === 'reapplicant_only' && ' ・ 再応募者のみ'}
                </span>
                {/* ★ 何を見る軸なのかを、点を付ける場所に出す（0042。C-160）。
                    名前だけでは「何に対して4点なのか」が人によって変わる。
                    文面は運営の基準表そのままで、こちらで要約していない。 */}
                {c.criteria_description && (
                  <span className="criteria-guide">{c.criteria_description}</span>
                )}
                {/* 付いた点は根拠ごと出す。点だけ出すと後から誰も説明できない。
                    ★ ただし取り込みの埋め草は出さない（C-166。依頼者の指示）。 */}
                {shownRationale(c.rationale) && (
                  <span className="section-note" style={{ display: 'block' }}>
                    {shownRationale(c.rationale)}
                  </span>
                )}
              </span>
              {c.score !== null ? (
                <span className="nowrap">
                  <span className="strong">
                    {num(c.score)}
                    <span className="section-note"> / {num(c.scale_max)}</span>
                  </span>
                  {/*
                    打ち直し（E4。実行⑮。C-133）。**確定前だけ出す** ――
                    `can_score` は「担当が決まっていて、判断がまだ下りていない」
                    と同じ門で、`correctScore` が見るものと一致する。
                    畳んで置くのは、読むつもりで押す事故を避けるため。
                  */}
                  {sheet.can_score && (
                    <details className="score-fix">
                      <summary>直す</summary>
                      <form action={correctScoreOnBorderlineAction}
                            className="score-form editable-inline">
                        {hidden}
                        <input type="hidden" name="criteriaId" value={c.criteria_id} />
                        <label className="visually-hidden" htmlFor={`bl-fix-${c.criteria_id}`}>
                          直した点
                        </label>
                        <input id={`bl-fix-${c.criteria_id}`} name="score" type="number"
                               min={0} max={c.scale_max} step={1} required
                               defaultValue={c.score} className="score-input" />
                        <label className="visually-hidden" htmlFor={`bl-fixwhy-${c.criteria_id}`}>
                          直した根拠
                        </label>
                        <input id={`bl-fixwhy-${c.criteria_id}`} name="rationale" type="text"
                               required defaultValue={c.rationale ?? ''}
                               className="rationale-input"
                               placeholder="何を見てその点にしたか（必須）" />
                        <button type="submit" className="button-secondary">直す</button>
                      </form>
                    </details>
                  )}
                </span>
              ) : sheet.can_score ? (
                <form action={scoreOnBorderlineAction} className="score-form editable-inline">
                  {hidden}
                  <input type="hidden" name="criteriaId" value={c.criteria_id} />
                  <label className="visually-hidden" htmlFor={`bl-score-${c.criteria_id}`}>点</label>
                  <input id={`bl-score-${c.criteria_id}`} name="score" type="number"
                         min={0} max={c.scale_max} step={1} required
                         className="score-input" placeholder="点" />
                  <label className="visually-hidden" htmlFor={`bl-why-${c.criteria_id}`}>
                    その点にした根拠
                  </label>
                  <input id={`bl-why-${c.criteria_id}`} name="rationale" type="text" required
                         className="rationale-input" placeholder="何を見てその点にしたか（必須）" />
                  <button type="submit" className="button-secondary">保存</button>
                </form>
              ) : (
                <span className="section-note nowrap">—</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* 全軸そろってから出す。そろう前は出さない（`can_submit` が決める）。 */}
      {sheet.can_submit && (
        <form action={submitOnBorderlineAction} className="score-form editable-inline"
              style={{ justifyContent: 'flex-start' }}>
          {hidden}
          <button type="submit" className="button-primary">この評価を確定する</button>
        </form>
      )}

      {sheet.state === 'submitted' && (
        <p className="callout ok">確定済み</p>
      )}

      {/* 次の層への入口。
          **点の次にあるのは、点では表せない所見**（面接シート）である。 */}
      <Link href={`/interviews/${sheet.evaluation_id}`} className="hh-more">
        面接シートを開く ›
      </Link>
      {' 　'}
      <Link href={`/applications/${sheet.application_id}`} className="hh-more">
        応募の経緯 ›
      </Link>
      {showAi && sheet.step_name === '書類選考' && (
        <>
          {' 　'}
          <Link
            href={`/ai?${new URLSearchParams({
              season: context.seasonId ?? '', person: sheet.person_id,
            })}`}
            className="hh-more">
            AI分析 ›
          </Link>
        </>
      )}
    </>
  )
}

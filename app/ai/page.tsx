import { getDb } from '../../src/db/server.ts'
import { defaultSeason, getSeason, listSeasons } from '../../src/queries/dashboard.ts'
import { listAiPreAssessmentTargets } from '../../src/queries/ai_pre_assessment.ts'
import { Card, Empty, num } from '../_components/ui.tsx'
import { Breadcrumb, Shell, YearSwitch, seasonLabel } from '../_components/shell.tsx'
import { runAiPreAssessmentAction } from './actions.ts'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const messages: Record<string, string> = {
  saved: '1件をAI分析し、事前ステータスとして記録した。',
  empty: '分析を待っている応募回答は無い。',
  key_required: 'APIキーを貼り付ける。',
  bad_key: 'APIキーが認証されなかった。キーを確かめる。',
  api_failed: 'AI分析を完了できなかった。時間を置いてもう一度試す。',
  record_failed: '分析結果を記録できなかった。',
  forbidden: 'AI分析を実行できるのはALL権限だけです。',
}

export default async function AiPage({ searchParams }: {
  searchParams: Promise<{ season?: string; result?: string; again?: string }>
}) {
  const sp = await searchParams
  const db = await getDb()
  const seasons = await listSeasons(db)
  const season = (await getSeason(db, sp.season)) ?? defaultSeason(seasons)
  if (!season) return <Shell active="headhunting"><Empty>期が登録されていない。</Empty></Shell>
  const again = sp.again === '1'
  const targets = await listAiPreAssessmentTargets(db, season.id, again)

  return (
    <Shell active="headhunting" seasonId={season.id}
      years={<YearSwitch seasons={seasons} currentId={season.id} basePath="/ai" />}>
      <Breadcrumb root={seasonLabel(season)} crumbs={[
        { label: '特別選考', href: `/headhunting?season=${season.id}` },
        { label: 'AI分析' },
      ]} />
      <div className="page-head"><div>
        <h1 className="page-title">AI分析</h1>
        <p className="page-sub">未分析 {num(targets.length)} 件</p>
      </div></div>
      {sp.result && messages[sp.result] && (
        <p className={`callout${sp.result === 'saved' ? ' ok' : ''}`}>{messages[sp.result]}</p>
      )}
      <div className="section"><Card title="次の1件を分析">
        <form action={runAiPreAssessmentAction} className="editable-region">
          <input type="hidden" name="seasonId" value={season.id} />
          <label className="iv-field">Anthropic APIキー
            <input name="apiKey" type="password" required autoComplete="off"
              placeholder="sk-ant-…" spellCheck={false} />
            <small>キーはDB・Cookie・URL・Gitへ保存せず、この1回の実行だけに使います。</small>
          </label>
          <label>
            <input type="checkbox" name="again" value="1" defaultChecked={again} />
            分析済みもやり直す（前の分析は消さず、訂正として積む）
          </label>
          <p>実行すると、氏名・メール・電話を除いた応募フォーム本文をAnthropicへ送ります。</p>
          <button className="button-primary" type="submit">
            次の1件を分析する
          </button>
        </form>
      </Card></div>
    </Shell>
  )
}

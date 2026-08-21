import { getDb } from '../../src/db/server.ts'
import { defaultSeason, getSeason, listSeasons } from '../../src/queries/dashboard.ts'
import { listAiPreAssessmentTargets } from '../../src/queries/ai_pre_assessment.ts'
import { Card, Empty, num } from '../_components/ui.tsx'
import { Breadcrumb, Shell, YearSwitch, seasonLabel } from '../_components/shell.tsx'
import { runAiPreAssessmentAction, askDatabaseAction } from './actions.ts'
import { cookies } from 'next/headers'
import { saveAnthropicApiKeyAction } from './actions.ts'
import { hasAnthropicApiKey } from '../../src/secrets/anthropic.ts'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const messages: Record<string, string> = {
  saved: '1件をAI分析し、事前ステータスとして記録した。',
  empty: '分析を待っている応募回答は無い。',
  key_required: 'APIキーを貼り付ける。',
  key_saved: 'APIキーを暗号化して保存した。以後のAI分析で自動的に使います。',
  encryption_secret_missing: '暗号化に必要なサーバ設定が無いため保存できなかった。',
  bad_key: 'APIキーが認証されなかった。キーを確かめる。',
  api_failed: 'AI分析を完了できなかった。時間を置いてもう一度試す。',
  record_failed: '分析結果を記録できなかった。',
  forbidden: 'AI分析を実行できるのはALL権限だけです。',
}

export default async function AiPage({ searchParams }: {
  searchParams: Promise<{ season?: string; person?: string; result?: string; again?: string }>
}) {
  const sp = await searchParams
  const db = await getDb()
  const seasons = await listSeasons(db)
  const season = (await getSeason(db, sp.season)) ?? defaultSeason(seasons)
  if (!season) return <Shell active="headhunting"><Empty>期が登録されていない。</Empty></Shell>
  const again = sp.again === '1'
  const personId = sp.person ?? ''
  const targets = await listAiPreAssessmentTargets(db, season.id, again, personId)
  const keyConfigured = await hasAnthropicApiKey(db)

  // ★ 直前の問いと答え。**記録層には残さない**（置き場所を決めていない）。
  //   Cookie に短命で置き、描いたら消える扱いにする（C-200）。
  const raw = (await cookies()).get('youthdb_ask')?.value
  let asked: { q: string; answer: string; steps: string[] } | null = null
  if (raw) {
    try { asked = JSON.parse(raw) } catch { asked = null }
  }

  return (
    <Shell active="borderline" seasonId={season.id}
      years={<YearSwitch seasons={seasons} currentId={season.id} basePath="/ai" />}>
      <Breadcrumb root={seasonLabel(season)} crumbs={[
        { label: '通常選考', href: `/borderline?season=${season.id}` },
        { label: '書類選考', href: `/borderline?season=${season.id}&tab=step1` },
        ...(personId ? [{
          label: '採点',
          href: `/borderline/${personId}?season=${season.id}&tab=step1`,
        }] : [{ label: '採点', href: `/borderline?season=${season.id}&tab=step1` }]),
        { label: 'AI分析' },
      ]} />
      <div className="page-head"><div>
        <h1 className="page-title">AI分析</h1>
        <p className="page-sub">未分析 {num(targets.length)} 件</p>
      </div></div>
      {sp.result && messages[sp.result] && (
        <p className={`callout${sp.result === 'saved' ? ' ok' : ''}`}>{messages[sp.result]}</p>
      )}
      <div className="section"><Card title="Anthropic API設定">
        <form action={saveAnthropicApiKeyAction} className="editable-region">
          <input type="hidden" name="seasonId" value={season.id} />
          <input type="hidden" name="personId" value={personId} />
          <label className="iv-field">Anthropic APIキー
            <input name="apiKey" type="password" required autoComplete="off"
              placeholder="sk-ant-…" spellCheck={false} />
            <small>一度登録すれば以後も自動使用します。暗号化してDBへ保存し、画面には戻しません。</small>
          </label>
          <p>{keyConfigured ? '登録済み。ここから新しいキーへ差し替えられます。' : '未登録です。'}</p>
          <button className="button-primary" type="submit">
            {keyConfigured ? 'APIキーを差し替える' : 'APIキーを登録する'}
          </button>
        </form>
      </Card></div>
      {/* ★ DB全体への問い合わせ（依頼者の指示。実行⑰。C-200 / C-201）。
          ★ **読める先は層で変わる** ―― 画面で伏せるのではなく、
            AIへ渡す道具そのものを層で絞っている（`src/ai/ask.ts`）。 */}
      <div className="section"><Card title="記録に聞く">
        <form action={askDatabaseAction} className="editable-region">
          <input type="hidden" name="seasonId" value={season?.id ?? ''} />
          <label>問い
            <input name="question" required maxLength={400}
                   placeholder="例：3期の応募は何人か" />
          </label>
          <button className="button-primary" type="submit">聞く</button>
        </form>
        {asked && (
          <div className="ask-answer">
            <p className="section-note">{asked.q}</p>
            <p>{asked.answer}</p>
            {asked.steps.length > 0 && (
              <p className="section-note">
                読んだ記録: {asked.steps.join(' / ')}
              </p>
            )}
          </div>
        )}
      </Card></div>

      <div className="section"><Card title="次の1件を分析">
        <form action={runAiPreAssessmentAction} className="editable-region">
          <input type="hidden" name="seasonId" value={season.id} />
          <input type="hidden" name="personId" value={personId} />
          <label>
            <input type="checkbox" name="again" value="1" defaultChecked={again} />
            分析済みもやり直す（前の分析は消さず、訂正として積む）
          </label>
          <p>実行すると、氏名・メール・電話を除いた応募フォーム本文をAnthropicへ送ります。</p>
          <button className="button-primary" type="submit">
            {keyConfigured ? '次の1件を分析する' : '先にAPIキーを登録する'}
          </button>
        </form>
      </Card></div>
    </Shell>
  )
}

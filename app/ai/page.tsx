import Link from 'next/link'
import { cookies } from 'next/headers'
import { getDb } from '../../src/db/server.ts'
import { defaultSeason, getSeason, listSeasons } from '../../src/queries/dashboard.ts'
import {
  listAiPreAssessmentTargets,
  listCompletedAiPreAssessments,
} from '../../src/queries/ai_pre_assessment.ts'
import { Card, Empty, num } from '../_components/ui.tsx'
import { Breadcrumb, Shell, YearSwitch, seasonLabel } from '../_components/shell.tsx'
import {
  runAiPreAssessmentAction,
  askDatabaseAction,
  saveAnthropicApiKeyAction,
} from './actions.ts'
import { hasAnthropicApiKey } from '../../src/secrets/anthropic.ts'
import { AiQuickPrompts } from './_components/ai_quick_prompt.tsx'

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

  const [targets, completed, keyConfigured] = await Promise.all([
    listAiPreAssessmentTargets(db, season.id, again, personId),
    listCompletedAiPreAssessments(db, season.id),
    hasAnthropicApiKey(db),
  ])

  // 直前の問いと答え（Cookie 経由で戻す短命データ）
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
        { label: 'AI分析コパイロット' },
      ]} />

      <div className="page-head">
        <div>
          <h1 className="page-title">✨ AI分析コパイロット</h1>
          <p className="page-sub">
            未分析: <strong>{num(targets.length)}</strong> 件 ／ 分析完了: <strong>{num(completed.length)}</strong> 件
            <span style={{ marginLeft: '12px' }} className={`badge ${keyConfigured ? 'badge-pass' : 'badge-warn'}`}>
              {keyConfigured ? '🔑 Anthropic APIキー設定済み' : '⚠️ APIキー未設定'}
            </span>
          </p>
        </div>
      </div>

      {sp.result && messages[sp.result] && (
        <p className={`callout${sp.result === 'saved' || sp.result === 'key_saved' ? ' ok' : ''}`}>
          {messages[sp.result]}
        </p>
      )}

      {/* 1. APIキー設定 */}
      <div className="section">
        <Card title="🔑 Anthropic APIキー設定">
          <form action={saveAnthropicApiKeyAction} className="editable-region">
            <input type="hidden" name="seasonId" value={season.id} />
            <input type="hidden" name="personId" value={personId} />
            <label className="iv-field">
              Anthropic APIキー
              <input name="apiKey" type="password" required autoComplete="off"
                placeholder="sk-ant-…" spellCheck={false} />
              <small>一度登録すれば以後も自動使用します。暗号化してDBへ保存し、画面には戻しません。</small>
            </label>
            <p style={{ fontWeight: 700, color: keyConfigured ? 'var(--color-success-deep)' : 'var(--color-error-deep)' }}>
              {keyConfigured ? '✓ APIキー登録済み。新しいキーへ上書き変更できます。' : '⚠️ APIキー未登録です。分析実行前にキーを入力してください。'}
            </p>
            <button className="button-secondary" type="submit">
              {keyConfigured ? 'APIキーを更新する' : 'APIキーを登録する'}
            </button>
          </form>
        </Card>
      </div>

      {/* 2. 記録に聞く (AI RAG Assistant) */}
      <div className="section">
        <Card title="💬 記録に聞く (データベース AI アシスタント)">
          <form className="editable-region" action={askDatabaseAction}>
            <input type="hidden" name="seasonId" value={season?.id ?? ''} />
            <AiQuickPrompts />
            <button className="button-primary" type="submit" style={{ marginTop: '12px' }}>
              AIに質問する
            </button>
          </form>
          {asked && (
            <div className="ask-answer" style={{ marginTop: '16px', padding: '16px', background: 'var(--surface-variant)', borderRadius: '8px', borderLeft: '4px solid var(--brand-primary)' }}>
              <p className="section-note" style={{ fontWeight: 600, color: 'var(--text-strong)' }}>質問: {asked.q}</p>
              <div style={{ marginTop: '8px', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{asked.answer}</div>
              {asked.steps.length > 0 && (
                <p className="section-note" style={{ marginTop: '12px', fontSize: '11px', color: 'var(--text-muted)' }}>
                  🔍 参照したデータベーステーブル: {asked.steps.join(' / ')}
                </p>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* 3. 応募フォーム AI 事前分析 */}
      <div className="section">
        <Card title="⚡️ 応募フォーム AI 事前分析">
          <form action={runAiPreAssessmentAction} className="editable-region">
            <input type="hidden" name="seasonId" value={season.id} />
            <input type="hidden" name="personId" value={personId} />
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input type="checkbox" name="again" value="1" defaultChecked={again} />
              <span>分析済みもやり直す（前の分析は消さず、訂正として追記ログを積む）</span>
            </label>
            <p className="section-note" style={{ margin: '8px 0 16px 0' }}>
              実行すると、氏名・メール・電話番号を除いた安全な応募フォーム本文を Anthropic API へ送信し、思考力・相性を事前判定します。
            </p>
            <button className="button-secondary" type="submit">
              {keyConfigured
                ? (targets.length > 0 ? `次の1件を分析する（残り ${targets.length} 件）` : '分析待ちの回答はありません')
                : '先にAPIキーを登録する'}
            </button>
          </form>
        </Card>
      </div>

      {/* 4. AI 分析済み結果一覧 */}
      <div className="section">
        <Card title={`📊 AI分析済み候補者一覧 (${completed.length}件)`}>
          {completed.length === 0 ? (
            <p className="section-note">この年度でまだAI分析が完了した候補者はいません。</p>
          ) : (
            <div className="table-wrapper">
              <table className="sheet-table">
                <thead>
                  <tr>
                    <th>候補者名</th>
                    <th>学校</th>
                    <th>AI事前判定</th>
                    <th>AI所見・根拠</th>
                    <th>分析日時</th>
                    <th>採点シート</th>
                  </tr>
                </thead>
                <tbody>
                  {completed.map((item) => (
                    <tr key={item.person_id}>
                      <td>
                        <strong>{item.family_name} {item.given_name}</strong>
                      </td>
                      <td>{item.school || '未設定'}</td>
                      <td>
                        <span className="chip" style={{ background: 'var(--brand-surface)', fontWeight: 600 }}>
                          {item.label}
                        </span>
                        {item.definition && <small style={{ display: 'block', color: 'var(--text-muted)' }}>{item.definition}</small>}
                      </td>
                      <td style={{ maxWidth: '360px', fontSize: '12px', lineHeight: 1.4 }}>
                        {item.rationale}
                      </td>
                      <td>
                        <small>{new Date(item.occurred_at).toLocaleDateString('ja-JP')}</small>
                      </td>
                      <td>
                        <Link
                          href={`/borderline/${item.person_id}?season=${season.id}&tab=step1`}
                          className="button-secondary"
                          style={{ padding: '4px 8px', fontSize: '12px' }}
                        >
                          採点シートを開く ›
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </Shell>
  )
}

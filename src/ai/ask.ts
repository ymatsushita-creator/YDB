import { aiClient, AI_MODEL } from './client.ts'
import { all, type Db } from '../db/client.ts'
import type { Tier } from '../auth/tiers.ts'

/**
 * DB全体へ問い合わせる（依頼者の指示。実行⑰。C-200）。
 *
 * 依頼者の言葉 ――「APIは、ragとしても使えるようにDB全体を見渡せる存在にしたい」。
 *
 * ★★ **自由なSQLは書かせない。** ★★
 *   「DB全体を見渡す」を、AIに `SELECT` を書かせて叶えると、
 *   ①書き換えの文が混ざる余地が残り、②重い問い合わせで本番が詰まり、
 *   ③次に表が増えたとき**知らない場所を読みにいく。**
 *   代わりに、**読み取り専用の道具**を並べて渡す。AIは道具を選び、
 *   引数を決める。文はこちら側にあり、増やすのも人の判断である。
 *
 * ★ 道具はすべて `SELECT` のみ。件数と要約を返し、行を丸ごと吐かない。
 * ★ 上限を必ず持たせる（`LIMIT`）。返る量が予測できない道具を置かない。
 * ★★ **層（権限）ごとに、渡す道具そのものを変える**（依頼者の指示。C-201）。★★
 *   同じ問いでも、読める先が層によって違う。
 *   画面で答えを伏せるのではなく、**AIに渡す道具を減らす** ――
 *   伏せる作りだと、AIは一度読んでから隠すことになり、
 *   答えの言い回しに読んだ跡が残る。渡さなければ、読みようがない。
 *
 *   all      … 全部（個人の特定を含む）
 *   personal … 個人は引けない。集計と選考の形だけ
 *   input    … 選考の形（段・軸・KPI）だけ。人の分布も見せない
 */

export interface AskResult {
  answer: string
  /** 使った道具と引数。**何を見て答えたかを人が追える。** */
  steps: { tool: string; input: unknown }[]
  model: string
}

/**
 * 層ごとに使える道具。**`canOpen` と同じ線を引く**（`/headhunting` は all の持ち物）。
 * ★ 判定を2箇所に散らさないため、線の意味はここに書いて `tiers.ts` を参照する。
 */
const TOOLS_BY_TIER: Record<Tier, string[]> = {
  // 個人を引ける道具（`find_person`・確度の分布）は all だけ。
  all: ['season_overview', 'selection_steps', 'criteria', 'confidence_breakdown',
    'partner_status', 'channel_performance', 'find_person', 'kpi_list'],
  // 集計は見えるが、**個人は引けない。**
  personal: ['season_overview', 'selection_steps', 'criteria',
    'partner_status', 'channel_performance', 'kpi_list'],
  // 入力層は選考の形だけ。人の分布も流入元も見せない。
  input: ['selection_steps', 'criteria'],
}

/** 渡す道具。名前・説明・引数の形と、実際に流す文を1箇所に置く。 */
const TOOLS: Record<string, {
  description: string
  schema: Record<string, unknown>
  sql: (input: Record<string, string>) => { text: string; params: unknown[] }
}> = {
  season_overview: {
    description: '期（年度）の一覧と、その期の候補者数・応募数・合格者数。'
      + '「今年は何人応募したか」のような問いはまずこれを見る。',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    sql: () => ({
      text: `
        SELECT s.enrollment_year AS 年度, s.cohort_number AS 期,
               (SELECT count(*) FROM applications a
                 WHERE a.season_id = s.id AND a.voided_at IS NULL
                   AND a.deleted_at IS NULL) AS 応募,
               (SELECT count(*) FROM v_application_outcome o
                  JOIN applications a2 ON a2.id = o.application_id
                 WHERE a2.season_id = s.id AND o.outcome = 'accepted') AS 合格,
               s.capacity AS 定員
          FROM seasons s WHERE NOT s.is_demo
         ORDER BY s.enrollment_year`,
      params: [],
    }),
  },
  selection_steps: {
    description: '選考の段と、その段の評価軸・満点。「書類選考は何点満点か」など。',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    sql: () => ({
      text: `
        SELECT s.enrollment_year AS 年度, st.name AS 段,
               count(c.id) AS 軸数, coalesce(sum(c.scale_max), 0) AS 満点
          FROM selection_steps st
          JOIN seasons s ON s.id = st.season_id AND NOT s.is_demo
          LEFT JOIN evaluation_criteria c ON c.selection_step_id = st.id
         GROUP BY s.enrollment_year, st.name, st.sort_order
         ORDER BY s.enrollment_year, st.sort_order`,
      params: [],
    }),
  },
  criteria: {
    description: '評価軸の呼び名と満点、何を見る軸かの説明。段の名前で絞れる。',
    schema: {
      type: 'object',
      properties: { step: { type: 'string', description: '段の名前。空なら全部' } },
      required: ['step'], additionalProperties: false,
    },
    sql: (i) => ({
      text: `
        SELECT s.enrollment_year AS 年度, st.name AS 段, c.name AS 軸,
               c.scale_max AS 満点, c.description AS 説明
          FROM evaluation_criteria c
          JOIN selection_steps st ON st.id = c.selection_step_id
          JOIN seasons s ON s.id = st.season_id AND NOT s.is_demo
         WHERE ($1 = '' OR st.name = $1)
         ORDER BY s.enrollment_year, st.sort_order, c.sort_order
         LIMIT 200`,
      params: [i.step ?? ''],
    }),
  },
  confidence_breakdown: {
    description: '確度（S/A/B/C）ごとの人数。期ごとに数える。',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    sql: () => ({
      text: `
        SELECT s.enrollment_year AS 年度, v.grade_code AS 確度, count(*) AS 人数
          FROM v_person_confidence v
          JOIN seasons s ON s.id = v.season_id AND NOT s.is_demo
         GROUP BY s.enrollment_year, v.grade_code
         ORDER BY s.enrollment_year, v.grade_code`,
      params: [],
    }),
  },
  partner_status: {
    description: '連携団体の推薦枠ステイタスごとの件数。期ごと。',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    sql: () => ({
      text: `
        SELECT s.enrollment_year AS 年度, st.label AS 状態, count(*) AS 件数
          FROM v_partner_recommendation_state v
          JOIN seasons s ON s.id = v.season_id AND NOT s.is_demo
          JOIN partner_recommendation_states st ON st.id = v.state_id
         GROUP BY s.enrollment_year, st.label, st.sort_order
         ORDER BY s.enrollment_year, st.sort_order`,
      params: [],
    }),
  },
  channel_performance: {
    description: 'どの流入元から何人来て、何人応募し、何人受かったか。',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    sql: () => ({
      text: `
        SELECT c.name AS 流入元, count(DISTINCT t.person_id) AS 人数
          FROM touchpoints t JOIN channels c ON c.id = t.channel_id
         GROUP BY c.name ORDER BY 2 DESC LIMIT 50`,
      params: [],
    }),
  },
  find_person: {
    description: '名前の一部で候補者を探す。番号・学校・確度・いまの状態を返す。'
      + '個人について聞かれたときだけ使う。',
    schema: {
      type: 'object',
      properties: { name: { type: 'string', description: '姓か名の一部' } },
      required: ['name'], additionalProperties: false,
    },
    sql: (i) => ({
      text: `
        SELECT p.family_name || ' ' || p.given_name AS 氏名,
               sc.name AS 学校, v.grade_code AS 確度
          FROM persons p
          LEFT JOIN schools sc ON sc.id = p.school_id
          LEFT JOIN v_person_confidence v ON v.person_id = p.id
         WHERE p.deleted_at IS NULL
           AND (p.family_name ILIKE '%' || $1 || '%'
             OR p.given_name ILIKE '%' || $1 || '%')
         LIMIT 20`,
      params: [i.name ?? ''],
    }),
  },
  kpi_list: {
    description: '登録されているKPIと、その変数・目標。',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    sql: () => ({
      text: `
        SELECT s.enrollment_year AS 年度, l.title AS 題名,
               m.label AS 変数, l.value AS 目標, l.memo AS メモ
          FROM kpis k
          JOIN seasons s ON s.id = k.season_id
          JOIN LATERAL (SELECT * FROM kpi_revisions
                         WHERE kpi_id = k.id ORDER BY revision_no DESC LIMIT 1) l ON true
          LEFT JOIN kpi_metrics m ON m.key = l.metric_key
         WHERE l.archived_at IS NULL
         ORDER BY s.enrollment_year LIMIT 100`,
      params: [],
    }),
  },
}

const SYSTEM = `あなたはNEOアカデミアの選考データベースに答える。

道具を使って記録を読み、**読んだ数字だけ**で答える。
★ 記録に無いことは推測しない。無ければ「記録に無い」と言う。
★ 数字を出すときは、どの道具で読んだかが分かるように書く。
★ 単位の違うものを割らない（人数と件数を混ぜない）。
★ 答えは日本語。短く、結論から書く。`

export async function askDatabase(
  db: Db, question: string, tier: Tier, apiKey?: string,
): Promise<AskResult> {
  const q = question.trim()
  if (!q) throw new Error('問いが空である')

  // ★ 層で絞った道具**だけ**を渡す（C-201）。
  const allowed = new Set(TOOLS_BY_TIER[tier] ?? [])
  const tools = Object.entries(TOOLS)
    .filter(([name]) => allowed.has(name))
    .map(([name, t]) => ({
      name, description: t.description, input_schema: t.schema as never,
    }))
  if (tools.length === 0) throw new Error('この層が読める記録が無い')

  const messages: { role: 'user' | 'assistant'; content: unknown }[] = [
    { role: 'user', content: q },
  ]
  const steps: { tool: string; input: unknown }[] = []
  const client = aiClient(apiKey)

  // ★ 道具の往復に上限を置く。**止まらない問いで本番を占有させない。**
  for (let turn = 0; turn < 6; turn += 1) {
    const res = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 4000,
      thinking: { type: 'adaptive' },
      system: SYSTEM,
      tools: tools as never,
      messages: messages as never,
    })
    if (res.stop_reason !== 'tool_use') {
      const text = res.content.find((b) => b.type === 'text')
      return {
        answer: text && text.type === 'text' ? text.text.trim() : '（答えが返らなかった）',
        steps, model: AI_MODEL,
      }
    }
    messages.push({ role: 'assistant', content: res.content })
    const results: unknown[] = []
    for (const block of res.content) {
      if (block.type !== 'tool_use') continue
      const tool = allowed.has(block.name) ? TOOLS[block.name] : undefined
      steps.push({ tool: block.name, input: block.input })
      // ★ 実行の直前にもう一度、層を見る（渡していない道具は流さない）。
      if (!tool) {
        results.push({
          type: 'tool_result', tool_use_id: block.id,
          content: '知らない道具である。', is_error: true,
        })
        continue
      }
      const { text, params } = tool.sql((block.input ?? {}) as Record<string, string>)
      const rows = await all(db, text, params)
      results.push({
        type: 'tool_result', tool_use_id: block.id,
        content: JSON.stringify(rows).slice(0, 20000),
      })
    }
    messages.push({ role: 'user', content: results })
  }
  return { answer: '道具の往復が上限に達した。問いを分けて聞く。', steps, model: AI_MODEL }
}

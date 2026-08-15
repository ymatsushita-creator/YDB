import { aiClient, AI_MODEL } from './client.ts'

/**
 * AI分析（事前ステータス）を出す（依頼者の指示。実行⑯。C-164）。
 *
 * ★★ **これは成績ではない。** ★★
 *   出るのは `ai_pre_labels` の語と理由文だけで、点も順位も出ない。
 *   書き込み先は `ai_pre_assessments`（0044）であって
 *   `evaluation_scores` ではない。依頼者の指示：「通常の成績としては扱わない」。
 *
 * ★ 観点は依頼者の言葉（実行⑯）――
 *   「書類選考では、Neoとの相性、質問に論理的に答えられているか、
 *     やり遂げた実績はあるか、コミットする意志があるか をAIを使って自動分析」。
 *   **この4つを評価軸マスタへは登録しない**（依頼者が退けた）。
 *   ここでは「AIに何を見せるか」の指示文としてだけ使う。
 *
 * ★ **氏名・連絡先はAPIへ渡さない。** 渡すのは設問と回答文だけである。
 *   誰かを当てるための分析ではないし、外へ出す個人情報は少ないほどよい。
 */

export interface AnswerInput {
  /** 設問文。 */
  question: string
  /** 回答文。 */
  answer: string
}

export interface PreAssessment {
  /** `ai_pre_labels.code` のいずれか。 */
  label: string
  /** 人が読むための理由。点ではない。 */
  rationale: string
  model: string
}

const VIEWPOINTS = [
  'NEOとの相性',
  '質問に論理的に答えられているか',
  'やり遂げた実績はあるか',
  'コミットする意志があるか',
] as const

const SYSTEM = `あなたは選考担当の下読みを手伝う。合否は判定しない。点も付けない。

次の4つの観点で応募回答を読み、人が読む順番を決めるための札を1つ選ぶ:
${VIEWPOINTS.map((v) => `- ${v}`).join('\n')}

札の意味は入力で与える。与えられた札のcodeのいずれかを必ず選ぶこと。
理由は日本語で200字以内。回答文に書かれていないことを推測して書かない。
回答が短い、観点に答えていない、といった事実だけを根拠にする。`

/**
 * ★ 札の一覧は**DBから渡してもらう**（この文に書き写さない）。
 *   同じ語を2箇所に置くと、片方を直したときもう片方が古くなる。
 */
export async function assessApplication(input: {
  labels: { code: string; definition: string }[]
  answers: AnswerInput[]
}): Promise<PreAssessment> {
  if (input.labels.length === 0) throw new Error('札が1つも無い（seed 0009 未適用）')
  const answers = input.answers.filter((a) => a.answer.trim() !== '')
  if (answers.length === 0) throw new Error('回答が1つも無い')

  const message = await aiClient().messages.create({
    model: AI_MODEL,
    max_tokens: 2000,
    thinking: { type: 'adaptive' },
    output_config: {
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            label: { type: 'string', enum: input.labels.map((l) => l.code) },
            rationale: { type: 'string' },
          },
          required: ['label', 'rationale'],
          additionalProperties: false,
        },
      },
    },
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: [
        '# 札',
        ...input.labels.map((l) => `- ${l.code}: ${l.definition}`),
        '',
        '# 応募回答',
        ...answers.map((a) => `## ${a.question}\n${a.answer}`),
      ].join('\n'),
    }],
  })

  const text = message.content.find((b) => b.type === 'text')
  if (!text || text.type !== 'text') throw new Error('AIが何も返さなかった')
  const parsed = JSON.parse(text.text) as { label: string; rationale: string }

  // 形式は保証されているが、**札はDB側でも再検証する**（CLAUDE.md）。
  if (!input.labels.some((l) => l.code === parsed.label)) {
    throw new Error(`知らない札が返った: ${parsed.label}`)
  }
  return { label: parsed.label, rationale: parsed.rationale.trim(), model: AI_MODEL }
}

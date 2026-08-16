import { aiClient, AI_MODEL } from './client.ts'

/**
 * AI分析を出す（依頼者の指示。実行⑯。C-164 / C-165）。
 *
 * 依頼者の言葉 ――「論理性の観点とかはやってもいいよ」「AI採点は点数で出せや」。
 *
 * ★★ **点は出す。ただし成績ではない。** ★★
 *   書き込み先は `ai_pre_assessments` / `ai_pre_viewpoints`（0044 / 0045）で、
 *   `evaluation_scores` ではない。依頼者は同じ実行の中で
 *   「通常の成績としては扱わない」と決めている。
 *   点が出ることと、その点が公式の成績になることは別である。
 *
 * ★★ **観点は「論理性」1つだけ**（依頼者の指示：「じゃあそこだけ実装して」）。
 *   実績・コミット・相性は出させない ―― 応募文から測れないものに点を付けると、
 *   推測が数字の見た目をして残る。理由は `REQUIRED_VIEWPOINT` の注記にある。
 *
 * ★ 満点は1観点4点。書類選考の1軸あたりの配点（16点 ÷ 4軸）に合わせた。
 *   **尺度を創作しない。**
 *
 * ★ 観点の呼び名は `evaluation_criteria` へは登録しない（依頼者が退けた）。
 *
 * ★ **氏名・連絡先はAPIへ渡さない。** 渡すのは設問と回答文だけである。
 */

export interface AnswerInput {
  /** 設問文。 */
  question: string
  /** 回答文。 */
  answer: string
}

export interface ViewpointScore {
  /** 観点の呼び名。いまは `REQUIRED_VIEWPOINT` のみ。 */
  viewpoint: string
  /** 点。0〜`SCALE_MAX`。 */
  score: number
  /** なぜその点か。 */
  finding: string
}

export interface PreAssessment {
  /** 全体の札（先に読む順番を決めるためのもの）。 */
  label: string
  /** 全体の理由。 */
  rationale: string
  /** 観点ごとの点と所見。 */
  viewpoints: ViewpointScore[]
  model: string
}

/** 満点。書類選考の1軸あたりの配点（16点 ÷ 4軸）に合わせる。 */
export const SCALE_MAX = 4
/**
 * ★★ **観点はこれ1つだけ。** 依頼者の指示：「じゃあそこだけ実装して」。
 *
 *   実績・コミットの意志・NEOとの相性は**出させない。**
 *   応募文から測れるのは「具体的に書いてあるか」までで、
 *   本当にやり遂げたのか、本当に続くのかは文章では分からない。
 *   測れないものに点を付けると、**推測が数字の見た目をして残る。**
 *
 *   論理性だけは文章の中だけで完結する ―― 設問の答えになっているか、
 *   主張と根拠がつながっているか、話が飛んでいないか。
 *   だからここだけをAIに聞く。
 */
export const REQUIRED_VIEWPOINT = '論理性'

const SYSTEM = `あなたは選考担当の下読みを手伝う。合否は判定しない。

応募回答を読み、「${REQUIRED_VIEWPOINT}」の1点だけを0〜${SCALE_MAX}点で採点する。
観点はこれだけ。他の観点を足さない。

見るのは次のことだけだ:
  - 設問に対して、答えになっているか
  - 主張に根拠が付いているか
  - 話が途中で飛んでいないか
文章のうまさ、熱意、実績のすごさ、志望度は**見ない。**

点の付け方:
  0 = 設問に答えていない、または判断できる記述が無い
  1 = 答えてはいるが、根拠が無く言い切っているだけ
  2 = 根拠はあるが、主張とのつながりが弱い
  3 = 主張と根拠がつながっており、筋が通っている
  4 = 筋が通っており、反論や前提にも触れている

★ 書かれていないことを推測して点にしない。
★ 迷ったら低く付ける。下読みなので、人が読めば上がる。
★ 全体の札は入力で与えるcodeのいずれかを必ず選ぶ。
所見は各60字以内、全体の理由は200字以内。日本語で書く。`

/**
 * ★ 札の一覧は**DBから渡してもらう**（この文に書き写さない）。
 *   同じ語を2箇所に置くと、片方を直したときもう片方が古くなる。
 */
export async function assessApplication(input: {
  labels: { code: string; definition: string }[]
  answers: AnswerInput[]
}): Promise<PreAssessment> {
  if (input.labels.length === 0) throw new Error('札が1つも無い（0044 未適用）')
  const answers = input.answers.filter((a) => a.answer.trim() !== '')
  if (answers.length === 0) throw new Error('回答が1つも無い')

  const message = await aiClient().messages.create({
    model: AI_MODEL,
    max_tokens: 4000,
    thinking: { type: 'adaptive' },
    output_config: {
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            label: { type: 'string', enum: input.labels.map((l) => l.code) },
            rationale: { type: 'string' },
            viewpoints: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  viewpoint: { type: 'string' },
                  score: { type: 'integer' },
                  finding: { type: 'string' },
                },
                required: ['viewpoint', 'score', 'finding'],
                additionalProperties: false,
              },
            },
          },
          required: ['label', 'rationale', 'viewpoints'],
          additionalProperties: false,
        },
      },
    },
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: [
        '# 全体の札',
        ...input.labels.map((l) => `- ${l.code}: ${l.definition}`),
        '',
        '# 応募回答',
        ...answers.map((a) => `## ${a.question}\n${a.answer}`),
      ].join('\n'),
    }],
  })

  const text = message.content.find((b) => b.type === 'text')
  if (!text || text.type !== 'text') throw new Error('AIが何も返さなかった')
  const parsed = JSON.parse(text.text) as {
    label: string; rationale: string; viewpoints: ViewpointScore[]
  }

  // ★ 形式は保証されているが、**中身はこちらでも再検証する**（CLAUDE.md）。
  //   点の範囲も観点の重複も、JSON Schema では防げない。
  if (!input.labels.some((l) => l.code === parsed.label)) {
    throw new Error(`知らない札が返った: ${parsed.label}`)
  }
  const seen = new Set<string>()
  for (const v of parsed.viewpoints) {
    const name = (v.viewpoint ?? '').trim()
    if (!name) throw new Error('観点の名前が空である')
    if (seen.has(name)) throw new Error(`同じ観点が2度出た: ${name}`)
    seen.add(name)
    if (!Number.isInteger(v.score) || v.score < 0 || v.score > SCALE_MAX) {
      throw new Error(`点が範囲外: ${name} = ${v.score}`)
    }
    if (!(v.finding ?? '').trim()) throw new Error(`所見が空である: ${name}`)
  }
  // ★ 出るのは論理性1つだけ。**無ければ、多ければ、その分析は捨てる。**
  //   他の観点で代用すると、測れないものに点が付いたまま残る。
  if (parsed.viewpoints.length !== 1 || !seen.has(REQUIRED_VIEWPOINT)) {
    throw new Error(`観点は「${REQUIRED_VIEWPOINT}」1つだけのはずが、`
      + `${parsed.viewpoints.length}件返った`)
  }

  return {
    label: parsed.label,
    rationale: parsed.rationale.trim(),
    viewpoints: parsed.viewpoints.map((v) => ({
      viewpoint: v.viewpoint.trim(),
      score: v.score,
      finding: v.finding.trim(),
    })),
    model: AI_MODEL,
  }
}

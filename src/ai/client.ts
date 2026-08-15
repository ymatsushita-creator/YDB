import Anthropic from '@anthropic-ai/sdk'

/**
 * Claude API を叩く口（依頼者の指示。実行⑯。C-164）。
 *
 * ★ **使い道は2つだけ。** 依頼者の言葉 ――
 *   「ClaudAPIで叩くのは、エクセル、CSVを入れたら勝手にDBに反映してくれる
 *     システムと、AI分析と称した事前ステータスだけで良い。
 *     通常の成績としては扱わない」。
 *
 *   1. 取り込みの割り当てを作る（`ingest_plan.ts`）
 *   2. 事前ステータスを出す（`pre_assessment.ts`）
 *
 *   **点は付けない。** `evaluation_scores` へ書く道はこの階層に置かない。
 *
 * ★ 画面からは呼ばない。`src/commands/` でも `src/queries/` でもなく
 *   `src/ai/` に置き、**道具（scripts/）からだけ呼ぶ。**
 *   画面の応答時間に外部サービスをぶら下げると、外が遅い日に画面が止まる。
 *
 * ★ 鍵は `ANTHROPIC_API_KEY`。無ければここで**止める** ――
 *   鍵の無いまま黙って空の結果を返すと、分析していないのに
 *   「分析済み」の見た目になる。
 */

/** 依頼者の記録に対する判断を含むので、最も能力の高い層を使う。 */
export const AI_MODEL = 'claude-opus-5'

export class MissingApiKey extends Error {
  constructor() {
    super('ANTHROPIC_API_KEY が無い。.env.local に置くこと。')
    this.name = 'MissingApiKey'
  }
}

let cached: Anthropic | null = null

export function aiClient(): Anthropic {
  if (cached) return cached
  if (!process.env.ANTHROPIC_API_KEY) throw new MissingApiKey()
  cached = new Anthropic()
  return cached
}

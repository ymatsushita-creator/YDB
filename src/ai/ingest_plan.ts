import { aiClient, AI_MODEL } from './client.ts'

/**
 * エクセル／CSV を入れたら、DBのどの欄に入るかを**割り当てる**
 * （依頼者の指示。実行⑯。C-164）。
 *
 * 依頼者の言葉 ――「エクセル、CSVを入れたら勝手にDBに反映してくれるシステム」。
 *
 * ★★ **AIが決めるのは「列と欄の対応」だけである。** ★★
 *   SQLは書かせない。入れ先は下の `TARGETS` に固定してある ――
 *   AIに書き込み先を自由に決めさせると、次の表で知らない列が増えた日に
 *   知らない場所へ書く。対応表を出させて、**書くのは既存のコマンド**が行う。
 *
 * ★★ **見出しだけを送る。中の値は1件も送らない。** ★★
 *   割り当てに要るのは列の名前であって、誰の何という値かではない。
 *   外へ出す個人情報は少ないほどよい（CLAUDE.md）。
 *
 * ★ 割り当ては**画面に出して人が見てから流す**（`scripts/ingest-sheet.ts` は
 *   既定が下読みで、`--apply` を付けたときだけ書く）。C-88 と同じ作法。
 */

/** 入れ先の欄。`NewCandidateInput`（`src/commands/intake.ts`）の名前に合わせる。 */
export const TARGETS = {
  familyName: '姓',
  givenName: '名',
  familyNameKana: '姓のふりがな',
  givenNameKana: '名のふりがな',
  birthDate: '生年月日',
  faculty: '学部・学科',
  email: 'メールアドレス',
  phone: '電話番号',
  lineUserId: 'LINEのID',
  note: '備考・自由記述',
} as const

export type TargetField = keyof typeof TARGETS

export interface ColumnPlan {
  /** 列の位置（0起点）。 */
  index: number
  /** 表の見出し語。 */
  header: string
  /** 入れ先。対応するものが無ければ null（＝取り込まない）。 */
  target: TargetField | null
  /** なぜそう割り当てたか。人が下読みで見る。 */
  reason: string
}

export async function planIngest(input: {
  /** シート名やファイル名。見出しだけでは分からない文脈を補う。 */
  label: string
  /** 見出し行。**値は渡さない。** */
  headers: string[]
}): Promise<ColumnPlan[]> {
  const headers = input.headers
  if (headers.length === 0) throw new Error('見出し行が空である')

  const message = await aiClient().messages.create({
    model: AI_MODEL,
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    output_config: {
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            columns: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  index: { type: 'integer' },
                  target: { type: ['string', 'null'], enum: [...Object.keys(TARGETS), null] },
                  reason: { type: 'string' },
                },
                required: ['index', 'target', 'reason'],
                additionalProperties: false,
              },
            },
          },
          required: ['columns'],
          additionalProperties: false,
        },
      },
    },
    system: `表計算の見出し行を読み、各列をデータベースの欄へ割り当てる。

対応する欄が無い列は target を null にする。**無理に当てない** ――
間違った欄に入るより、取り込まないほうがよい。
1つの欄に2つ以上の列を当てない。氏名が1列にまとまっている場合は
familyName に当て、reason にその旨を書く。
reason は日本語で60字以内。`,
    messages: [{
      role: 'user',
      content: [
        `# 表: ${input.label}`,
        '',
        '# 入れ先の欄',
        ...Object.entries(TARGETS).map(([k, v]) => `- ${k}: ${v}`),
        '',
        '# 見出し行（index: 見出し）',
        ...headers.map((h, i) => `${i}: ${h}`),
      ].join('\n'),
    }],
  })

  const text = message.content.find((b) => b.type === 'text')
  if (text?.type !== 'text') throw new Error('AIが何も返さなかった')
  const parsed = JSON.parse(text.text) as { columns: Omit<ColumnPlan, 'header'>[] }

  // ★ 返ってきた割り当てを**こちら側で検証する。** 形式は保証されているが、
  //   位置が範囲外だったり、同じ欄を2度使ったりは形式では防げない。
  const used = new Set<string>()
  const plan: ColumnPlan[] = []
  for (const c of parsed.columns) {
    if (!Number.isInteger(c.index) || c.index < 0 || c.index >= headers.length) {
      throw new Error(`列の位置が範囲外: ${c.index}`)
    }
    if (c.target !== null && !(c.target in TARGETS)) {
      throw new Error(`知らない欄: ${c.target}`)
    }
    if (c.target !== null) {
      if (used.has(c.target)) throw new Error(`同じ欄に2つの列が当たっている: ${c.target}`)
      used.add(c.target)
    }
    plan.push({ ...c, header: headers[c.index] ?? '' })
  }
  return plan.sort((a, b) => a.index - b.index)
}

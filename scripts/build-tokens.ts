import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

/**
 * basic/DESIGN.md の frontmatter から CSS カスタムプロパティを生成する。
 *
 * トークンを手で写すと、DESIGN.md が単一の情報源でなくなる。
 * 色を1つ変えるたびに2箇所を直すことになり、いずれ食い違う。
 * 生成物（app/tokens.css）は編集しない。編集するのは DESIGN.md のほう。
 *
 * typography と components は参照（{colors.primary} など）を含むため、
 * 解決してから出力する。解決できない参照は黙って通さず落とす。
 */

const DESIGN = fileURLToPath(new URL('../basic/DESIGN.md', import.meta.url))
const OUT = fileURLToPath(new URL('../app/tokens.css', import.meta.url))

interface Gradient {
  type?: 'mesh' | 'linear'
  stops?: string[]
  opacity?: number
  blur?: string
  start?: string
  middle?: string
  end?: string
  description?: string
  usage?: string
}

interface Design {
  name?: string
  colors: Record<string, string>
  gradients?: Record<string, Gradient>
  typography: Record<string, Record<string, string | number>>
  rounded: Record<string, string>
  spacing: Record<string, string>
  components: Record<string, Record<string, string>>
}

function readFrontmatter(markdown: string): Design {
  const m = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) throw new Error('DESIGN.md に frontmatter が見つからない')
  return parse(m[1]!) as Design
}

/** グループ名から CSS カスタムプロパティの接頭辞へ。 */
const VAR_PREFIX: Record<string, string> = {
  colors: '--color-',
  rounded: '--rounded-',
  spacing: '--space-',
  gradients: '--gradient-',
}

/**
 * {colors.primary} の形の参照を解決する。
 *
 * mode='var' は var(--color-primary) を出す。値を直に焼き込むと、
 * 生成後に色を差し替える手段がなくなる（ダークテーマも配色の入れ替えも
 * できない）。参照のまま残せば、カスタムプロパティの上書きだけで効く。
 */
function resolve(
  value: string, design: Design, where: string, mode: 'var' | 'literal' = 'literal',
): string {
  return String(value).replace(/\{([a-z]+)\.([a-zA-Z0-9-]+)\}/g, (whole, group, key) => {
    const table = (design as unknown as Record<string, Record<string, unknown>>)[group]
    const found = table?.[key]
    if (found === undefined) throw new Error(`${where}: 解決できない参照 ${whole}`)
    // gradients はテーブルの値がオブジェクト（stops など）である。
    // 実体は :root の --gradient-* に1度だけ展開し、ここでは参照だけを返す。
    // 展開結果を各コンポーネントへ焼き込むと、同じ長い CSS が51箇所へ複製される。
    if (group === 'gradients') return `var(--gradient-${key})`
    if (typeof found === 'object') throw new Error(`${where}: 解決できない参照 ${whole}`)
    const prefix = VAR_PREFIX[group]
    return mode === 'var' && prefix ? `var(${prefix}${key})` : String(found)
  })
}

const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()

/**
 * DESIGN.md の fontFamily は "Notion Sans" だが、その書体は手元になく、
 * そもそも日本語のグリフを持たない。和文が全部フォールバックで出るなら、
 * 指定してあるという事実のほうが嘘になる。
 * 書体の実体は --font-sans（app/base.css）に1箇所で定義し、ここでは参照する。
 */
const fontValue = (raw: string) => (/notion|inter/i.test(raw) ? 'var(--font-sans)' : raw)

/** #RRGGBB → rgba(r, g, b, a)。opacity 付きの mesh を作るのに要る。 */
function rgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/**
 * mesh の光源配置。DESIGN.md「Gradient Behaviour」が
 * 「等幅の帯にするな・不均等に置け」と指示しているため、等間隔では置かない。
 * 値は DESIGN.md 末尾の CSS 例（overlapping radial-gradient）から採った。
 * 7色ぶん。stops がこれより多い場合は循環させる。
 */
const MESH_POSITIONS = [
  [12, 18, 30], [30, 60, 34], [44, 40, 32], [56, 66, 32],
  [68, 28, 36], [83, 38, 34], [96, 18, 32],
] as const

/**
 * gradients の1件を CSS の値へ落とす。
 *
 * mesh は単一の linear-gradient では作れない（等幅の帯になる）。
 * 重ねた radial-gradient で「各色が光源」という DESIGN.md の指定を満たす。
 * stops を持たない mesh（brand-spectrum-soft / -vivid）は、
 * DESIGN.md の記述どおり brand-spectrum の派生なので、その stops を借りる。
 */
function gradientCss(name: string, g: Gradient, all: Record<string, Gradient>): string {
  if (g.type === 'linear') {
    const parts = [g.start, g.middle, g.end].filter((v): v is string => Boolean(v))
    if (parts.length === 0) throw new Error(`gradients.${name}: linear に start/middle/end が無い`)
    const resolved = parts.map((p) => resolve(p, design, `gradients.${name}`, 'literal'))
    return `linear-gradient(135deg, ${resolved.join(', ')})`
  }
  const stops = g.stops ?? all['brand-spectrum']?.stops
  if (!stops?.length) throw new Error(`gradients.${name}: stops が無く、既定の spectrum も見つからない`)
  const alpha = g.opacity ?? 0.92
  const layers = stops.map((hex, i) => {
    const [x, y, spread] = MESH_POSITIONS[i % MESH_POSITIONS.length]!
    return `radial-gradient(circle at ${x}% ${y}%, ${rgba(hex, alpha)}, transparent ${spread}%)`
  })
  // 黒を最後に敷く。DESIGN.md「黒との対比で明るさが出る」。
  return [...layers, design.colors['canvas-dark'] ?? '#050505'].join(', ')
}

const design = readFrontmatter(await readFile(DESIGN, 'utf8'))

const lines: string[] = [
  '/* 自動生成。編集しないこと。',
  ' * 出典: basic/DESIGN.md の frontmatter',
  ' * 再生成: pnpm tokens',
  ' */',
  '',
  ':root {',
]

for (const [key, value] of Object.entries(design.colors)) {
  lines.push(`  --color-${key}: ${value};`)
}
lines.push('')
// gradients は :root に1度だけ展開する。blur は CSS 値ではなく
// 「この光の場をぼかして敷け」という指示なので、別プロパティとして出す。
for (const [key, g] of Object.entries(design.gradients ?? {})) {
  lines.push(`  --gradient-${key}: ${gradientCss(key, g, design.gradients ?? {})};`)
  if (g.blur) lines.push(`  --gradient-${key}-blur: ${g.blur};`)
}
if (design.gradients) lines.push('')
for (const [key, value] of Object.entries(design.rounded)) {
  lines.push(`  --rounded-${key}: ${value};`)
}
lines.push('')
for (const [key, value] of Object.entries(design.spacing)) {
  lines.push(`  --space-${key}: ${value};`)
}
lines.push('')

// タイポグラフィは font ショートハンドにまとめず、個別のプロパティで出す。
// line-height と letter-spacing をショートハンドに畳むと上書きしにくい。
for (const [name, spec] of Object.entries(design.typography)) {
  for (const [prop, value] of Object.entries(spec)) {
    const v = prop === 'fontFamily' ? fontValue(String(value)) : String(value)
    lines.push(`  --type-${name}-${kebab(prop)}: ${resolve(v, design, name, 'var')};`)
  }
}
lines.push('}')
lines.push('')

// components は CSS クラスとして出す。DESIGN.md のコンポーネント名を
// そのままクラス名にすることで、画面のコードから定義へ辿れるようにする。
const CSS_PROP: Record<string, string> = {
  backgroundColor: 'background-color',
  background: 'background',
  textColor: 'color',
  rounded: 'border-radius',
  padding: 'padding',
  cellPadding: 'padding',
  border: 'border',
  shadow: 'box-shadow',
  height: 'height',
}

/**
 * 幅と線種を持たない色だけの指定。`border-color` だけを出しても
 * 既定の border-width が 0 なので**画面には何も出ない**。
 * DESIGN.md の hairline は1pxの罫線を指しているので、そう出す。
 */
const HAIRLINE_PROP: Record<string, string> = {
  borderColor: 'border',
  rowBorder: 'border-bottom',
  itemDivider: 'border-bottom',
}

/**
 * CSS のプロパティに1対1で対応しないもの（accent / activeIndicator /
 * focusRing など）。**ここで勝手に描き方を決めない。**
 * 疑似要素で出すのか border-image で出すのかは画面側の判断であり、
 * DESIGN.md は「どの値を使うか」しか決めていない。
 * クラス直下のカスタムプロパティとして渡し、描画は CSS 側に委ねる。
 */
const isTypographyProp = (p: string) => /Typography$/.test(p)

for (const [name, spec] of Object.entries(design.components)) {
  const decls: string[] = []
  for (const [prop, raw] of Object.entries(spec)) {
    if (prop === 'typography') {
      // {typography.button-md} 形式。個別プロパティへ展開する。
      const ref = String(raw).match(/^\{typography\.([a-zA-Z0-9-]+)\}$/)
      if (!ref) throw new Error(`components.${name}: typography は参照で書く`)
      const t = design.typography[ref[1]!]
      if (!t) throw new Error(`components.${name}: 未定義の typography ${ref[1]}`)
      for (const [p, v] of Object.entries(t)) {
        decls.push(`  ${kebab(p)}: ${p === 'fontFamily' ? fontValue(String(v)) : v};`)
      }
      continue
    }
    // 説明文。スタイルではないので出力しない。
    if (prop === 'description' || prop === 'usage') continue

    // headerTypography / bodyTypography / captionTypography。
    // typography と同じ参照だが、1つのクラスに複数の書体指定が同居するため、
    // 素の font-size では衝突する。接頭辞付きのカスタムプロパティで渡す。
    if (isTypographyProp(prop)) {
      const ref = String(raw).match(/^\{typography\.([a-zA-Z0-9-]+)\}$/)
      if (!ref) throw new Error(`components.${name}: ${prop} は参照で書く`)
      const t = design.typography[ref[1]!]
      if (!t) throw new Error(`components.${name}: 未定義の typography ${ref[1]}`)
      const scope = kebab(prop.replace(/Typography$/, ''))
      for (const [p, v] of Object.entries(t)) {
        decls.push(`  --${scope}-${kebab(p)}: ${p === 'fontFamily' ? fontValue(String(v)) : v};`)
      }
      continue
    }

    const hairline = HAIRLINE_PROP[prop]
    if (hairline) {
      const color = resolve(String(raw), design, `components.${name}`, 'var')
      decls.push(`  ${hairline}: 1px solid ${color};`)
      continue
    }

    const cssProp = CSS_PROP[prop]
    if (!cssProp) {
      // 描き方が一意に決まらない意味的な指定。値だけ渡す。
      decls.push(`  --${kebab(prop)}: ${resolve(String(raw), design, `components.${name}`, 'var')};`)
      continue
    }
    const value = resolve(String(raw), design, `components.${name}`, 'var')
    // border の "0 0 2px {colors.ink} solid" は CSS の border 記法ではない。
    // DESIGN.md の表記をそのまま出すと効かないため、下線指定として扱う。
    if (cssProp === 'border' && /^0 0 /.test(value)) {
      const [, , width, ...rest] = value.split(/\s+/)
      decls.push(`  border-bottom: ${width} ${rest.reverse().join(' ')};`)
      continue
    }
    decls.push(`  ${cssProp}: ${value};`)
  }
  lines.push(`.${name} {`, ...decls, '}', '')
}

await writeFile(OUT, lines.join('\n'), 'utf8')

const counts = {
  colors: Object.keys(design.colors).length,
  typography: Object.keys(design.typography).length,
  rounded: Object.keys(design.rounded).length,
  spacing: Object.keys(design.spacing).length,
  components: Object.keys(design.components).length,
}
console.log(`app/tokens.css を生成: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ')}`)

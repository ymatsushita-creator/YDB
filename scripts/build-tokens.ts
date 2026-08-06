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

interface Design {
  name?: string
  colors: Record<string, string>
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
    if (found === undefined || typeof found === 'object') {
      throw new Error(`${where}: 解決できない参照 ${whole}`)
    }
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
  textColor: 'color',
  rounded: 'border-radius',
  padding: 'padding',
  border: 'border',
  shadow: 'box-shadow',
  height: 'height',
}

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
    const cssProp = CSS_PROP[prop]
    if (!cssProp) throw new Error(`components.${name}: 未知のプロパティ ${prop}`)
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

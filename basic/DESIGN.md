---
version: beta
name: YouthDB-playful-operations-design-system
description: >
  YouthDBの集客・候補者選定・選考を前へ進めるplayful operations system。
  クリームの記録基盤と白い紙面を保ち、現在地はピンク、主操作は黄色、
  情報は空色、完了はミント、AIと特別機能は紫で示す。太い輪郭と硬い影は
  操作可能な要素に限定し、候補者情報・評価・表は静かに読みやすく保つ。

colors:
  # ─── Core ───────────────────────────────────────────────
  primary: "#352E45"
  on-primary: "#FFFDF8"

  ink: "#2B2635"
  body: "#5D5668"
  mute: "#8C8494"

  # ─── Surfaces ───────────────────────────────────────────
  canvas: "#FFFDF8"
  canvas-soft: "#FFF6E8"
  canvas-soft-2: "#FCEFE6"

  canvas-dark: "#352E45"
  canvas-dark-soft: "#413850"
  canvas-dark-2: "#4E435E"

  hairline: "#E9DED5"
  hairline-strong: "#C9B9B2"
  hairline-dark: "#51485F"
  hairline-dark-strong: "#685C77"

  # ─── Brand Spectrum ─────────────────────────────────────
  brand-lime: "#B6CF0B"
  brand-lime-soft: "#E9F59C"
  brand-lime-deep: "#8EAB00"

  brand-yellow: "#F1D370"
  brand-yellow-bright: "#F4D12A"
  brand-yellow-soft: "#FFF1B2"
  brand-yellow-deep: "#C59A00"

  brand-coral: "#ED808A"
  brand-coral-soft: "#F8C2C7"
  brand-coral-deep: "#D95B6D"

  brand-pink: "#F1849A"
  brand-pink-soft: "#FBC8D3"
  brand-pink-deep: "#D95B78"

  brand-cyan: "#52B4E1"
  brand-cyan-soft: "#B9E3F5"
  brand-cyan-deep: "#2289BC"

  brand-periwinkle: "#7A86BF"
  brand-periwinkle-soft: "#C9CEE8"
  brand-periwinkle-deep: "#5967A4"

  brand-lavender: "#9C82C8"
  brand-lavender-soft: "#D9CDEC"
  brand-lavender-deep: "#7658A8"

  # ─── Functional ─────────────────────────────────────────
  link: "#368FC1"
  link-deep: "#216B94"
  link-bg-soft: "#DFF3FC"

  success: "#73A900"
  success-soft: "#E8F5C3"
  success-deep: "#3D6100"

  warning: "#E0AC18"
  warning-soft: "#FFF0BE"
  warning-deep: "#765100"

  error: "#D95B6D"
  error-soft: "#F9D9DD"
  error-deep: "#AE3448"

  info: "#52B4E1"
  info-soft: "#DDF3FC"
  info-deep: "#175B78"

  # ─── Brand Gradient Stops ───────────────────────────────
  gradient-lime: "#B6CF0B"
  gradient-yellow: "#F1D370"
  gradient-coral: "#ED808A"
  gradient-pink: "#F1849A"
  gradient-cyan: "#52B4E1"
  gradient-periwinkle: "#7A86BF"
  gradient-lavender: "#9C82C8"

  # ─── Gradient Pairs ─────────────────────────────────────
  gradient-warm-start: "#B6CF0B"
  gradient-warm-mid: "#F1D370"
  gradient-warm-end: "#ED808A"

  gradient-cool-start: "#52B4E1"
  gradient-cool-mid: "#7A86BF"
  gradient-cool-end: "#9C82C8"

  selection-bg: "#F4D12A"
  selection-fg: "#2B2635"

gradients:
  brand-spectrum:
    description: >
      Primary brand mesh gradient derived from the logo.
      Lime and yellow emerge from one region, dissolve into coral and pink,
      then transition through cyan into periwinkle and lavender.
      Colours overlap organically rather than appearing as discrete bands.
    type: mesh
    stops:
      - "#B6CF0B"
      - "#F1D370"
      - "#ED808A"
      - "#F1849A"
      - "#52B4E1"
      - "#7A86BF"
      - "#9C82C8"
    usage: "hero, major-brand-moment, active-data-visualization"

  brand-spectrum-soft:
    description: >
      Low-opacity atmospheric version of the brand spectrum.
      Intended for large background light fields rather than UI chrome.
    type: mesh
    opacity: 0.22
    blur: 72px

  brand-spectrum-vivid:
    description: >
      High-saturation spectrum reserved for logo-adjacent hero visuals,
      selected states, key brand moments, and major visualization accents.
    type: mesh
    opacity: 1

  brand-warm:
    type: linear
    start: "{colors.gradient-lime}"
    middle: "{colors.gradient-yellow}"
    end: "{colors.gradient-coral}"

  brand-cool:
    type: linear
    start: "{colors.gradient-cyan}"
    middle: "{colors.gradient-periwinkle}"
    end: "{colors.gradient-lavender}"

typography:
  display-xl:
    fontFamily: Geist, Inter, system-ui, -apple-system, sans-serif
    fontSize: 48px
    fontWeight: 850
    lineHeight: 48px
    letterSpacing: -2.4px

  display-lg:
    fontFamily: Geist, Inter, system-ui, -apple-system, sans-serif
    fontSize: 32px
    fontWeight: 850
    lineHeight: 40px
    letterSpacing: -1.28px

  display-md:
    fontFamily: Geist, Inter, system-ui, -apple-system, sans-serif
    fontSize: 24px
    fontWeight: 800
    lineHeight: 32px
    letterSpacing: -0.96px

  display-sm:
    fontFamily: Geist, Inter, system-ui, -apple-system, sans-serif
    fontSize: 20px
    fontWeight: 800
    lineHeight: 28px
    letterSpacing: -0.6px

  body-lg:
    fontFamily: Geist, Inter, system-ui, -apple-system, sans-serif
    fontSize: 18px
    fontWeight: 400
    lineHeight: 28px
    letterSpacing: 0px

  body-md:
    fontFamily: Geist, Inter, system-ui, -apple-system, sans-serif
    fontSize: 16px
    fontWeight: 400
    lineHeight: 24px

  body-md-strong:
    fontFamily: Geist, Inter, system-ui, -apple-system, sans-serif
    fontSize: 16px
    fontWeight: 700
    lineHeight: 24px

  body-sm:
    fontFamily: Geist, Inter, system-ui, -apple-system, sans-serif
    fontSize: 14px
    fontWeight: 400
    lineHeight: 20px
    letterSpacing: -0.28px

  body-sm-strong:
    fontFamily: Geist, Inter, system-ui, -apple-system, sans-serif
    fontSize: 14px
    fontWeight: 700
    lineHeight: 20px
    letterSpacing: -0.28px

  caption:
    fontFamily: Geist, Inter, system-ui, -apple-system, sans-serif
    fontSize: 12px
    fontWeight: 400
    lineHeight: 16px

  caption-mono:
    fontFamily: Geist Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, monospace
    fontSize: 12px
    fontWeight: 400
    lineHeight: 16px

  code:
    fontFamily: Geist Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, monospace
    fontSize: 13px
    fontWeight: 400
    lineHeight: 20px

  button-md:
    fontFamily: Geist, Inter, system-ui, -apple-system, sans-serif
    fontSize: 14px
    fontWeight: 800
    lineHeight: 20px

  button-lg:
    fontFamily: Geist, Inter, system-ui, -apple-system, sans-serif
    fontSize: 16px
    fontWeight: 800
    lineHeight: 24px

rounded:
  none: 0px
  xs: 8px
  sm: 12px
  md: 18px
  lg: 24px
  xl: 32px
  pill-sm: 64px
  pill: 100px
  full: 9999px

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 40px
  3xl: 48px
  4xl: 64px
  5xl: 96px
  6xl: 128px
  section: 192px

components:
  nav-bar:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    height: 64px
    padding: "{spacing.sm} {spacing.lg}"

  nav-link:
    textColor: "{colors.body}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.full}"
    padding: "{spacing.xs} {spacing.sm}"

  nav-link-active:
    textColor: "{colors.ink}"
    typography: "{typography.body-sm-strong}"
    backgroundColor: "{colors.brand-pink}"
    borderColor: "{colors.primary}"
    rounded: "{rounded.sm}"
    padding: "{spacing.xs} {spacing.sm}"

  nav-cta-signup:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.body-sm-strong}"
    rounded: "{rounded.sm}"
    padding: "0px {spacing.xs}"
    height: 28px

  nav-cta-login:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm-strong}"
    rounded: "{rounded.sm}"
    padding: "0px {spacing.xs}"
    height: 28px

  nav-cta-ask-ai:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    typography: "{typography.body-sm-strong}"
    rounded: "{rounded.sm}"
    padding: "0px {spacing.xs}"
    height: 28px

  button-primary:
    backgroundColor: "{colors.brand-yellow-bright}"
    textColor: "{colors.ink}"
    border: "3px solid {colors.primary}"
    shadow: "0 5px 0 {colors.primary}"
    typography: "{typography.button-lg}"
    rounded: "{rounded.sm}"
    padding: "0px {spacing.sm}"

  button-secondary:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    typography: "{typography.button-lg}"
    rounded: "{rounded.pill}"
    padding: "0px {spacing.sm}"

  button-brand:
    background: "{gradients.brand-spectrum}"
    textColor: "{colors.ink}"
    typography: "{typography.button-lg}"
    rounded: "{rounded.pill}"
    padding: "0px {spacing.sm}"

  button-primary-sm:
    backgroundColor: "{colors.brand-yellow-bright}"
    textColor: "{colors.ink}"
    border: "3px solid {colors.primary}"
    shadow: "0 4px 0 {colors.primary}"
    typography: "{typography.button-md}"
    rounded: "{rounded.sm}"
    padding: "0px {spacing.xs}"

  button-secondary-sm:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    typography: "{typography.button-md}"
    rounded: "{rounded.pill}"
    padding: "0px {spacing.xs}"

  tab-ghost:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.pill-sm}"
    padding: "0px {spacing.md}"

  tab-active:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    accent: "{gradients.brand-spectrum}"
    typography: "{typography.body-sm-strong}"
    rounded: "{rounded.pill-sm}"
    padding: "0px {spacing.md}"

  icon-button-circular:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    rounded: "{rounded.full}"

  card-marketing:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: "{spacing.lg}"

  card-marketing-large:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    typography: "{typography.body-md}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xl}"

  card-marketing-dark:
    backgroundColor: "{colors.canvas-dark-soft}"
    textColor: "{colors.on-primary}"
    borderColor: "{colors.hairline-dark}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: "{spacing.lg}"

  card-brand-accent:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    accentBorder: "{gradients.brand-spectrum}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: "{spacing.lg}"

  card-soft:
    backgroundColor: "{colors.canvas-soft}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: "{spacing.lg}"

  template-card:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: "{spacing.md}"

  code-editor-mockup:
    backgroundColor: "{colors.canvas-dark}"
    textColor: "{colors.on-primary}"
    borderColor: "{colors.hairline-dark}"
    typography: "{typography.code}"
    rounded: "{rounded.md}"
    padding: "{spacing.lg}"

  form-input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    focusBorderColor: "{colors.brand-cyan}"
    focusRing: "{colors.brand-cyan-soft}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: "0px {spacing.sm}"
    height: 40px

  form-input-sm:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    focusBorderColor: "{colors.brand-cyan}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: "0px {spacing.sm}"
    height: 32px

  form-input-lg:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    focusBorderColor: "{colors.brand-cyan}"
    typography: "{typography.body-md}"
    rounded: "{rounded.sm}"
    padding: "0px {spacing.sm}"
    height: 48px

  badge-secondary:
    backgroundColor: "{colors.canvas-soft}"
    textColor: "{colors.body}"
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
    padding: "0px {spacing.xs}"

  badge-brand:
    background: "{gradients.brand-spectrum}"
    textColor: "{colors.ink}"
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
    padding: "0px {spacing.xs}"

  badge-success:
    backgroundColor: "{colors.success-soft}"
    textColor: "{colors.success-deep}"
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
    padding: "0px {spacing.xs}"

  badge-warning:
    backgroundColor: "{colors.warning-soft}"
    textColor: "{colors.warning-deep}"
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
    padding: "0px {spacing.xs}"

  badge-error:
    backgroundColor: "{colors.error-soft}"
    textColor: "{colors.error-deep}"
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
    padding: "0px {spacing.xs}"

  pricing-card:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    typography: "{typography.body-md}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xl}"

  pricing-card-featured:
    backgroundColor: "{colors.canvas-dark}"
    textColor: "{colors.on-primary}"
    borderColor: "{colors.hairline-dark}"
    accent: "{gradients.brand-spectrum}"
    typography: "{typography.body-md}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xl}"

  logo-strip:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.body}"
    typography: "{typography.body-sm}"
    padding: "{spacing.lg} {spacing.xl}"

  hero-band:
    backgroundColor: "{colors.canvas-dark}"
    textColor: "{colors.on-primary}"
    typography: "{typography.display-xl}"
    padding: "{spacing.4xl} {spacing.lg}"
    decoration: "{gradients.brand-spectrum}"

  hero-band-light:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.display-xl}"
    padding: "{spacing.4xl} {spacing.lg}"
    decoration: "{gradients.brand-spectrum-soft}"

  feature-mesh-band:
    backgroundColor: "{colors.canvas-dark}"
    textColor: "{colors.on-primary}"
    typography: "{typography.display-lg}"
    padding: "{spacing.5xl} {spacing.lg}"
    decoration: "{gradients.brand-spectrum-soft}"

  showcase-band-light:
    backgroundColor: "{colors.canvas-soft}"
    textColor: "{colors.ink}"
    typography: "{typography.display-lg}"
    padding: "{spacing.5xl} {spacing.lg}"

  showcase-band-dark:
    backgroundColor: "{colors.canvas-dark}"
    textColor: "{colors.on-primary}"
    typography: "{typography.display-lg}"
    padding: "{spacing.5xl} {spacing.lg}"

  footer:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.body}"
    typography: "{typography.body-sm}"
    padding: "{spacing.4xl} {spacing.lg}"

  footer-dark:
    backgroundColor: "{colors.canvas-dark}"
    textColor: "{colors.mute}"
    headingColor: "{colors.on-primary}"
    typography: "{typography.body-sm}"
    padding: "{spacing.4xl} {spacing.lg}"

  link-inline:
    textColor: "{colors.link}"
    hoverColor: "{colors.brand-cyan-deep}"
    typography: "{typography.body-md}"

  banner-marketing:
    backgroundColor: "{colors.canvas-soft}"
    textColor: "{colors.body}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.full}"
    padding: "{spacing.xs} {spacing.sm}"

  # ─── Examples ───────────────────────────────────────────
  ex-pricing-tier:
    description: >
      Default tier card. Neutral chrome with a restrained hairline border.
      Brand spectrum is excluded unless the card is explicitly selected.
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xl}"

  ex-pricing-tier-featured:
    description: >
      Featured tier. Polarity-flipped to near-black with the brand spectrum
      used only as a narrow highlight or ambient edge treatment.
    backgroundColor: "{colors.canvas-dark}"
    textColor: "{colors.on-primary}"
    accent: "{gradients.brand-spectrum}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xl}"

  ex-product-selector:
    description: >
      Product or feature selector. Neutral by default; active state may receive
      a small spectral indicator.
    backgroundColor: "{colors.canvas-soft}"
    activeIndicator: "{gradients.brand-spectrum}"
    rounded: "{rounded.md}"
    padding: "{spacing.lg}"

  ex-cart-drawer:
    description: >
      Subscription or summary drawer. Operational surface remains monochrome.
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.md}"
    padding: "{spacing.lg}"
    itemDivider: "{colors.hairline}"

  ex-app-shell-row:
    description: >
      Sidebar navigation row. Active state uses a narrow spectrum indicator
      rather than filling the entire row with colour.
    backgroundColor: "{colors.canvas}"
    activeIndicator: "{gradients.brand-spectrum}"
    rounded: "{rounded.sm}"
    padding: "{spacing.xs} {spacing.sm}"

  ex-data-table-cell:
    description: >
      Dense table chrome. Header uses mono technical typography.
      Brand colour is excluded from ordinary table cells.
    headerBackground: "{colors.canvas-soft}"
    headerTypography: "{typography.caption-mono}"
    bodyTypography: "{typography.body-sm}"
    cellPadding: "{spacing.xs} {spacing.sm}"
    rowBorder: "{colors.hairline}"

  ex-auth-form-card:
    description: >
      Authentication surface. Neutral card chrome with brand-coloured focus states.
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xl}"

  ex-modal-card:
    description: >
      Modal dialog surface. Neutral canvas with restrained stacked shadow.
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xl}"

  ex-empty-state-card:
    description: >
      Empty-state frame. May contain one large low-opacity spectral illustration,
      but text remains on a neutral field.
    backgroundColor: "{colors.canvas-soft}"
    rounded: "{rounded.lg}"
    padding: "{spacing.3xl}"
    captionTypography: "{typography.body-md}"

  ex-toast:
    description: >
      Toast surface. Semantic colour may appear as a narrow indicator;
      the entire toast should not become spectral.
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.md}"
    padding: "{spacing.sm} {spacing.md}"
    typography: "{typography.body-sm}"

---

## 1. Design concept

### Playful operations

YouthDBは、起業家アカデミーの集客・候補者選定・選考を前へ進める運営コックピットである。楽しさは装飾ではなく、「現在地」「次の行動」「完了」を迷わず読めることに使う。

- 情報構造は静かに、操作のきっかけだけを明るくする
- 主操作は太い輪郭と硬い影で「押せる」と伝える
- 候補者情報、評価、入力値は装飾より読みやすさを優先する
- ゲーム用語や報酬表現は持ち込まない
- 子どもっぽさではなく、本気で人を応援するチームの温度を目指す

### Two-layer system

1. **Record foundation** — クリームの背景、白い紙面、濃い紫灰の文字、細い区切り。個人情報、表、検索、入力、長文を支える。
2. **Momentum layer** — ピンク、黄色、空色、ミント、紫、太い輪郭、硬い影。現在地、主操作、情報、完了、AIを支える。

全面をカラフルにしない。通常情報はfoundation、動かしたい箇所だけmomentum layerに置く。

## 2. Product translation

| YouthDBの仕事 | 表現 |
| --- | --- |
| 現在開いている業務 | ピンクの面と濃い文字 |
| 次に行う主操作 | 黄色、3pxの輪郭、硬い下影 |
| 補足情報・通常進捗 | 空色 |
| 完了・合格・安全な状態 | ミント |
| AI・特別な分析 | 紫 |
| 注意・期限確認 | 黄色。文言を必ず併記 |
| 修正必須 | 赤。文言と形を必ず併記 |

「クエスト」「XP」「ランク」「報酬」などのゲーム語彙は使わない。YouthDBでは既存の業務語彙である「やること」「候補者」「通常選考」「特別選考」「面接・評価」「連携団体」を使う。

## 3. Shape and depth

- 入力・小さな操作: 10–14px
- 通常カード: 18px
- 主要カード: 24px
- ヒーロー・ダイアログ: 32px
- Foundation UI: 1px solid hairline
- 触れる主要要素: 2–3px solid primary
- 硬い影はボタン、現在地、選択可能な主要カードだけに使う
- 読むだけのカードと表には硬い影を使わない

## 4. Typography

本文は角ゴシックで安定させる。ページタイトルと主要な数だけ太くし、丸みは書体ではなく形と余白でつくる。英字メタ情報は補足に限定し、操作に必要な日本語を12px未満にしない。

## 5. Core patterns

### App shell

デスクトップは固定サイドバーと上部の現在地。現在地はピンクの面、通常項目は白い面にする。モバイルは5項目以内のボトムナビへ落とす。

### Primary action

1画面の主役は原則1つ。黄色の面、濃い3px枠、硬い下影を使い、文言は操作結果を動詞で示す。押下時は影を縮めて物理的な反応を返す。

### Cards and tables

白いカードと細い境界を基本とする。業務のまとまりには十分な余白を与えるが、候補者一覧や評価表の密度は維持する。行ホバーは淡いピンク、選択行はピンクの左線と淡い面で示す。

### Forms

ラベルは常に入力欄の上へ置く。入力欄は白、2pxの淡い境界、14px角丸。フォーカスは紫の境界と半透明リング。エラー、必須、補足をプレースホルダーだけで伝えない。

### Progress and state

進捗は数値だけでなく、現在値と次の状態を同時に読めるようにする。完了は色だけに頼らず、状態ラベルと文言を併記する。確度や順位は業務上の事実なので、過剰な報酬演出を加えない。

## 6. Motion

- Hover: 150–220ms、最大3pxの移動
- Press: 硬い影を縮める
- Progress: 約500msで補間
- ナビゲーションの選択: 1回だけ小さく反応
- `prefers-reduced-motion: reduce`では装飾的な動きを停止する

## 7. Accessibility

- `:focus-visible`に3pxの紫アウトラインを出す
- タップ領域は44×44pxを目安にする
- 色だけでactive、error、completeを伝えない
- 本文は12px以上を基本とする
- モーダルはEscapeと閉じる操作を提供する
- 横スクロール領域をキーボードでも辿れるようにする

## 8. Composition recipe

1. クリームのキャンバスと静かなナビゲーションを置く
2. ページ名と現在の期を一つの見出し領域にまとめる
3. 状態の要約を小カードで示す
4. 主タスクを白いカードまたは表で並べる
5. 選択中、主操作、達成済みだけにmomentum colorsを使う
6. 個人情報、長文、管理、検索はfoundation stylingへ戻す
7. モバイルで一列化し、主操作が迷子にならないか確認する

## 9. Do / Don't

### Do

- 一画面に明確な主操作を一つ置く
- 白い余白の中に鮮やかな色をポイントで使う
- 太い枠と硬い影を、触れる要素の合図として統一する
- 表や個人情報は静かな紙面で読みやすくする
- NEOのスペクトラムはロゴと大きなブランド場面に限定する

### Don't

- 全カードを別々の鮮やかな色にしない
- 候補者をゲームの駒や報酬として扱わない
- すべてのボタンに強い影を付けない
- 小さい英字だけで情報構造を成立させない
- 遊び心を理由に、権限・エラー・個人情報の状態を曖昧にしない

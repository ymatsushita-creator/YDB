---
version: alpha
name: Iridescent-Black-design-system
description: >
  A premium black-led interface system built around the brand's
  iridescent mesh gradient. Near-black and white provide the dominant
  structural surfaces, while lime, lemon yellow, coral pink, cyan,
  periwinkle, and lavender blend into a luminous spectral gradient used
  selectively as the primary brand signature. Typography, spacing,
  geometry, and operational UI remain restrained and technical;
  colour carries the emotional identity.

colors:
  # ─── Core ───────────────────────────────────────────────
  primary: "#050505"
  on-primary: "#ffffff"

  ink: "#080808"
  body: "#525252"
  mute: "#8a8a8a"

  # ─── Surfaces ───────────────────────────────────────────
  canvas: "#ffffff"
  canvas-soft: "#fafafa"
  canvas-soft-2: "#f4f4f4"

  canvas-dark: "#050505"
  canvas-dark-soft: "#0d0d0d"
  canvas-dark-2: "#151515"

  hairline: "#e8e8e8"
  hairline-strong: "#b8b8b8"
  hairline-dark: "#262626"
  hairline-dark-strong: "#3a3a3a"

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
  success-deep: "#527C00"

  warning: "#E0AC18"
  warning-soft: "#FFF0BE"
  warning-deep: "#A87700"

  error: "#D95B6D"
  error-soft: "#F9D9DD"
  error-deep: "#AE3448"

  info: "#52B4E1"
  info-soft: "#DDF3FC"
  info-deep: "#267DA6"

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

  selection-bg: "#050505"
  selection-fg: "#ffffff"

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
    fontWeight: 600
    lineHeight: 48px
    letterSpacing: -2.4px

  display-lg:
    fontFamily: Geist, Inter, system-ui, -apple-system, sans-serif
    fontSize: 32px
    fontWeight: 600
    lineHeight: 40px
    letterSpacing: -1.28px

  display-md:
    fontFamily: Geist, Inter, system-ui, -apple-system, sans-serif
    fontSize: 24px
    fontWeight: 600
    lineHeight: 32px
    letterSpacing: -0.96px

  display-sm:
    fontFamily: Geist, Inter, system-ui, -apple-system, sans-serif
    fontSize: 20px
    fontWeight: 600
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
    fontWeight: 500
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
    fontWeight: 500
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
    fontWeight: 500
    lineHeight: 20px

  button-lg:
    fontFamily: Geist, Inter, system-ui, -apple-system, sans-serif
    fontSize: 16px
    fontWeight: 500
    lineHeight: 24px

rounded:
  none: 0px
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
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
    activeIndicator: "{gradients.brand-spectrum}"
    rounded: "{rounded.full}"
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
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-lg}"
    rounded: "{rounded.pill}"
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
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-md}"
    rounded: "{rounded.pill}"
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

## Overview

The visual identity is built around a strict contrast between near-black space and a luminous iridescent spectrum derived directly from the brand mark.

Black is not merely a background colour. It is the dominant structural material of the system. The gradient acts as light moving across that structure.

The signature spectrum moves through lime, lemon yellow, coral pink, cyan, periwinkle, and lavender. Unlike a conventional rainbow or linear gradient, the colours should appear to bleed into one another spatially, creating an atmospheric mesh effect.

No individual hue should become the standalone brand colour.

**The spectrum itself is the brand.**

Most product UI remains intentionally monochrome. Cards, tables, navigation, inputs, operational controls, filters, and dense information surfaces use black, white, and restrained neutral grays.

The spectrum appears only where hierarchy or identity requires it:

- Hero imagery
- Brand moments
- Selected states
- Active indicators
- Focus states
- Major visualizations
- High-priority accents
- Occasional borders or light fields

This produces a visual ratio of approximately **85–90% neutral surface to 10–15% spectral colour**.

Preserving this ratio is essential. Increasing the amount of gradient reduces its perceived value and makes the interface feel decorative rather than premium.

Typography remains geometric, technical, and restrained. Geist carries the narrative layer while Geist Mono carries system labels, metadata, and technical information.

The typography deliberately competes as little as possible with the brand spectrum.

### Key Characteristics

- Near-black is the principal structural colour.
- White remains the dominant operational surface in light contexts.
- The logo-derived iridescent spectrum is the sole major brand decoration.
- Lime → yellow → coral → cyan → periwinkle → lavender forms the canonical colour journey.
- Gradient colours blend spatially rather than appearing as equal-width bands.
- Operational UI remains predominantly monochrome.
- Spectral colour is reserved for identity, state emphasis, focus, and high-level visualization.
- Black and white are equally valid canvases; the gradient bridges the two.
- Geist + Geist Mono preserve the engineered, product-led character of the interface.
- Colour is treated as light, not paint.

---

## Colors

### Structural Black

**Primary / Near Black**  
`{colors.primary}` — `#050505`

The principal structural colour of the system.

Used for:

- Hero surfaces
- Primary CTAs
- Navigation emphasis
- Dark application shells
- Featured cards
- Code environments
- Large polarity-flipped sections

Avoid replacing this with medium charcoal. The extreme contrast against the spectral gradient is a core part of the identity.

### White & Neutral Surfaces

**Canvas**  
`{colors.canvas}` — `#ffffff`

Primary light surface for cards, forms, dialogs, data tables, and application UI.

**Canvas Soft**  
`{colors.canvas-soft}` — `#fafafa`

Default soft page surface.

**Canvas Soft 2**  
`{colors.canvas-soft-2}` — `#f4f4f4`

Inset areas, hover surfaces, disabled areas, and nested containers.

### Dark Surface Ladder

- `{colors.canvas-dark}` — `#050505`
- `{colors.canvas-dark-soft}` — `#0d0d0d`
- `{colors.canvas-dark-2}` — `#151515`

Dark interfaces should still preserve surface hierarchy. Do not render every dark element as the same black rectangle.

### Neutral Text

- `{colors.ink}` — `#080808`
- `{colors.body}` — `#525252`
- `{colors.mute}` — `#8a8a8a`
- `{colors.on-primary}` — `#ffffff`

Use strong contrast for information hierarchy rather than introducing additional colours.

---

## Brand Spectrum

The signature palette is derived from the attached brand mark.

### Lime

`{colors.brand-lime}` — `#B6CF0B`

The sharpest and most energetic hue in the spectrum.

It should normally exist as part of a gradient rather than as a standalone large surface.

### Yellow

`{colors.brand-yellow}` — `#F1D370`

Acts as the warm bridge between lime and coral.

The yellow should feel warm and luminous rather than orange.

### Coral

`{colors.brand-coral}` — `#ED808A`

Forms the principal warm transition zone between yellow and the cooler spectral region.

### Pink

`{colors.brand-pink}` — `#F1849A`

Used as a secondary transition hue around coral. It should rarely appear as an isolated brand accent.

### Cyan

`{colors.brand-cyan}` — `#52B4E1`

Provides the strongest cool contrast to the warm yellow and coral region.

Cyan may also be used sparingly for focus indicators and links where a conventional interactive colour is required.

### Periwinkle

`{colors.brand-periwinkle}` — `#7A86BF`

Acts as the bridge between cyan and lavender.

Its muted character prevents the cool end of the spectrum from becoming overly saturated.

### Lavender

`{colors.brand-lavender}` — `#9C82C8`

The terminal cool hue in the canonical brand journey.

It works particularly well when the gradient fades into black.

---

## Brand Gradient

The primary brand asset is an **iridescent mesh spectrum** derived directly from the logo.

Canonical colour family:

- Lime — `#B6CF0B`
- Warm Yellow — `#F1D370`
- Coral Pink — `#ED808A`
- Pink — `#F1849A`
- Sky Cyan — `#52B4E1`
- Periwinkle — `#7A86BF`
- Lavender — `#9C82C8`

The gradient must not behave like a conventional rainbow.

Avoid evenly distributed colour bands.

Instead, treat each colour as a soft light source whose influence overlaps neighbouring hues.

The warm and cool regions should remain perceptible:

**Warm**

`Lime → Yellow → Coral`

**Cool**

`Cyan → Periwinkle → Lavender`

The two regions may intersect through pale yellow, aqua, muted pink, soft blue, or desaturated transition zones.

Black should remain visible around the gradient whenever possible.

The perceived brightness of the spectrum comes from contrast with the black field.

### Gradient Behaviour

Preferred:

- Mesh gradients
- Multi-radial gradients
- Blurred overlapping colour fields
- Organic direction changes
- Unequal colour distribution
- Soft transitions
- Partial fade into black
- Large atmospheric scale

Avoid:

- Equal-width rainbow stripes
- Standard seven-colour rainbow order
- Hard colour boundaries
- Highly repetitive gradient chips
- Filling every component with the spectrum
- Tiny gradients where individual colours cannot breathe

### Suggested CSS Construction

A production implementation may use several overlapping radial gradients rather than a single linear gradient.

Example direction:

```css
background:
  radial-gradient(
    circle at 12% 18%,
    rgba(182, 207, 11, 0.95),
    transparent 30%
  ),
  radial-gradient(
    circle at 36% 62%,
    rgba(241, 211, 112, 0.95),
    transparent 34%
  ),
  radial-gradient(
    circle at 51% 42%,
    rgba(237, 128, 138, 0.88),
    transparent 34%
  ),
  radial-gradient(
    circle at 67% 28%,
    rgba(82, 180, 225, 0.92),
    transparent 36%
  ),
  radial-gradient(
    circle at 83% 38%,
    rgba(122, 134, 191, 0.92),
    transparent 34%
  ),
  radial-gradient(
    circle at 96% 18%,
    rgba(156, 130, 200, 0.92),
    transparent 32%
  ),
  #050505;

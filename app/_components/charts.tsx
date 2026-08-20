import { md } from './ui.tsx'

/**
 * サーバで SVG を組み立てる。図のためだけにクライアント側の
 * チャートライブラリを積むと、初期表示にその分だけ遅れが乗る。
 */

const W = 900
const H = 260
const PAD = { top: 16, right: 16, bottom: 28, left: 48 }

interface Series<T> {
  key: keyof T
  label: string
  color: string
  dashed?: boolean
}

/**
 * 目盛りを人間が読める刻みに丸める。
 *
 * 返す最後の値が軸の上端になる。**必ず max 以上にすること。**
 * max で打ち切ると上端がデータ最大値を下回り、上の方の点が y &lt; 0 に落ちて
 * viewBox の外に描かれる。SVG は既定で overflow: hidden なので、
 * エラーも警告もなく折れ線の頭が切れる。実際にそうなっていた。
 *
 * 刻みは1以上の整数に丸める。人数・件数を数えるチャートなので、
 * 0.25 のような刻みは目盛りラベルが重複するだけで読めない。
 */
function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1]
  const magnitude = 10 ** Math.floor(Math.log10(max / count))
  const candidate =
    [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s * count >= max) ?? magnitude * 10
  const step = Math.max(1, Math.round(candidate))

  const ticks: number[] = []
  for (let v = 0; v < max; v += step) ticks.push(v)
  ticks.push(ticks.length > 0 ? ticks[ticks.length - 1]! + step : step)
  return ticks
}

/**
 * 横棒（ホームのサマリー。実行⑫。依頼者の指示「ビジュアライズ」）。
 *
 * ★ 表をやめて絵にするための最小の部品。**数は右端に出す** ――
 *   絵だけにすると「だいたい多い」しか分からず、記録を読む道具として使えない。
 *
 * ★ 面は塗るが、色は使わない（「色は線、面は黒」。C-71）。
 *   長さで比べさせる図なので、濃さも変えない ―― 変えると意味が2つになる。
 */
export function BarList({
  items, max, unit,
}: {
  items: Array<{ label: string; value: number; note?: string }>
  /** 目盛りの上端。省略すると一番大きい値。**0 のときは 1 にする。** */
  max?: number
  unit?: string
}) {
  const top = Math.max(1, max ?? Math.max(...items.map((i) => i.value), 0))
  return (
    <ul className="bar-list">
      {items.map((i) => (
        <li key={i.label}>
          <span className="bar-label" title={i.label}>{i.label}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${(i.value / top) * 100}%` }} />
          </span>
          <span className="bar-value">
            {i.value.toLocaleString('ja-JP')}{unit}
            {i.note && <span className="bar-note"> {i.note}</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * 内訳を1本の帯で出す（面接の判定など）。
 *
 * ★ 区切りは**線**で入れる。色分けしない ―― 凡例を読まないと分からない図に
 *   なるからで、代わりに**各区画の中に語と数を書く**（入らない幅なら下に置く）。
 */
export function StackedBar({
  parts,
}: { parts: Array<{ label: string; value: number }> }) {
  const total = parts.reduce((n, p) => n + p.value, 0)
  if (total === 0) return <p className="hh-empty">まだ1件も無い。</p>
  return (
    <>
      <div className="stack-bar">
        {parts.filter((p) => p.value > 0).map((p) => (
          <span key={p.label} className="stack-seg"
                style={{ width: `${(p.value / total) * 100}%` }}>
            <span className="stack-seg-text">{p.value}</span>
          </span>
        ))}
      </div>
      <ul className="stack-legend">
        {parts.map((p) => (
          <li key={p.label}>
            <span className="stack-key" />{p.label}
            <strong>{p.value}</strong>
          </li>
        ))}
      </ul>
    </>
  )
}

/**
 * 割合の輪（記入済み・確度など）。
 *
 * ★ SVG をサーバで組み立てる（この製品の図はすべてそう）。
 *   真ん中に数を置く ―― **輪だけでは読み取れない。**
 */
export function Ring({
  ratio, label, caption,
}: { ratio: number; label: string; caption?: string }) {
  const r = 42
  const c = 2 * Math.PI * r
  const filled = Math.max(0, Math.min(1, ratio))
  return (
    <div className="ring">
      <svg viewBox="0 0 100 100" role="img" aria-label={`${label} ${Math.round(filled * 100)}%`}>
        <circle cx="50" cy="50" r={r} className="ring-track" />
        <circle cx="50" cy="50" r={r} className="ring-fill"
                strokeDasharray={`${c * filled} ${c}`} transform="rotate(-90 50 50)" />
        <text x="50" y="52" className="ring-value">{Math.round(filled * 100)}%</text>
      </svg>
      <span className="ring-label">{label}</span>
      {caption && <span className="ring-caption">{caption}</span>}
    </div>
  )
}

export function TimeSeries<T extends { as_of: Date }>({
  points, series, height = H, valueLabel,
}: { points: T[]; series: Series<T>[]; height?: number; valueLabel: string }) {
  if (points.length < 2) {
    return <p className="empty">系列を描くだけの日数がまだない</p>
  }

  const maxValue = Math.max(
    1, ...points.flatMap((p) => series.map((s) => Number(p[s.key]))))
  const ticks = niceTicks(maxValue)
  const top = ticks[ticks.length - 1]!

  const innerW = W - PAD.left - PAD.right
  const innerH = height - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + (i / (points.length - 1)) * innerW
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH

  // 目盛りラベルが潰れない程度に間引く。
  // 末尾は必ず出したいが、直前のラベルと近すぎると重なって読めなくなる。
  const labelEvery = Math.max(1, Math.ceil(points.length / 8))
  const last = points.length - 1
  const showLast = last % labelEvery > labelEvery / 2
  const isLabelled = (i: number) =>
    i === last ? showLast : i % labelEvery === 0 && (showLast || last - i > labelEvery / 2)

  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" role="img"
         aria-label={`${valueLabel}の日次推移`} style={{ display: 'block' }}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)}
                stroke="var(--color-hairline-soft)" strokeWidth={1} />
          <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end"
                fontSize={11} fill="var(--color-stone)">{t}</text>
        </g>
      ))}

      {points.map((p, i) =>
        isLabelled(i) ? (
          <text key={md(p.as_of)} x={x(i)} y={height - 8} textAnchor="middle"
                fontSize={11} fill="var(--color-stone)">
            {md(p.as_of)}
          </text>
        ) : null,
      )}

      {series.map((s) => (
        <polyline
          key={String(s.key)}
          fill="none"
          stroke={s.color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          strokeDasharray={s.dashed ? '4 3' : undefined}
          points={points.map((p, i) => `${x(i)},${y(Number(p[s.key]))}`).join(' ')}
        />
      ))}
    </svg>
  )
}

export function Legend<T>({ series }: { series: Series<T>[] }) {
  return (
    <div className="legend" style={{ marginTop: 12 }}>
      {series.map((s) => (
        <span key={String(s.key)} className="legend-item">
          <span className="dot" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  )
}

/**
 * 到達状態のバー。接点継続中は人、応募・合格は応募件数のため
 * 同じ折れ線には載せない。
 *
 * 転換率は単位が揃っている状態間だけ出す。接点継続中（人）と応募（件）の
 * 割り算は showRatio: false で抑える。日次断面では接点継続中がローリング
 * 接点継続中が移動窓、応募が年度累積で、母集団の定義そのものが日ごとに違うため、
 * 割った値に意味がない。年度単位の接点継続中 → 応募は別指標として出す。
 */
export function FunnelStages({
  stages,
}: {
  stages: Array<{
    label: string; value: number; note?: string; color: string; showRatio?: boolean
  }>
}) {
  const top = Math.max(1, ...stages.map((s) => s.value))
  return (
    <div className="stack" style={{ gap: 14 }}>
      {stages.map((s, i) => {
        const prev = i > 0 && s.showRatio !== false ? stages[i - 1]!.value : null
        return (
          <div key={s.label}>
            <div className="row-between" style={{ marginBottom: 4 }}>
              <span style={{ fontWeight: 500 }}>
                {s.label}
                {s.note && <span className="section-note"> {s.note}</span>}
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {s.value.toLocaleString('ja-JP')}
                {prev !== null && prev > 0 && (
                  <span className="section-note">
                    {'  '}← {((s.value / prev) * 100).toFixed(1)}%
                  </span>
                )}
              </span>
            </div>
            <div className="meter" style={{ height: 10 }}>
              <div className="meter-fill"
                   style={{ width: `${(s.value / top) * 100}%`, background: s.color }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

import type { FunnelPoint } from '../../src/queries/dashboard.ts'
import { md } from './ui.tsx'

/**
 * サーバで SVG を組み立てる。図のためだけにクライアント側の
 * チャートライブラリを積むと、初期表示にその分だけ遅れが乗る。
 */

const W = 900
const H = 260
const PAD = { top: 16, right: 16, bottom: 28, left: 48 }

interface Series {
  key: keyof FunnelPoint
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

export function TimeSeries({
  points, series, height = H, valueLabel,
}: { points: FunnelPoint[]; series: Series[]; height?: number; valueLabel: string }) {
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
          <text key={i} x={x(i)} y={height - 8} textAnchor="middle"
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

export function Legend({ series }: { series: Series[] }) {
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
 * 段のバー。林・木・幹は単位が違う（林は人、木と幹は応募）ため
 * 同じ折れ線には載せない。
 *
 * 転換率は単位が揃っている段の間でだけ出す。林（人）と木（応募）の間の
 * 割り算は showRatio: false で抑える。日次断面では林がローリング
 * ウィンドウ、木が年度累積で、母集団の定義そのものが日ごとに違うため、
 * 割った値に意味がない。年度単位の 林 → 木 は別指標として出す。
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

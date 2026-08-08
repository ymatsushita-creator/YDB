/**
 * ヘッドハンティング画面の部品（実行⑨）。
 *
 * ここに SQL は書かない。データは src/queries/headhunting.ts が取る。
 * 数の加工もしない。渡された値を、単位を添えて置くだけにする。
 */

/** アプローチ状態のチップ。色だけで意味を伝えず、必ず文字を持つ。 */
const APPROACH_CHIP: Record<string, string> = {
  approaching: 'chip-green',
  scheduling: 'chip-blue',
  considering: 'chip-amber',
  not_approached: 'chip-gray',
}

export function ApproachChip({ code, label }: { code: string; label: string }) {
  return <span className={APPROACH_CHIP[code] ?? 'chip-gray'}>{label}</span>
}

/**
 * 順位。上位3位だけ王冠を付ける。
 *
 * 画像は3位まで王冠だった。4位以下は数字のまま。
 * 王冠に数字を重ねないのは、色覚に依らず順位が読めるようにするため。
 */
export function RankMark({ rank }: { rank: number }) {
  return (
    <span className="rank-mark">
      {rank <= 3 && <span className={`rank-crest rank-crest-${rank}`} aria-hidden>♛</span>}
      <span className="rank-number">{rank}</span>
    </span>
  )
}

/**
 * 前回からの順位の変動。
 *
 * **「変動なし」と「前回が無い」を同じ記号にしない。**
 * 前回が無いのに「—」と出すと、動かなかったように読める。
 * 算出が1回しか行われていない年度では、全員が「前回なし」になる。
 */
export function RankDelta({
  delta, hasPrevious,
}: { delta: number | null; hasPrevious: boolean }) {
  if (!hasPrevious || delta === null) {
    return <span className="rank-delta rank-delta-none">前回なし</span>
  }
  if (delta === 0) return <span className="rank-delta rank-delta-flat">変動なし</span>
  const up = delta > 0
  return (
    <span className={`rank-delta ${up ? 'rank-delta-up' : 'rank-delta-down'}`}>
      {up ? '↑' : '↓'}{Math.abs(delta)}
    </span>
  )
}

/**
 * 評価の星。
 *
 * 星は5つ固定で、満点に対する比を塗る。**軸の満点は年度で違う**
 * （16点満点の軸もあれば5点満点の軸もある）ので、比に直してから描く。
 * 星の隣に必ず素点を出す。絵だけにすると、丸めた見た目が事実になる
 * （実行⑥で「表示の丸めで注記が嘘になる」を踏んでいる）。
 */
export function Stars({ score, scaleMax }: { score: number; scaleMax: number }) {
  const ratio = scaleMax > 0 ? Math.min(1, Math.max(0, score / scaleMax)) : 0
  return (
    <span className="stars" role="img" aria-label={`${scaleMax}点中 ${score}点`}>
      <span className="stars-off" aria-hidden>★★★★★</span>
      <span className="stars-on" style={{ width: `${ratio * 100}%` }} aria-hidden>★★★★★</span>
    </span>
  )
}

/** 確度。規則が未登録なら「—」ではなく、その旨を出す。 */
export function Confidence({ ratio }: { ratio: number | null }) {
  if (ratio === null) return <span className="muted-note">規則未登録</span>
  return <span className="confidence">{(ratio * 100).toFixed(0)}%</span>
}

/**
 * やることの一文。画面には内部の識別子を出さない（C-32 / C-37）。
 *
 * 種別ごとに助詞が違う。「〜を評価する」と「〜の担当を決める」を
 * 1つの型で作ると「書類選考を担当を決める」になる。
 * 短い文ほど、助詞の間違いがそのまま読みにくさになる。
 */
export function taskSentence(kind: string, person: string, step: string): string {
  switch (kind) {
    case 'evaluate': return `${person} さんの${step}を評価する`
    case 'assign': return `${person} さんの${step}の担当を決める`
    case 'reassign': return `${person} さんの${step}の担当を替える`
    case 'unhold': return `${person} さんの${step}の保留を解く`
    default: return `${person} さんの${step}`
  }
}

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
  // ★ 順位の算出をやめたので、**全行が「前回なし」**になっていた（C-206。
  //   実画面で確認）。並んでも何も伝えないので、何も出さない。
  //   ★ 「変動なし」との取り違えは起きない ―― そちらは出し続ける。
  if (!hasPrevious || delta === null) return null
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
  // ★ 確度は 0039 で**人が記入する**ものになった（C-151）。
  //   「規則未登録」は算出していた頃の言い方で、いまは意味を持たない
  //   ―― 全行に並んで、読む人の目を潰していた（C-205。実画面で確認）。
  if (ratio === null) return <span className="muted-note">未記入</span>
  return <span className="confidence">{(ratio * 100).toFixed(0)}%</span>
}

/**
 * やることの一文。画面には内部の識別子を出さない（C-32 / C-37）。
 *
 * 種別ごとに助詞が違う。「〜を評価する」と「〜の担当を決める」を
 * 1つの型で作ると「書類選考を担当を決める」になる。
 * 短い文ほど、助詞の間違いがそのまま読みにくさになる。
 */
import Link from 'next/link'
import { Avatar } from './borderline.tsx'

export function taskSentence(kind: string, person: string, step: string): string {
  switch (kind) {
    case 'evaluate': return `${person} さんの${step}を評価する`
    case 'assign': return `${person} さんの${step}の担当を決める`
    case 'reassign': return `${person} さんの${step}の担当を替える`
    case 'unhold': return `${person} さんの${step}の保留を解く`
    default: return `${person} さんの${step}`
  }
}

/**
 * 候補者名/行のホバー時に顔写真・名前・確度・欲しい度を表示するポップオーバーカード。
 * クリックで直接詳細画面 (/people/${personId}) へ遷移する。
 */
export function PersonHoverCard({
  personId,
  seasonId,
  name,
  photoUrl,
  gradeCode,
  confidenceRatio,
  score100,
  children,
  className = '',
}: {
  personId: string
  seasonId: string
  name: string
  photoUrl?: string | null
  gradeCode?: string | null
  confidenceRatio?: number | null
  score100?: number | string | null
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`person-hover-wrapper ${className}`}>
      <Link href={`/people/${personId}?season=${seasonId}`} className="bl-person">
        {children}
      </Link>
      <div className="person-hover-card" role="tooltip">
        <div className="person-hover-card-head">
          <Avatar src={photoUrl ?? null} name={name} />
          <div className="person-hover-card-identity">
            <span className="person-hover-card-name">{name}</span>
            <span className="person-hover-card-link">詳細画面を開く ›</span>
          </div>
        </div>
        <div className="person-hover-card-metrics">
          <div className="person-hover-card-metric">
            <span className="person-hover-card-label">確度</span>
            <span className="person-hover-card-value">
              {gradeCode ? (
                <span className={`conf-mark conf-${gradeCode}`}>{gradeCode}</span>
              ) : confidenceRatio !== undefined && confidenceRatio !== null ? (
                <Confidence ratio={confidenceRatio} />
              ) : (
                <span className="muted-note">未記入</span>
              )}
            </span>
          </div>
          <div className="person-hover-card-metric">
            <span className="person-hover-card-label">欲しい度</span>
            <span className="person-hover-card-value strong">
              {score100 !== undefined && score100 !== null ? (
                `${score100} 点`
              ) : (
                <span className="muted-note">評価なし</span>
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}


/**
 * 画面の呼び名と、帯の判定（実行⑪で `shell.tsx` から出した）。
 *
 * ★ **`.ts` に置く。** テストランナー（node --test）は `.tsx` を読めないので、
 *   `.tsx` の中に判定を書くと、その判定はテストで固定できない。
 *   画面の形は `shell.tsx`、決め方はここ。
 */

export interface Crumb {
  label: string
  /** 押すとその階層へ戻る。現在地（末尾）は href を持たない。 */
  href?: string
}

/**
 * 年度の呼び名。**期があれば期、無ければ年度。**
 *
 * 期は運営が数える番号で、年度からは導けない（募集を休んだ年があると
 * 番号がずれる）。分からない年度を 0 期や 1 期で埋めない。
 * 呼び方をここ1箇所に置くのは、画面ごとに違う呼び方をしないため。
 *
 * ★ デモ期は**「デモ期」としか呼ばない**（0029）。年（9999）を出すと、
 *   実在しない年度が実在の期と同じ顔で並ぶ。
 */
export const seasonLabel = (
  s: { cohort_number: number | null; enrollment_year: number; is_demo?: boolean },
) => (s.is_demo ? 'デモ期'
  : s.cohort_number !== null ? `${s.cohort_number}期` : `${s.enrollment_year}年度`)

/**
 * 「戻る」の行き先 ―― **現在地のすぐ上で、押せる段。**
 *
 * 末尾は現在地なので外す。そこから上へ辿り、最初に見つかった `href` を返す。
 * 押せる段が1つも無ければ null（＝その画面に戻る先は無い）。
 *
 * ★ ブラウザの履歴を戻すのではない。履歴で戻ると、保存の直後は
 *   「保存する前の画面」へ戻り、同じ操作をもう一度送ってしまう。
 *   階層は URL から決まるので、どこから来ても同じ場所へ戻る。
 */
export const backHref = (segments: Crumb[]): string | null => {
  for (let i = segments.length - 2; i >= 0; i -= 1) {
    const href = segments[i]?.href
    if (href) return href
  }
  return null
}

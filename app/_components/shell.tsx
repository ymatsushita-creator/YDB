import type { ReactNode } from 'react'
import Link from 'next/link'
import { isDemoMode } from '../../src/db/server.ts'
import type { Season } from '../../src/queries/dashboard.ts'
import { signOutAction } from '../login/actions.ts'

/**
 * アプリ全体の外枠（実行⑨で全画面共通にした）。
 *
 * ★ 階層は「年度 → タブ → 対象」である。**年度が一番上。**
 *
 *   上の帯   … いま開いている階層（`2026 年度 › ヘッドハンティング › 渡辺 蓮`）
 *   左の操作柱 … タブ3つ。**その一番下で年度を切り替える**
 *
 * 年度を切り替える場所と、年度を表示する場所は別である。
 * 切り替えは稀な操作なので操作柱の隅に置き、いまどの年度を見ているかは
 * 常時の関心なので帯の先頭に出す。**頻度の低い操作を主役の場所に置かない。**
 *
 * ★ 行き先は4つ。ファネル・アプローチ可能圏・選考オペレーションなどは
 *   **タブから外した**（消したのではなく、タブの中に畳んだ）。
 *   4つ目の「面接」は実行⑩で依頼者の指示により足した。
 *
 * ★ `'use client'` は使っていない。
 *   いま居るタブと年度を知るために `usePathname()` / `useSearchParams()` を
 *   使うとクライアント境界が要る。代わりに**各画面が自分でこの外枠を被る**。
 *   layout.tsx に置くと、レイアウトは searchParams を受け取れないので
 *   「いまどの年度か」を知る手段が無くなり、年度の切替を操作柱に置けない。
 */

export type Tab = 'headhunting' | 'borderline' | 'approach' | 'interview'

const TABS: Array<{ id: Tab; href: string; label: string; note: string }> = [
  { id: 'headhunting', href: '/headhunting', label: 'ヘッドハンティング', note: '誰に声を掛けるか' },
  { id: 'borderline', href: '/borderline', label: 'ボーダーライン', note: '誰を通すか' },
  { id: 'approach', href: '/approach', label: 'アプローチ', note: 'どこから来ているか' },
  // 面接はアプローチの下（依頼者の指示。実行⑩）。
  { id: 'interview', href: '/interviews', label: '面接', note: '何を見て決めたか' },
]

export function Shell({
  active, years, seasonId, children,
}: {
  active: Tab
  /** 操作柱の一番下に置く年度の切替。年度を持たない画面では省略する。 */
  years?: ReactNode
  /**
   * いま見ている期。**タブに持ち回る。**
   *
   * ★ 渡さないと、タブを押した先で期が既定（進行中の期）へ戻る。
   *   実際、2期を見ているときにヘッドハンティングを押すと3期になっていた。
   *   期はタブより**上の層**なので、タブを移っても保たれなければならない。
   *
   * 期を持たない画面（その人の記録など）では省略する。
   */
  seasonId?: string
  children: ReactNode
}) {
  const tabHref = (href: string) =>
    (seasonId ? `${href}?season=${seasonId}` : href)

  return (
    <div className="hh-frame">
      <aside className="sidebar-region hh-sidebar">
        <div className="hh-brand">
          {/* グラデーション版（依頼者の指示。実行⑩）。
              **ロゴを変形・着色・装飾しない。** 比は 1283:305 で固定し、
              高さは `--logo-h` に反映してある。 */}
          <img
            className="hh-brand-logo"
            src="/brand/logo_gradient.png"
            width={1283} height={305}
            alt="NEO ACADEMIA"
          />
        </div>

        <nav className="hh-nav" aria-label="主なナビゲーション">
          {TABS.map((t) => (
            <Link
              key={t.id}
              href={tabHref(t.href)}
              className={t.id === active ? 'sidebar-item-active btn-physical' : 'sidebar-item btn-physical'}
              aria-current={t.id === active ? 'page' : undefined}
            >
              <span>{t.label}</span>
              <em>{t.note}</em>
            </Link>
          ))}
        </nav>

        {/*
          名前で検索。素の <form> なので JS が無くても動く。
          結果は人の一覧へ渡す（氏名を URL に載せるが、これは利用者自身が
          打った検索語である。判定の結果を URL に載せないという規律とは別）。
        */}
        <form className="hh-search" action="/people" method="get" role="search">
          {/* 検索も期を持ち回る。押した先で期が変わると、
              「2期を見ていたのに3期の結果が出る」ことになる。 */}
          {seasonId && <input type="hidden" name="season" value={seasonId} />}
          <label className="sidebar-section-label" htmlFor="hh-q">名前で検索</label>
          <div className="hh-search-row">
            <input
              id="hh-q" className="hh-search-input" type="search" name="q"
              placeholder="名前を入力..." autoComplete="off"
            />
            <button className="btn-physical hh-search-go" type="submit">探す</button>
          </div>
        </form>

        <div className="hh-sidebar-foot">
          {years}
          {/*
            デモかどうかは、URL を渡された人には確かめる手段が無い。
            出さなければ「実在の候補者が並んでいる」と読める。
          */}
          {isDemoMode()
            ? <p className="hh-demo">デモ ・ 架空データ ・ 保存されません</p>
            : <p className="hh-live">運用中</p>}
          {/* 出る。合言葉は共有なので、**共用の端末では必ず出る。** */}
          <form action={signOutAction}>
            <button type="submit" className="hh-signout">出る</button>
          </form>
        </div>
      </aside>

      <div className="hh-main">{children}</div>
    </div>
  )
}

/**
 * 年度の呼び名。**期があれば期、無ければ年度。**
 *
 * 期は運営が数える番号で、年度からは導けない（募集を休んだ年があると
 * 番号がずれる）。分からない年度を 0 期や 1 期で埋めない。
 * 呼び方をここ1箇所に置くのは、画面ごとに違う呼び方をしないため。
 */
export const seasonLabel = (s: { cohort_number: number | null; enrollment_year: number }) =>
  s.cohort_number !== null ? `${s.cohort_number}期` : `${s.enrollment_year}年度`

export interface Crumb {
  label: string
  /** 押すとその階層へ戻る。現在地（末尾）は href を持たない。 */
  href?: string
}

/**
 * 上の帯 —— **いま開いている階層**（エクスプローラのパス）。
 *
 * ★ ここは「切り替える場所」ではなく「いまどこを開いているかを示す場所」である。
 *
 * 最初の版はここに年度のボタンを並べていた。依頼者の指摘で直した ――
 * **一番よく見える場所から年度を変えられる必要はない。** 年度を変えるのは
 * 稀な操作で、いま何を開いているかを知るのは常時の関心である。
 * 頻度の低い操作を一番目立つ場所に置くと、常時の関心がその分だけ隠れる。
 *
 * 年度の切り替えは操作柱の一番下（`YearSwitch`）に置いてある。
 *
 * ★ 先頭は年度である。押せない ―― ファイルパスのドライブ名と同じで、
 *   「どこを見ているか」の根であって行き先ではない。
 *
 * 押せる段は1つ上へ戻る。**末尾は押せない** ―― 押しても何も起きない
 * ボタンは壊れていると読まれる。末尾の `href` は渡されても無視する
 * （画面ごとに「最後だけ href を外す」条件を書かせると必ずどこかで漏れる）。
 */
export function Breadcrumb({
  root, crumbs,
}: {
  /** 先頭に置く根（期の呼び名）。押せない。 */
  root?: string
  crumbs: Crumb[]
}) {
  const segments: Crumb[] = root === undefined
    ? crumbs
    : [{ label: root }, ...crumbs]
  return (
    <nav className="zoom-bar" aria-label="いま開いている階層">
      {segments.map((c, i) => {
        const isLast = i === segments.length - 1
        const isRoot = root !== undefined && i === 0
        return (
          <span key={`${c.label}-${i}`} className="zoom-seg">
            {i > 0 && <span className="zoom-sep" aria-hidden>›</span>}
            {isRoot
              ? <span className="zoom-root">{c.label}</span>
              : c.href && !isLast
                ? <Link href={c.href} className="zoom-crumb btn-physical">{c.label}</Link>
                : <span className="zoom-crumb-current" aria-current="page">{c.label}</span>}
          </span>
        )
      })}
    </nav>
  )
}

/**
 * 年度の切り替え —— **操作柱の一番下。** 目立たない場所に置く。
 *
 * ★ 年度は記録層にある行だけを並べる。**募集が行われていない年度は出さない。**
 *   架空の年度を並べると、運営に「その年度の記録がどこかにある」と思わせる。
 *
 * `basePath` を各画面が渡すのは、年度を切り替えても同じタブに留まるため。
 * ここで `/headhunting` に固定すると、ボーダーラインで年度を変えた人が
 * ヘッドハンティングへ飛ばされる。
 *
 * 年度が1つしか無ければ切り替える先が無いので、何も出さない。
 * 選択肢が1つだけの切替は、操作できるように見えて操作できない。
 */
export function YearSwitch({
  seasons, currentId, basePath,
}: { seasons: Season[]; currentId: string; basePath: string }) {
  if (seasons.length <= 1) return null
  return (
    <div className="hh-years">
      <span className="sidebar-section-label">期</span>
      <div className="hh-years-row">
        {seasons.map((s) => (
          <Link
            key={s.id}
            href={`${basePath}?season=${s.id}`}
            className={s.id === currentId ? 'hh-year is-on' : 'hh-year'}
            aria-current={s.id === currentId ? 'page' : undefined}
          >
            {/* 募集中の点（`is_live`）は出さない。依頼者の指示で外した。 */}
            {seasonLabel(s)}
          </Link>
        ))}
      </div>
    </div>
  )
}

import type { ReactNode } from 'react'
import Link from 'next/link'
import { isDemoMode } from '../../src/db/server.ts'
import type { Season } from '../../src/queries/dashboard.ts'

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
 * ★ 行き先は3つだけ。ファネル・アプローチ可能圏・選考オペレーションなどは
 *   **タブから外した**（消したのではなく、3つのタブの中に畳んだ）。
 *
 * ★ `'use client'` は使っていない。
 *   いま居るタブと年度を知るために `usePathname()` / `useSearchParams()` を
 *   使うとクライアント境界が要る。代わりに**各画面が自分でこの外枠を被る**。
 *   layout.tsx に置くと、レイアウトは searchParams を受け取れないので
 *   「いまどの年度か」を知る手段が無くなり、年度の切替を操作柱に置けない。
 */

export type Tab = 'headhunting' | 'borderline' | 'approach'

const TABS: Array<{ id: Tab; href: string; label: string; note: string }> = [
  { id: 'headhunting', href: '/headhunting', label: 'ヘッドハンティング', note: '誰に声を掛けるか' },
  { id: 'borderline', href: '/borderline', label: 'ボーダーライン', note: '誰を通すか' },
  { id: 'approach', href: '/approach', label: 'アプローチ', note: 'どこから来ているか' },
]

export function Shell({
  active, years, children,
}: {
  active: Tab
  /** 操作柱の一番下に置く年度の切替。年度を持たない画面では省略する。 */
  years?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="hh-frame">
      <aside className="sidebar-region hh-sidebar">
        <div className="hh-brand">
          <strong>YouthDB</strong>
          <span className="sidebar-section-label">TALENT INTELLIGENCE</span>
        </div>

        <nav className="hh-nav" aria-label="主なナビゲーション">
          {TABS.map((t) => (
            <Link
              key={t.id}
              href={t.href}
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
        </div>
      </aside>

      <div className="hh-main">{children}</div>
    </div>
  )
}

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
  year, crumbs, readOnly,
}: {
  year?: number
  crumbs: Crumb[]
  /**
   * この画面には書き込む場所が1つも無い、という宣言。
   *
   * 記入できる領域は面の色で分かるが、**「この画面には書ける場所が
   * 無い」ことは、無いものを見て気づけない。** 探させないために書く。
   * 各画面が自分で名乗る（数えて自動判定すると、フォームを足した日に
   * 表示だけ古くなる）。
   */
  readOnly?: boolean
}) {
  const segments: Crumb[] = year === undefined
    ? crumbs
    : [{ label: `${year} 年度` }, ...crumbs]
  return (
    <nav className="zoom-bar" aria-label="いま開いている階層">
      {segments.map((c, i) => {
        const isLast = i === segments.length - 1
        const isRoot = year !== undefined && i === 0
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
      {readOnly && <span className="readonly-note">この画面は記録を映すだけ</span>}
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
      <span className="sidebar-section-label">年度</span>
      <div className="hh-years-row">
        {seasons.map((s) => (
          <Link
            key={s.id}
            href={`${basePath}?season=${s.id}`}
            className={s.id === currentId ? 'hh-year is-on' : 'hh-year'}
            aria-current={s.id === currentId ? 'page' : undefined}
          >
            {s.enrollment_year}
            {s.is_live && <i className="zoom-live" aria-label="募集中" />}
          </Link>
        ))}
      </div>
    </div>
  )
}

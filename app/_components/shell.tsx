import type { ReactNode } from 'react'
import Link from 'next/link'
import { isDemoMode } from '../../src/db/server.ts'
import type { Season } from '../../src/queries/dashboard.ts'

/**
 * アプリ全体の外枠（実行⑨で全画面共通にした）。
 *
 * ★ 階層は2段で、どちらも最上位にある。
 *
 *   左の操作柱 … ヘッドハンティング / ボーダーライン / アプローチ の3つ
 *   上の帯     … 年度。**どのタブに居ても同じ場所で切り替わる**
 *
 * 実行⑨の最初の版は、年度をヘッドハンティングの下の階層に置いていた。
 * 依頼者の指摘で直した ―― 年度はタブより下ではない。同じ年度のまま
 * タブを移れないと、タブごとに「いまどの年度を見ているか」が変わり、
 * 3つのタブが別のアプリになる。
 *
 * ★ 行き先は3つだけ。ファネル・アプローチ可能圏・選考オペレーションなどは
 *   **タブから外した**（消したのではなく、3つのタブの中に畳んだ）。
 *   各画面がどのタブに属するかは、その画面の layout.tsx が宣言する。
 *
 * ★ `'use client'` は使っていない。
 *   いま居るタブを知るために `usePathname()` を使うとクライアント境界が
 *   要る。代わりに**各ルートの layout.tsx が自分のタブを名乗る**形にした。
 *   境界を1つも増やさずに済み、しかも「この画面はどのタブの一部か」が
 *   ファイルに書かれるので、畳んだ先が読んで分かる。
 */

export type Tab = 'headhunting' | 'borderline' | 'approach'

const TABS: Array<{ id: Tab; href: string; label: string; note: string }> = [
  { id: 'headhunting', href: '/headhunting', label: 'ヘッドハンティング', note: '誰に声を掛けるか' },
  { id: 'borderline', href: '/borderline', label: 'ボーダーライン', note: '誰を通すか' },
  { id: 'approach', href: '/approach', label: 'アプローチ', note: 'どこから来ているか' },
]

export function Shell({ active, children }: { active: Tab; children: ReactNode }) {
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
 * 年度の切り替えは操作柱の下（`YearSwitch`）に置いてある。
 *
 * 押せる段は1つ上へ戻る。**現在地（末尾）は押せない** ―― 押しても
 * 何も起きないボタンは、壊れていると読まれる。
 */
export function Breadcrumb({ crumbs, aside }: { crumbs: Crumb[]; aside?: ReactNode }) {
  return (
    <nav className="zoom-bar" aria-label="いま開いている階層">
      {crumbs.map((c, i) => (
        <span key={`${c.label}-${i}`} className="zoom-seg">
          {i > 0 && <span className="zoom-sep" aria-hidden>›</span>}
          {c.href
            ? <Link href={c.href} className="zoom-crumb btn-physical">{c.label}</Link>
            : <span className="zoom-crumb-current" aria-current="page">{c.label}</span>}
        </span>
      ))}
      {aside && <span className="zoom-bar-aside">{aside}</span>}
    </nav>
  )
}

/**
 * 年度の切り替え —— 操作柱の下に置く、目立たない場所。
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

import type { ReactNode } from 'react'
import Link from 'next/link'
import './tokens.css'
import './base.css'

export const metadata = {
  title: 'YouthDB — 起業家アカデミー 集客〜選考',
  description: '林・木・幹のファネルと選考オペレーションを一元管理する',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <header className="topbar">
          <div className="topbar-inner">
            <Link href="/" className="wordmark" style={{ color: 'inherit' }}>
              Youth<span>DB</span>
            </Link>
            <nav className="nav">
              {/* 運転席を先頭に置く。憲法のホームは「今日やること」であって
                  ファネルではない。既存の画面は残し、入口の順序だけ変える。 */}
              <Link href="/cockpit" className="button-ghost">運転席</Link>
              <Link href="/" className="button-ghost">ファネル</Link>
              <Link href="/sources" className="button-ghost">流入元</Link>
              <Link href="/operations" className="button-ghost">選考オペレーション</Link>
              <Link href="/people" className="button-ghost">人を探す</Link>
            </nav>
          </div>
        </header>
        <main className="shell">{children}</main>
      </body>
    </html>
  )
}

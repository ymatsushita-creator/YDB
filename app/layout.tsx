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
              <Link href="/" className="button-ghost">ファネル</Link>
              <Link href="/operations" className="button-ghost">選考オペレーション</Link>
            </nav>
          </div>
        </header>
        <main className="shell">{children}</main>
      </body>
    </html>
  )
}

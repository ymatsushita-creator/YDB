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
        <div className="app-frame">
          <aside className="app-sidebar">
            <Link href="/cockpit" className="wordmark workspace-wordmark">
              Youth<span>DB</span>
            </Link>
            <p className="workspace-label">ENTREPRENEUR ACADEMY OS</p>
            <nav className="workspace-nav" aria-label="主なナビゲーション">
              <Link href="/cockpit" className="workspace-nav-link workspace-nav-link-active">運転席</Link>
              <Link href="/pilot" className="workspace-nav-link">試運転</Link>
              <Link href="/" className="workspace-nav-link">ファネル</Link>
              <Link href="/sources" className="workspace-nav-link">森と流入元</Link>
              <Link href="/operations" className="workspace-nav-link">選考オペレーション</Link>
              <Link href="/people" className="workspace-nav-link">人を探す</Link>
            </nav>
            <div className="workspace-sidebar-footer">
              <span>運用ワークスペース</span>
              <strong>Academy Team</strong>
            </div>
          </aside>
          <div className="app-content">
            <header className="workspace-toolbar">
              <span className="workspace-toolbar-title">採用エコシステム</span>
              <span className="workspace-toolbar-status"><i />運用中</span>
            </header>
            <main className="shell">{children}</main>
          </div>
        </div>
      </body>
    </html>
  )
}

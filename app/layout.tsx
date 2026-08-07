import type { ReactNode } from 'react'
import Link from 'next/link'
import { isDemoMode } from '../src/db/server.ts'
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
            {/*
              ブランド名は必ずロゴ画像で出す。極太テキストで「NEO ACADEMIA」と
              書くとロゴと競合する（ブランド規定）。
              比は 3.15:1 固定。歪めない・着色しない・装飾しない。
              周囲にはロゴ高さの30〜50%以上の余白を取る（.workspace-logo）。
            */}
            <Link href="/cockpit" className="workspace-logo" aria-label="NEO ACADEMIA — 運転席へ">
              <img src="/brand/logo_black.png" alt="NEO ACADEMIA" width={1274} height={404} />
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
              {/*
                デモ環境であることを画面に出す。URL を渡された人には、
                これが実データかどうかを確かめる手段が無い。
                出さなければ「実在の候補者が26人待っている」と読める。
              */}
              {isDemoMode()
                ? <span className="workspace-toolbar-status is-demo"><i />デモ ・ 架空データ ・ 保存されません</span>
                : <span className="workspace-toolbar-status"><i />運用中</span>}
            </header>
            <main className="shell">{children}</main>
          </div>
        </div>
      </body>
    </html>
  )
}

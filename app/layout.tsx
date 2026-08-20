import type { ReactNode } from 'react'
import './tokens.css'
// ★ 意匠は `tokens.css`（`basic/DESIGN.md` の生成物）と `base.css` の2枚だけ
//   （2026-08-20 の刷新。依頼者の指示）。
//   白黒の土台（`monochrome.css`）・線に色を差すブランド層（`brand.css`）・
//   リキッドグラス（`glass.css`）の3枚は**外した** ―― どれも DESIGN.md に無く、
//   「面をスペクトラムで塗らない／操作面は無彩色」と食い違っていた。
import './base.css'

export const metadata = {
  title: 'YouthDB — TALENT INTELLIGENCE',
  description: '集客から選考までを、特別選考・通常選考・連携団体の3つに集約する',
  // ★ `/brand/` 配下を参照する。入口の proxy は `/favicon.png` を通さないため
  //   （許可は `/favicon` 完全一致と `/brand/`）、ここを `/favicon.png` にすると
  //   タブのアイコン要求が 307 でログインへ弾かれ、**アイコンが出ない。**
  icons: {
    // ★ タブのアイコンは 16〜32px で描かれる。512px の原版（202KB）を渡すのは、
    //   **表示の 200 倍のバイト数を毎回配ること**である。64px 版（5KB）を渡す。
    //   原版は `logo_ydb.png` のまま残す（意匠の資産はこちらで作り替えない）。
    icon: '/brand/icon_64.png',
  },
}

/**
 * 土台だけを持つ。
 *
 * 外枠（操作柱と現在地の帯）は `app/_components/shell.tsx` の `Shell` にあり、
 * **各ページが `<Shell active="...">` で自分から被る。**
 *
 * ここで被せない理由は2つある。
 *   1. いま居るタブを知るのに `usePathname()`（＝クライアント境界）が要る
 *   2. レイアウトは `searchParams` を受け取れないので「いまどの年度か」を
 *      知れず、年度の切替を操作柱に置けない（C-45）
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>
        {children}
      </body>
    </html>
  )
}

import type { ReactNode } from 'react'
import './tokens.css'
import './base.css'
// ★ 白黒の土台（依頼者の指示）。**トークンの後に読む**ので、外せば元の色に戻る。
import './monochrome.css'
// ★ ブランド配色。ロゴのグラデーションから採った色を**線と文字にだけ**入れる。
//   面は白と黒のまま（意匠規定「色は線、面は黒」）。外せば白黒に戻る。
import './brand.css'
// ★ リキッドグラス（依頼者の指示。実行⑫。仕様書を受領）。
//   **浮いているボタンだけ**をガラスにする。外せば物理ボタン（実行⑨）に戻る。
import './glass.css'
import { GlassPointer } from './_components/glass.tsx'

export const metadata = {
  title: 'YouthDB — TALENT INTELLIGENCE',
  description: '集客から選考までを、特別選考・通常選考・連携団体の3つに集約する',
  // ★ `/brand/` 配下を参照する。入口の proxy は `/favicon.png` を通さないため
  //   （許可は `/favicon` 完全一致と `/brand/`）、ここを `/favicon.png` にすると
  //   タブのアイコン要求が 307 でログインへ弾かれ、**アイコンが出ない。**
  icons: {
    icon: '/brand/logo_ydb.png',
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
        {/* ポインタの座標を CSS 変数へ書くだけ。光は `glass.css` が描く。
            画面を1つも描かないので、ここに置いても外枠の作りは変わらない。 */}
        <GlassPointer />
      </body>
    </html>
  )
}

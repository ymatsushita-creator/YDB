import type { ReactNode } from 'react'
import './tokens.css'
import './base.css'
// ★ 白黒の土台（依頼者の指示）。**トークンの後に読む**ので、外せば元の色に戻る。
import './monochrome.css'
// ★ ブランド配色。ロゴのグラデーションから採った色を**線と文字にだけ**入れる。
//   面は白と黒のまま（意匠規定「色は線、面は黒」）。外せば白黒に戻る。
import './brand.css'

export const metadata = {
  title: 'YouthDB — TALENT INTELLIGENCE',
  description: '集客から選考までを、ヘッドハンティング・個人アプローチ・団体アプローチの3つに集約する',
  icons: {
    icon: '/favicon.png',
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
      <body>{children}</body>
    </html>
  )
}

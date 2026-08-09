import type { ReactNode } from 'react'
import './tokens.css'
import './base.css'

export const metadata = {
  title: 'YouthDB — TALENT INTELLIGENCE',
  description: '集客から選考までを、ヘッドハンティング・ボーダーライン・アプローチの3つに集約する',
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

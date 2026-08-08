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
 * 外枠（操作柱と年度の帯）は `app/_components/shell.tsx` の `Shell` にあり、
 * **各ルートの layout.tsx が「自分はどのタブに属するか」を宣言して**
 * それを被せる。ここで被せてしまうと、いま居るタブを知るために
 * `usePathname()`（＝クライアント境界）が要る。
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  )
}

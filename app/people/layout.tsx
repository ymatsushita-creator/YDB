import type { ReactNode } from 'react'
import { Shell } from '../_components/shell.tsx'

/** この画面が属するタブ。外枠と操作柱の強調はここで決まる。 */
export default function Layout({ children }: { children: ReactNode }) {
  return <Shell active="headhunting">{children}</Shell>
}

import { redirect } from 'next/navigation'

/**
 * 入口。
 *
 * 実行⑨で行き先が3つになった（ヘッドハンティング / ボーダーライン /
 * アプローチ）。ここに4つ目の画面を置くと、タブに無い画面がトップに座る。
 * 先頭のタブへ送る。
 */
export default function Home() {
  redirect('/headhunting')
}

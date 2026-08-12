'use client'

import { useEffect } from 'react'

/**
 * ガラスの追従光（依頼者の指示。実行⑫。仕様書 §6）。
 *
 * ポインタの位置を CSS 変数（`--lg-mx` / `--lg-my`）へ書くだけの部品。
 * 光そのものは `app/glass.css` の `::after` が描く ――
 * **見た目の指定を JS へ持ち込まない。**
 *
 * ★ `'use client'` はこれで2つ目である（表と、これ）。
 *   ホバーだけならサーバのままで作れるが、**ポインタの座標は CSS では取れない。**
 *   依頼者の判断で入れた（仕様が「PC 実装の見せ場」と呼んでいる層）。
 *
 * ★ **委譲方式（リスナは1つ）。** 対象は操作柱のタブ・期・帯のボタン・
 *   ポップアップの閉じる・主ボタンで、1画面で20枚を超える。
 *   要素ごとに付けると仕様 §6 の注意（20個を超えたら委譲）に反する。
 *
 * ★ スロットリングしない（仕様どおり）。書くのは CSS 変数だけで、
 *   レイアウトを起こさない。**それでも `style` を触るのは「動いている要素」
 *   1つに限る** ―― 通り過ぎた要素の変数は消す（残すと、次に触れたとき
 *   前の位置から光が動いて見える）。
 */

/** 追従光を出す相手。`app/glass.css` の対象と**同じ集合**を1箇所に書く。 */
const TARGET = [
  '.hh-nav .sidebar-item',
  '.hh-nav .sidebar-item-active',
  '.hh-sidebar .btn-physical',
  '.hh-year',
  '.hh-search-go',
  '.zoom-bar .btn-physical',
  '.zoom-bar .zoom-crumb',
  '.popup-close',
  '.button-primary',
].join(',')

export function GlassPointer() {
  useEffect(() => {
    // 透過を減らす設定のときは光を出さない（`glass.css` が ::after を消している）。
    // 変数だけ書いても害は無いが、**出さないと決めた層で計算を続けない。**
    if (window.matchMedia('(prefers-reduced-transparency: reduce)').matches) return

    let current: HTMLElement | null = null

    const clear = () => {
      if (!current) return
      current.style.removeProperty('--lg-mx')
      current.style.removeProperty('--lg-my')
      current = null
    }

    const onMove = (e: PointerEvent) => {
      const target = e.target instanceof Element ? e.target.closest<HTMLElement>(TARGET) : null
      if (target !== current) clear()
      if (!target) return
      current = target
      const r = target.getBoundingClientRect()
      target.style.setProperty('--lg-mx', `${e.clientX - r.left}px`)
      target.style.setProperty('--lg-my', `${e.clientY - r.top}px`)
    }

    // 画面の外へ出たら消す（押したまま出ると光が残る）。
    document.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('pointerleave', clear)
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerleave', clear)
      clear()
    }
  }, [])

  return null
}

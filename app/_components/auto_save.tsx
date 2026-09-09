'use client'

import { useRef, useState, useTransition, type FormEvent, type ReactNode } from 'react'

/**
 * 記入完了時の自動保存（Auto-Save）コンポーネント。
 *
 * 入力欄（<input>, <textarea>, <select>）のフォーカスが外れた時（onBlur）、
 * または入力が一段落した時（タイピング停止時）に、フォームを自動送信します。
 * 右上に「自動保存中...」「✓ 自動保存済み」の状態インジケーターをソフトに表示します。
 */
export function AutoSaveForm({
  children,
  action,
  className = '',
  style,
}: {
  children: ReactNode
  action?: (formData: FormData) => void | Promise<void>
  className?: string
  style?: React.CSSProperties
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [, startTransition] = useTransition()
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  const executeSave = () => {
    if (!formRef.current) return
    const form = formRef.current
    setSaveStatus('saving')

    startTransition(async () => {
      try {
        if (action) {
          const formData = new FormData(form)
          await action(formData)
        } else {
          form.requestSubmit()
        }
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 2500)
      } catch (_err) {
        setSaveStatus('idle')
      }
    })
  }

  const handleBlur = (e: FormEvent) => {
    // フォーム外へのフォーカス移動やフォーカスアウト時にトリガー
    const target = e.target as HTMLElement
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(executeSave, 400)
    }
  }

  const handleChange = (e: FormEvent) => {
    const target = e.target as HTMLElement
    // セレクトボックスやラジオボタンは即時保存
    if (target.tagName === 'SELECT' || (target as HTMLInputElement).type === 'radio') {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(executeSave, 200)
    } else {
      // テキスト入力は入力停止後1.5秒で保存
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(executeSave, 1500)
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <form
        ref={formRef}
        action={action}
        className={className}
        style={style}
        onBlur={handleBlur}
        onChange={handleChange}
      >
        {children}
      </form>
      {saveStatus !== 'idle' && (
        <div
          className={`autosave-status ${saveStatus === 'saving' ? 'is-saving' : 'is-saved'}`}
        >
          {saveStatus === 'saving' ? '自動保存中...' : '✓ 自動保存済み'}
        </div>
      )}
    </div>
  )
}

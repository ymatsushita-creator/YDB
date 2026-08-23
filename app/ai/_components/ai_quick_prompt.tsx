'use client'

import { useState } from 'react'

const QUICK_PROMPTS = [
  '3期の応募者は何人ですか',
  '確度S・Aの候補者一覧を見せてください',
  '書類選考で合格した候補者は何人いますか',
  '連携団体からの推薦者数と進行状況を教えて',
  '面接の未評価者リストを出してください',
]

export function AiQuickPrompts() {
  const [value, setValue] = useState('')

  return (
    <div className="editable-region">
      <div style={{ marginBottom: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <small style={{ width: '100%', color: 'var(--text-muted)', fontWeight: 600 }}>
          💡 クイック質問例（クリックで入力）:
        </small>
        {QUICK_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            className="chip button-secondary"
            onClick={() => setValue(prompt)}
            style={{ fontSize: '12px', padding: '4px 10px', cursor: 'pointer' }}
          >
            {prompt}
          </button>
        ))}
      </div>
      <label>
        問い
        <input
          name="question"
          required
          maxLength={400}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="例：3期の応募者は何人ですか"
        />
      </label>
    </div>
  )
}

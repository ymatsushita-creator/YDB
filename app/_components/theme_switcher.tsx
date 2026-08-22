'use client'

import { useState, useEffect } from 'react'

export type Theme = 'default' | 'emerald' | 'violet'

const THEMES: Array<{ id: Theme; label: string; color: string }> = [
  { id: 'default', label: 'デフォルト', color: '#1a73e8' },
  { id: 'emerald', label: 'エメラルド', color: '#059669' },
  { id: 'violet', label: 'ヴァイオレット', color: '#7c3aed' },
]

export function ThemeSwitcher() {
  const [activeTheme, setActiveTheme] = useState<Theme>('default')

  useEffect(() => {
    const saved = (localStorage.getItem('youthdb_theme') as Theme) ?? 'default'
    if (THEMES.some((t) => t.id === saved)) {
      setActiveTheme(saved)
      document.documentElement.setAttribute('data-theme', saved)
    }
  }, [])

  const switchTheme = (theme: Theme) => {
    setActiveTheme(theme)
    localStorage.setItem('youthdb_theme', theme)
    document.documentElement.setAttribute('data-theme', theme)
  }

  return (
    <div className="theme-switcher-container" title="テーマカラー切替">
      <span className="theme-switcher-label">🎨 テーマ:</span>
      <div className="theme-switcher-chips">
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            className={activeTheme === t.id ? 'theme-chip is-active' : 'theme-chip'}
            onClick={() => switchTheme(t.id)}
            aria-label={`テーマを${t.label}に変更`}
          >
            <span className="theme-chip-dot" style={{ backgroundColor: t.color }} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

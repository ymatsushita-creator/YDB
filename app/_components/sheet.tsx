'use client'

import { useActionState, useEffect, useState } from 'react'
import type { RowResult } from '../../src/commands/sheet.ts'

/**
 * スプシ形式の表（依頼者の指示。実行⑫）。
 *
 * ★★ **この製品で唯一の `'use client'` である。** ★★
 *   実行⑪まで 0 件で、素の `<form action={...}>` だけで作ってきた。
 *   依頼者の指示は「1行＝1件、追加も表の上で、まとめて保存、スプシから貼り付け」
 *   ―― 行の追加とセル間の移動と貼り付けは、**サーバ往復では作れない**
 *   （行を1つ増やすたびに打った値が消える）。ここだけ持たせる。
 *
 * ★ **判定はここに書かない。** 持つのは行の状態（値・新規か既存か・失敗の理由）
 *   だけで、必須・形式・参照先は `src/commands/sheet.ts` が見る。
 *   画面は値の受け渡しと表示に限る（`CLAUDE.md`）。
 *
 * ★ 失敗した行は**打った値のまま残す。** サーバから返る結果を行に貼り直す
 *   だけなので、10行のうち1行が落ちても打ち直しにならない（依頼者の判断）。
 *
 * ★ 保存できた新規行には**返ってきた ID を貼る。**
 *   貼らずにもう一度保存すると、同じ人が2件できる。
 */

export interface SheetColumn {
  key: string
  label: string
  type: 'text' | 'date' | 'number' | 'select' | 'email'
  options?: Array<{ id: string; label: string }>
  /** 既存行では触らせない列（接点など。書き換えの置き場所が無い）。 */
  newOnly?: boolean
  /** 新規行では触らせない列（アプローチ状態など。登録時は初期値が入る）。 */
  existingOnly?: boolean
  /** 幅（px）。長い自由入力を広く取る。 */
  width?: number
}

export interface SheetRowData {
  /** 既存行の ID。空なら新規行。 */
  id: string
  values: Record<string, string>
  /** 行の先頭に読み取りで添える文字（候補者番号・期・版数など）。 */
  lead?: string
  /** 顔写真は表の行データへ埋め込まず、必要な行だけ別経路で読む。 */
  photoSrc?: string
  photoAlt?: string
  /**
   * 列にはしないが、その行と一緒に送るもの（フォーム回答の接合など）。
   * **画面に出さない値を、画面の外に持たせない** ―― 行と一緒に運ぶ。
   */
  extra?: Record<string, string>
}

export interface SheetActionState {
  message: string | null
  ok: boolean
  results: RowResult[]
}

export const SHEET_INITIAL: SheetActionState = { message: null, ok: false, results: [] }

/** 行が1つも無い表でも、打ち始められるように空行を出す。 */
const BLANK_ROWS = 3

const emptyValues = (columns: SheetColumn[]): Record<string, string> =>
  Object.fromEntries(columns.map((c) => [c.key, '']))

/**
 * 表の行の鍵。**行の同一性は位置そのものである** ―― 同じ候補者を2行に貼れるので
 * `id` は一意でなく、誤りの印も `errors.has(rowIndex)` と位置で引いている。
 * 位置以外の鍵にすると、印と行がずれる。鍵はここで1度だけ組む。
 */
const rowKey = (id: string, index: number) => `${id}-${index}`

export function Sheet({
  columns, rows, action, hidden, leadLabel, addLabel = '行を追加', detail,
  photoColumn = false,
}: {
  columns: SheetColumn[]
  rows: SheetRowData[]
  action: (state: SheetActionState, formData: FormData) => Promise<SheetActionState>
  hidden?: Record<string, string>
  leadLabel?: string
  addLabel?: string
  photoColumn?: boolean
  detail?: { href: string; label: string }
}) {
  const [state, formAction, pending] = useActionState(action, SHEET_INITIAL)
  const [isDirty, setIsDirty] = useState(false)
  const [data, setData] = useState<SheetRowData[]>(() => [
    ...Array.from({ length: BLANK_ROWS }, () => ({ id: '', values: emptyValues(columns) })),
    ...rows,
  ])

  const [shift, setShift] = useState(0)
  const [filterText, setFilterText] = useState('')

  useEffect(() => {
    if (state.results.length === 0) return
    setShift(0)
    if (state.ok) {
      setIsDirty(false)
    }
    setData((prev) => {
      const next = [...prev]
      for (const r of state.results) {
        if (r.ok && r.id && next[r.index] && next[r.index]!.id === '') {
          next[r.index] = { ...next[r.index]!, id: r.id, lead: r.lead ?? next[r.index]!.lead }
        }
      }
      return next
    })
  }, [state])

  // Ctrl+S / Cmd+S ショートカットで即時保存
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        const form = document.querySelector('form.sheet-form') as HTMLFormElement | null
        form?.requestSubmit()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const errors = new Map<number, string>(
    state.results.filter((r) => !r.ok)
      .map((r) => [r.index + shift, (r as { message: string }).message]))
  const savedRows = new Set<number>(
    state.results.filter((r) => r.ok).map((r) => r.index + shift))

  const isRowMatch = (row: SheetRowData) => {
    if (!filterText.trim()) return true
    if (row.id === '') return true
    const q = filterText.toLowerCase()
    if (row.lead?.toLowerCase().includes(q)) return true
    return Object.values(row.values).some((v) => String(v).toLowerCase().includes(q))
  }

  const setCell = (rowIndex: number, key: string, value: string) => {
    setIsDirty(true)
    setData((prev) => prev.map((row, i) =>
      (i === rowIndex ? { ...row, values: { ...row.values, [key]: value } } : row)))
  }

  const addRow = () => {
    setIsDirty(true)
    setData((prev) => [{ id: '', values: emptyValues(columns) }, ...prev])
    setShift((n) => n + 1)
  }

  const editable = (row: SheetRowData, col: SheetColumn) =>
    !(row.id === '' ? col.existingOnly : col.newOnly)

  const onPaste = (rowIndex: number, colIndex: number) =>
    (e: React.ClipboardEvent<HTMLElement>) => {
      const text = e.clipboardData.getData('text/plain')
      if (!text || !(text.includes('\t') || text.trimEnd().includes('\n'))) return
      e.preventDefault()
      setIsDirty(true)

      const grid = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n')
        .map((line) => line.split('\t'))

      setData((prev) => {
        const next = [...prev]
        grid.forEach((line, dy) => {
          const target = rowIndex + dy
          while (next.length <= target) {
            next.push({ id: '', values: emptyValues(columns) })
          }
          const row = next[target]!
          const values = { ...row.values }
          line.forEach((cell, dx) => {
            const col = columns[colIndex + dx]
            if (!col || !editable(row, col)) return
            values[col.key] = col.type === 'select'
              ? (col.options?.find((o) => o.label === cell.trim())?.id ?? '')
              : cell.trim()
          })
          next[target] = { ...row, values }
        })
        return next
      })
    }

  return (
    <form action={formAction} className="sheet-form editable-region">
      {Object.entries(hidden ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <input type="hidden" name="rows" value={JSON.stringify(data)} />

      {state.message && (
        <p className={`callout${state.ok ? ' ok' : ''}`}>{state.message}</p>
      )}

      {/* スプレッドシートツールバー（検索バー＋保存アクション） */}
      <div className="sheet-filter-bar">
        <div style={{ display: 'flex', gap: 'var(--space-xs)', alignItems: 'center' }}>
          <input
            type="text"
            className="text-input"
            placeholder="表内をクイック検索..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            style={{ maxWidth: '240px' }}
          />
          {filterText && (
            <button type="button" className="button-secondary-sm" onClick={() => setFilterText('')}>
              クリア
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-xs)', alignItems: 'center' }}>
          {isDirty && (
            <span style={{ fontSize: '12px', color: 'var(--color-brand-cyan-deep)', fontWeight: 600 }}>
              ● 未保存の変更
            </span>
          )}
          <button type="button" className="btn-physical" onClick={addRow}>{addLabel}</button>
          <button type="submit" className="button-primary" disabled={pending}>
            {pending ? '保存中…' : 'まとめて保存'}
          </button>
        </div>
      </div>

      <div className="table-wrap sheet-wrap">
        <table className="data sheet">
          <thead>
            <tr>
              {photoColumn && <th className="sheet-photo">顔写真</th>}
              <th className="sheet-lead">{leadLabel ?? ''}</th>
              {columns.map((c) => <th key={c.key}>{c.label}</th>)}
              <th>結果</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, rowIndex) => (
              !isRowMatch(row) ? null : (
              <tr
                  key={rowKey(row.id, rowIndex)}
                  className={errors.has(rowIndex) ? 'sheet-row-bad' : ''}>
                {photoColumn && (
                  <td className="sheet-photo">
                    {row.photoSrc
                      ? <img className="avatar" src={row.photoSrc} alt={row.photoAlt ?? ''}
                             width={32} height={32} loading="lazy" />
                      : <span className="avatar avatar-fallback" aria-hidden>—</span>}
                  </td>
                )}
                <th scope="row" className="sheet-lead">
                  {/* ★ 新規行は色で分ける（依頼者の指示。C-185）。 */}
                  {row.id === ''
                    ? <span className="sheet-lead-new">{row.lead ?? '新規'}</span>
                    : (row.lead ?? '')}
                </th>
                {columns.map((c, colIndex) => (
                  <td key={c.key} style={c.width ? { minWidth: c.width } : undefined}>
                    {!editable(row, c) ? (
                      // 触らせない列は**入力にしない。** 読むものだと形で分かること。
                      <span className="sheet-fixed">
                        {/* 選択列でも、ID に当たらない値はそのまま出す ――
                            既存行の流入元は**名前**で来る（選ばせないので ID が要らない）。
                            当たらないから空にすると、記録があるのに無いように見える。 */}
                        {c.type === 'select'
                          ? (c.options?.find((o) => o.id === row.values[c.key])?.label
                             ?? row.values[c.key] ?? '')
                          : (row.values[c.key] ?? '')}
                      </span>
                    ) : c.type === 'select' ? (
                      <select
                        value={row.values[c.key] ?? ''}
                        onChange={(e) => setCell(rowIndex, c.key, e.target.value)}
                        onPaste={onPaste(rowIndex, colIndex)}
                      >
                        <option value="">―</option>
                        {c.options?.map((o) => (
                          <option key={o.id} value={o.id}>{o.label}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        /* ★ メールは **`type="email"` にしない**（C-126）。
                           表は行をまとめて1回で送るので、ブラウザの形式検査が
                           1セルの不備で**送信そのものを止める** ―― 表は
                           行ごとに「結果」を返す作りで、判定はサーバに置いてある。
                           打ち方だけ揃える（キーボードのヒントは出す）。 */
                        type={c.type === 'date' ? 'date' : c.type === 'number' ? 'number' : 'text'}
                        inputMode={c.type === 'number' ? 'numeric'
                          : c.type === 'email' ? 'email' : undefined}
                        min={c.type === 'number' ? 0 : undefined}
                        value={row.values[c.key] ?? ''}
                        onChange={(e) => setCell(rowIndex, c.key, e.target.value)}
                        onPaste={onPaste(rowIndex, colIndex)}
                      />
                    )}
                  </td>
                ))}
                <td className="sheet-result">
                  {errors.get(rowIndex)
                    ?? (savedRows.has(rowIndex) ? '保存した' : '')}
                  {detail && row.id !== '' && (
                    <>
                      {' '}
                      <a href={detail.href.replace('{id}', row.id)}>{detail.label}</a>
                    </>
                  )}
                </td>
              </tr>
              )
            ))}
          </tbody>
        </table>
      </div>

      {/* ★ 落ちた理由を**表の外にも出す。**
          結果の列は右端にあるので、列の多い表では横に送らないと読めない。
          「切れて見える」ものは読めないのと同じである（C-65 と同じ扱い）。 */}
      {errors.size > 0 && (
        <ul className="sheet-errors">
          {[...errors.entries()].map(([index, message]) => (
            <li key={index}>{index + 1} 行目 ―― {message}</li>
          ))}
        </ul>
      )}

      <div className="sheet-actions">
        <button type="button" className="btn-physical" onClick={addRow}>{addLabel}</button>
        <button type="submit" className="button-primary" disabled={pending}>
          {pending ? '保存している…' : 'まとめて保存'}
        </button>
      </div>
    </form>
  )
}

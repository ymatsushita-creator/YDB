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
  /** 期の ID など、行に関係なく送るもの。 */
  hidden?: Record<string, string>
  /** 行の先頭の列の見出し（番号・期など）。 */
  leadLabel?: string
  addLabel?: string
  /** 候補者表だけ、読み取り専用の顔写真列を先頭に置く。 */
  photoColumn?: boolean
  /**
   * 行から開く先。`{id}` を行の ID で置き換える。
   * 表で編集しないもの（写真の差し替え・変更ログ）はここから入れる。
   * ★ 関数は境界を越えられないので、**型ではなく文字列**で渡す。
   */
  detail?: { href: string; label: string }
}) {
  const [state, formAction, pending] = useActionState(action, SHEET_INITIAL)
  /**
   * ★ **空行は先頭に置く**（依頼者の指示。実行⑰。C-168）――
   *   「新規を入力するまで下にスクロールしないといけないのはめんどい」。
   *   既存が数百行あると、1件足すたびに表の底まで送ることになる。
   *
   * ★ 添字は `state.results` の `index` と一致していなければならない。
   *   並べ替えではなく**最初からこの順で組む**ので、送信順もこの順になる
   *   （入力欄は `data` の順で並び、サーバは受け取った順に返す）。
   */
  const [data, setData] = useState<SheetRowData[]>(() => [
    ...Array.from({ length: BLANK_ROWS }, () => ({ id: '', values: emptyValues(columns) })),
    ...rows,
  ])

  /**
   * ★ 前回の保存結果と、いまの行の並びのずれ（C-168）。
   *
   *   結果（`state.results`）は**送った時の並び**の添字で返る。
   *   保存したあとに先頭へ行を足すと、既存の行が1つずつ後ろへ動くので、
   *   ずらさずに引くと**別の行に「保存できた」「失敗」が付く。**
   *   足した数だけ引いて読む。次に送った時点で並びは一致するので0に戻す。
   */
  const [shift, setShift] = useState(0)

  // 保存できた新規行に ID を貼る。**貼らないと二重に作る。**
  // 先頭の読み取り列（候補者番号）も、保存で初めて決まるので貼り直す。
  useEffect(() => {
    if (state.results.length === 0) return
    // 送った時点の並びで返ってきているので、ずれは無くなる。
    setShift(0)
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

  const errors = new Map<number, string>(
    state.results.filter((r) => !r.ok)
      .map((r) => [r.index + shift, (r as { message: string }).message]))
  const savedRows = new Set<number>(
    state.results.filter((r) => r.ok).map((r) => r.index + shift))

  const setCell = (rowIndex: number, key: string, value: string) => {
    setData((prev) => prev.map((row, i) =>
      (i === rowIndex ? { ...row, values: { ...row.values, [key]: value } } : row)))
  }

  // ★ 足す行も**先頭に**。押した行が画面の外に出ないようにする。
  //   ずれる分は `shift` が引き受ける。
  const addRow = () => {
    setData((prev) => [{ id: '', values: emptyValues(columns) }, ...prev])
    setShift((n) => n + 1)
  }

  const editable = (row: SheetRowData, col: SheetColumn) =>
    !(row.id === '' ? col.existingOnly : col.newOnly)

  /**
   * スプシからの貼り付け。
   *
   * ★ タブ区切り・改行区切りをそのまま受ける（表計算のコピーはこの形）。
   *   足りない行はその場で足す。**列は右へはみ出したぶんを捨てる** ――
   *   知らない列に勝手に入れない。
   *
   * ★ 触らせない列（既存行の接点など）は**飛ばさずに、置かない。**
   *   ずらすと、貼った表と入った値が1列ずれる。
   */
  const onPaste = (rowIndex: number, colIndex: number) =>
    (e: React.ClipboardEvent<HTMLElement>) => {
      const text = e.clipboardData.getData('text/plain')
      if (!text || !(text.includes('\t') || text.trimEnd().includes('\n'))) return
      e.preventDefault()

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
              // 選択列は**名前が完全に一致したときだけ**結び付ける（C-79 と同じ規則）。
              // 似た語へ寄せない。読めない値は空のまま残し、行の理由で伝える。
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
      {/* 行はまとめて1つの値で送る。列が増えても送り方が変わらない。 */}
      <input type="hidden" name="rows" value={JSON.stringify(data)} />

      {state.message && (
        <p className={`callout${state.ok ? ' ok' : ''}`}>{state.message}</p>
      )}

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

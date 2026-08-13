'use server'

import { revalidatePath } from 'next/cache'
import { getDb } from '../../../src/db/server.ts'
import { saveStaffSheet, type StaffRowInput } from '../../../src/commands/sheet.ts'
import type { SheetActionState, SheetRowData } from '../../_components/sheet.tsx'

/**
 * 入力者の表のまとめて保存（実行⑬。依頼者の指示）。
 *
 * 判定は `src/commands/sheet.ts`。ここは受け渡しと言葉だけ。
 * **redirect しない** ―― 失敗した行は打った値のまま表に残す（`people/new` と同じ）。
 *
 * ★ URL にも戻り値にも名前を載せない。載せるのは件数と行ごとの理由だけ。
 */

const text = (v: unknown) => (typeof v === 'string' ? v : '')

const parse = (formData: FormData): SheetRowData[] => {
  try {
    const raw: unknown = JSON.parse(String(formData.get('rows') ?? '[]'))
    return Array.isArray(raw) ? raw as SheetRowData[] : []
  } catch {
    return []
  }
}

const summary = (r: { created: number; updated: number; failed: number }): string => {
  const parts: string[] = []
  if (r.created > 0) parts.push(`${r.created} 人を追加した`)
  if (r.updated > 0) parts.push(`${r.updated} 人を直した`)
  if (r.failed > 0) parts.push(`${r.failed} 行は入らなかった`)
  if (parts.length === 0) parts.push('変わった行が無かった')
  return `${parts.join('・')}。`
}

export async function saveStaffSheetAction(
  _state: SheetActionState, formData: FormData,
): Promise<SheetActionState> {
  const rows: StaffRowInput[] = parse(formData).map((r) => {
    const v = (r?.values ?? {}) as Record<string, unknown>
    return { staffId: text(r?.id), displayName: text(v.displayName) }
  })

  const db = await getDb()
  const result = await saveStaffSheet(db, { rows })

  // 表の「入力者」の選択肢が変わる。**片方だけ古いままにしない。**
  if (result.created > 0 || result.updated > 0) {
    revalidatePath('/staff/new')
    revalidatePath('/people/new')
    revalidatePath('/approach')
  }

  return { message: summary(result), ok: result.failed === 0, results: result.rows }
}

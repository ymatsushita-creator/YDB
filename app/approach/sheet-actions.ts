'use server'

import { revalidatePath } from 'next/cache'
import { getDb } from '../../src/db/server.ts'
import {
  savePartnerSheet, saveReachSheet,
  type PartnerRowInput, type ReachRowInput,
} from '../../src/commands/sheet.ts'
import type { SheetActionState, SheetRowData } from '../_components/sheet.tsx'

/**
 * 団体の表と接触の表のまとめて保存（実行⑫。依頼者の指示）。
 *
 * 判定は `src/commands/sheet.ts`。ここは受け渡しと言葉だけ。
 * **redirect しない** ―― 失敗した行は打った値のまま表に残す（`people/new` と同じ）。
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

const summary = (
  r: { created: number; updated: number; failed: number },
): string => {
  const parts: string[] = []
  if (r.created > 0) parts.push(`${r.created} 件を追加した`)
  if (r.updated > 0) parts.push(`${r.updated} 件を直した`)
  if (r.failed > 0) parts.push(`${r.failed} 行は入らなかった`)
  if (parts.length === 0) parts.push('変わった行が無かった')
  return `${parts.join('・')}。`
}

export async function savePartnerSheetAction(
  _state: SheetActionState, formData: FormData,
): Promise<SheetActionState> {
  const rows: PartnerRowInput[] = parse(formData).map((r) => {
    const v = (r?.values ?? {}) as Record<string, unknown>
    return {
      partnerId: text(r?.id),
      name: text(v.name),
      category: text(v.category),
      contactName: text(v.contactName),
      contactDepartment: text(v.contactDepartment),
      contactEmail: text(v.contactEmail),
      internalOwner: text(v.internalOwner),
      // 0046（C-180）。応募管理表 011 にあってDBに無かった枠。
      recommendationSeats: text(v.recommendationSeats),
      partneredOn: text(v.partneredOn),
      bestContactPeriod: text(v.bestContactPeriod),
      location: text(v.location),
      engagement: text(v.engagement),
      recommendationStateId: text(v.recommendationStateId),
      staffId: text(v.staffId),
    }
  })

  // 推薦枠ステイタスは**期ごと**なので、どの期の表かを一緒に受け取る。
  const seasonId = String(formData.get('seasonId') ?? '') || undefined

  const db = await getDb()
  const result = await savePartnerSheet(db, { rows, seasonId })
  if (result.created > 0 || result.updated > 0) {
    revalidatePath('/approach')
    revalidatePath('/approach/new')
  }

  return { message: summary(result), ok: result.failed === 0, results: result.rows }
}

export async function saveReachSheetAction(
  _state: SheetActionState, formData: FormData,
): Promise<SheetActionState> {
  const partnerId = String(formData.get('partnerId') ?? '')
  const rows: ReachRowInput[] = parse(formData).map((r) => {
    const v = (r?.values ?? {}) as Record<string, unknown>
    return {
      reachId: text(r?.id),
      occurredOn: text(v.occurredOn),
      method: text(v.method),
      estimatedReach: text(v.estimatedReach),
      note: text(v.note),
      staffId: text(v.staffId),
    }
  })

  const db = await getDb()
  const result = await saveReachSheet(db, { partnerId, rows })
  // 接触は集客の集計そのものなので、集計を出す画面もまとめて作り直す。
  if (result.created > 0 || result.updated > 0) {
    revalidatePath('/approach')
    revalidatePath('/funnel')
    revalidatePath('/')
  }

  return { message: summary(result), ok: result.failed === 0, results: result.rows }
}

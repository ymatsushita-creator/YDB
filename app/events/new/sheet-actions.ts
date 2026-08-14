'use server'

import { revalidatePath } from 'next/cache'
import { getDb } from '../../../src/db/server.ts'
import { saveEventSheet, type EventRowInput } from '../../../src/commands/sheet.ts'
import type { SheetActionState, SheetRowData } from '../../_components/sheet.tsx'

/**
 * イベントの表のまとめて保存（実行⑯。依頼者の指示。C-155）。
 *
 * 判定は `src/commands/sheet.ts`。ここは受け渡しと言葉だけ。
 * **redirect しない** ―― 失敗した行は打った値のまま表に残す（他の表と同じ）。
 *
 * ★ URL にも戻り値にもイベント名を載せない。載せるのは件数と行ごとの理由だけ。
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

const summary = (r: { created: number; failed: number }): string => {
  const parts: string[] = []
  if (r.created > 0) parts.push(`${r.created} 件を追加した`)
  if (r.failed > 0) parts.push(`${r.failed} 行は入らなかった`)
  if (parts.length === 0) parts.push('変わった行が無かった')
  return `${parts.join('・')}。`
}

export async function saveEventSheetAction(
  _state: SheetActionState, formData: FormData,
): Promise<SheetActionState> {
  const seasonId = String(formData.get('seasonId') ?? '')
  const rows: EventRowInput[] = parse(formData).map((r) => {
    const v = (r?.values ?? {}) as Record<string, unknown>
    return {
      appointmentId: text(r?.id),
      title: text(v.title),
      day: text(v.day),
      startsAt: text(v.startsAt),
      endsAt: text(v.endsAt),
      ownerStaffId: text(v.ownerStaffId),
      place: text(v.place),
      url: text(v.url),
      note: text(v.note),
    }
  })

  const db = await getDb()
  const result = await saveEventSheet(db, { seasonId, rows })

  // カレンダーと日程の画面が同じ予定を読む。**片方だけ古いままにしない。**
  if (result.created > 0) {
    revalidatePath('/events/new')
    revalidatePath('/operations')
    revalidatePath('/approach')
  }

  return { message: summary(result), ok: result.failed === 0, results: result.rows }
}

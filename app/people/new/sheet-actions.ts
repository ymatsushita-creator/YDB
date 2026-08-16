'use server'

import { revalidatePath } from 'next/cache'
import { getDb } from '../../../src/db/server.ts'
import { saveCandidateSheet, type CandidateRowInput } from '../../../src/commands/sheet.ts'
import type { SheetActionState, SheetRowData } from '../../_components/sheet.tsx'

/**
 * 表のまとめて保存（実行⑫。依頼者の指示）。
 *
 * 判定は `src/commands/sheet.ts`。ここは受け渡しと言葉だけ。
 *
 * ★ **redirect しない。** 失敗した行は打った値のまま表に残す約束なので、
 *   URL に結果コードを載せて画面を作り直す形（実行⑩までのやり方）は使えない
 *   ―― 作り直した瞬間に打った値が消える。**結果を返して行に貼る。**
 *
 * ★ URL にも戻り値にも氏名を載せない。載せるのは件数と行ごとの理由だけ。
 */

const text = (v: unknown) => (typeof v === 'string' ? v : '')

/** 表から届いた行を、コマンドが受け取る形へ写す。**ここで判定しない。** */
const toRows = (raw: unknown): CandidateRowInput[] => {
  if (!Array.isArray(raw)) return []
  return raw.map((row) => {
    const r = row as SheetRowData
    const v = (r?.values ?? {}) as Record<string, unknown>
    const extra = (r?.extra ?? {}) as Record<string, unknown>
    return {
      personId: text(r?.id),
      familyName: text(v.familyName),
      givenName: text(v.givenName),
      familyNameKana: text(v.familyNameKana),
      givenNameKana: text(v.givenNameKana),
      birthDate: text(v.birthDate),
      schoolId: text(v.schoolId),
      faculty: text(v.faculty),
      email: text(v.email),
      phone: text(v.phone),
      lineUserId: text(v.lineUserId),
      note: text(v.note),
      channelId: text(v.channelId),
      archive: text(v.archive),
      contactedOn: text(v.contactedOn),
      approachStateId: text(v.approachStateId),
      staffId: text(v.staffId),
      // 列にはしていない値。フォーム回答の接合はここを通る（C-79）。
      formResponseId: text(extra.formResponseId),
    }
  })
}

export async function saveCandidateSheetAction(
  _state: SheetActionState, formData: FormData,
): Promise<SheetActionState> {
  const seasonId = String(formData.get('seasonId') ?? '')
  let parsed: unknown = []
  try {
    parsed = JSON.parse(String(formData.get('rows') ?? '[]'))
  } catch {
    return { message: '表の中身を受け取れなかった。', ok: false, results: [] }
  }

  const db = await getDb()
  const result = await saveCandidateSheet(db, { seasonId, rows: toRows(parsed) })

  if (result.created > 0 || result.updated > 0) {
    revalidatePath('/people')
    revalidatePath('/people/new')
    revalidatePath('/headhunting')
    revalidatePath('/borderline')
  }

  const parts: string[] = []
  if (result.created > 0) parts.push(`${result.created} 件を追加した`)
  if (result.updated > 0) parts.push(`${result.updated} 件を直した`)
  if (result.failed > 0) parts.push(`${result.failed} 行は入らなかった`)
  if (parts.length === 0) parts.push('変わった行が無かった')

  return {
    message: `${parts.join('・')}。`,
    ok: result.failed === 0,
    results: result.rows,
  }
}

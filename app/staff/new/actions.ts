'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getDb } from '../../../src/db/server.ts'
import { addStaff } from '../../../src/commands/staff.ts'

/**
 * 入力者を1人足す（実行⑫。依頼者の指示）。
 *
 * 判定は `src/commands/staff.ts`。ここは受け渡しと戻り先だけ。
 * 素の `<form action={...}>` なので `'use client'` は増えない。
 *
 * ★ URL に載せるのは結果コードだけ。**名前を載せない。**
 */
export async function addStaffAction(formData: FormData): Promise<void> {
  const displayName = String(formData.get('displayName') ?? '')
  const season = String(formData.get('season') ?? '')
  const query = (code: string) =>
    `/staff/new?${new URLSearchParams({ ...(season ? { season } : {}), add: code })}`

  const db = await getDb()
  const result = await addStaff(db, { displayName })
  if (!result.ok) redirect(query(result.reason))

  // 表の「入力者」の選択肢が増える。片方だけ古いままにしない。
  revalidatePath('/people/new')
  revalidatePath('/approach')
  redirect(query(result.duplicateName ? 'saved_duplicate' : 'saved'))
}

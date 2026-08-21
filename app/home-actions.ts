'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { currentTier } from '../src/auth/current.ts'
import { getDb } from '../src/db/server.ts'
import { getWorkTasks, type UnifiedTask } from '../src/queries/tasks.ts'
import {
  assignInterviewer, reassignInterviewer,
  type AssignCode, type ReassignCode,
} from '../src/commands/assign.ts'
import { unholdEvaluation, type UnholdCode } from '../src/commands/unhold.ts'
import type { Db } from '../src/db/client.ts'
import type { Tier } from '../src/auth/tiers.ts'

/**
 * コックピットのインラインアクション（Phase 4 Step 3）。
 *
 * `assign` / `reassign` / `unhold` の3種だけ。
 * `start_selection` / `evaluate` / `decide` はここには置かない（Step 6 以降）。
 *
 * ★ 全アクション共通の順序
 *   1. currentTier() — null／input は DB 操作なし
 *   2. getDb()
 *   3. canonical command を呼ぶ（コマンド層に重複させない）
 *   4. 成功時: getWorkTasks() で次タスクを探し PRG リダイレクト
 *   5. 失敗時: 同じ画面に戻す（?work= を保持して同タスクを開いたまま）
 *
 * ★ リダイレクト先 URL
 *   - 個人情報を URL に載せない（C-20 と同じ理由）。コードだけ。
 *   - season / owner フィルタを引き継ぐ。
 *   - 成功後は次タスクを work= で選ぶ。フィルタに合わなければ owner=all に倒す。
 */

const t = (f: FormData, key: string) => String(f.get(key) ?? '')

/** ownerValue（'all'|'team'|'unassigned'|'staff:uuid'）にタスクが合うか。 */
function ownerMatches(task: UnifiedTask, ownerValue: string): boolean {
  if (ownerValue === 'all') return true
  if (ownerValue === 'team') return task.owner_scope === 'team'
  if (ownerValue === 'unassigned') return task.owner_scope === 'unassigned'
  if (ownerValue.startsWith('staff:')) {
    const staffId = ownerValue.slice(6)
    return task.owner_scope === 'staff' && task.owner_staff_id === staffId
  }
  return true
}

/**
 * 完了後のリダイレクト先。
 *
 * getWorkTasks() を再実行して次のタスクを探す。
 * 現在の owner フィルタに合うタスクがあればそのまま使い、
 * 合わなければ owner=all に切り替えて最先頭のタスクを選ぶ。
 */
async function nextTaskUrl(
  db: Db,
  tier: Tier,
  seasonId: string,
  ownerValue: string,
  resultKey: string,
  resultCode: string,
): Promise<string> {
  const tasks = await getWorkTasks(db, { seasonId, tier })

  let finalOwner = ownerValue
  let nextWork: string | undefined = tasks.find(t => ownerMatches(t, ownerValue))?.task_key

  if (!nextWork && ownerValue !== 'all') {
    // 現在フィルタに合うタスクがなくなった → owner=all に切り替え
    finalOwner = 'all'
    nextWork = tasks[0]?.task_key
  }

  const params = new URLSearchParams({ season: seasonId, owner: finalOwner })
  if (nextWork) params.set('work', nextWork)
  params.set(resultKey, resultCode)
  return `/?${params}`
}

// ----------------------------------------------------------------
// 担当を決める（assign）
// ----------------------------------------------------------------

export async function cockpitAssignAction(formData: FormData): Promise<void> {
  const tier = await currentTier()
  const seasonId = t(formData, 'seasonId')
  const ownerValue = t(formData, 'owner')

  // currentTier() が null または input なら DB 操作ゼロで終わる
  if (!tier) redirect('/headhunting')
  if (tier === 'input') redirect(`/?season=${seasonId}&owner=${ownerValue}`)

  const staffId = t(formData, 'staffId')
  const evaluationId = t(formData, 'evaluationId')
  const workKey = t(formData, 'work')

  const errorBack = (code: AssignCode): never => {
    const params = new URLSearchParams({ season: seasonId, owner: ownerValue, assign: code })
    if (workKey) params.set('work', workKey)
    redirect(`/?${params}`)
  }

  if (!staffId) return errorBack('no_staff')

  const db = await getDb()
  const result = await assignInterviewer(db, { evaluationId, staffId })

  if (!result.ok) return errorBack(result.reason)

  revalidatePath('/')
  redirect(await nextTaskUrl(db, tier, seasonId, ownerValue, 'assign', 'ok'))
}

// ----------------------------------------------------------------
// 担当を替える（reassign）
// ----------------------------------------------------------------

export async function cockpitReassignAction(formData: FormData): Promise<void> {
  const tier = await currentTier()
  const seasonId = t(formData, 'seasonId')
  const ownerValue = t(formData, 'owner')

  if (!tier) redirect('/headhunting')
  if (tier === 'input') redirect(`/?season=${seasonId}&owner=${ownerValue}`)

  const staffId = t(formData, 'staffId')
  const evaluationId = t(formData, 'evaluationId')
  const workKey = t(formData, 'work')

  const errorBack = (code: ReassignCode): never => {
    const params = new URLSearchParams({ season: seasonId, owner: ownerValue, reassign: code })
    if (workKey) params.set('work', workKey)
    redirect(`/?${params}`)
  }

  // staffId が空（選択されていない）→ command に渡さず弾く
  if (!staffId) return errorBack('staff_not_available')

  const db = await getDb()
  const result = await reassignInterviewer(db, { evaluationId, staffId })

  if (!result.ok) return errorBack(result.reason)

  revalidatePath('/')
  redirect(await nextTaskUrl(db, tier, seasonId, ownerValue, 'reassign', 'reassigned'))
}

// ----------------------------------------------------------------
// 保留を解く（unhold）
// ----------------------------------------------------------------

export async function cockpitUnholdAction(formData: FormData): Promise<void> {
  const tier = await currentTier()
  const seasonId = t(formData, 'seasonId')
  const ownerValue = t(formData, 'owner')

  if (!tier) redirect('/headhunting')
  if (tier === 'input') redirect(`/?season=${seasonId}&owner=${ownerValue}`)

  const evaluationId = t(formData, 'evaluationId')
  const workKey = t(formData, 'work')

  const errorBack = (code: UnholdCode): never => {
    const params = new URLSearchParams({ season: seasonId, owner: ownerValue, unhold: code })
    if (workKey) params.set('work', workKey)
    redirect(`/?${params}`)
  }

  const db = await getDb()
  const result = await unholdEvaluation(db, { evaluationId })

  if (!result.ok) return errorBack(result.reason)

  revalidatePath('/')
  redirect(await nextTaskUrl(db, tier, seasonId, ownerValue, 'unhold', 'unheld'))
}

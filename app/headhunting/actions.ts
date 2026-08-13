'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getDb } from '../../src/db/server.ts'
import {
  updatePersonProfile, setPersonApproachState, correctApproachState,
  type ProfileFailure,
} from '../../src/commands/profile.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const PHOTO_MAX_BYTES = 2 * 1024 * 1024

/**
 * 書いた場所へ戻す。
 *
 * ★ 編集は**深い層**（`/people/{id}/edit`）に出した（実行⑩）。
 *   ヘッドハンティングの一覧へ戻すと、書いた結果がその場で見られない。
 */
function back(personId: string, seasonId: string, code: string): never {
  const params = new URLSearchParams()
  if (UUID.test(seasonId)) params.set('season', seasonId)
  params.set('edit', code)
  if (!UUID.test(personId)) redirect(`/people?${params}`)
  redirect(`/people/${personId}/edit?${params}`)
}

async function photoFrom(formData: FormData): Promise<string | null | undefined | ProfileFailure> {
  if (formData.get('removePhoto') === '1') return null
  const photo = formData.get('photo')
  if (!(photo instanceof File) || photo.size === 0) return undefined
  if (!PHOTO_TYPES.has(photo.type) || photo.size > PHOTO_MAX_BYTES) return 'bad_photo'
  const base64 = Buffer.from(await photo.arrayBuffer()).toString('base64')
  return `data:${photo.type};base64,${base64}`
}

export async function updateProfileAction(formData: FormData): Promise<void> {
  const personId = String(formData.get('personId') ?? '')
  const seasonId = String(formData.get('seasonId') ?? '')
  const photoDataUrl = await photoFrom(formData)
  if (photoDataUrl === 'bad_photo') back(personId, seasonId, 'bad_photo')

  const db = await getDb()
  const result = await updatePersonProfile(db, {
    personId,
    familyName: String(formData.get('familyName') ?? ''),
    givenName: String(formData.get('givenName') ?? ''),
    familyNameKana: String(formData.get('familyNameKana') ?? ''),
    givenNameKana: String(formData.get('givenNameKana') ?? ''),
    birthDate: String(formData.get('birthDate') ?? ''),
    schoolId: String(formData.get('schoolId') ?? ''),
    faculty: String(formData.get('faculty') ?? ''),
    email: String(formData.get('email') ?? ''),
    phone: String(formData.get('phone') ?? ''),
    lineUserId: String(formData.get('lineUserId') ?? ''),
    referrerPersonId: String(formData.get('referrerPersonId') ?? ''),
    note: String(formData.get('note') ?? ''),
    photoDataUrl,
  })
  if (!result.ok) back(personId, seasonId, result.reason)

  revalidatePath('/headhunting')
  revalidatePath('/borderline')
  revalidatePath(`/people/${personId}`)
  revalidatePath(`/people/${personId}/edit`)
  back(personId, seasonId, 'saved')
}

export async function updateApproachAction(formData: FormData): Promise<void> {
  const personId = String(formData.get('personId') ?? '')
  const seasonId = String(formData.get('seasonId') ?? '')
  const db = await getDb()
  const result = await setPersonApproachState(db, {
    personId,
    seasonId,
    stateId: String(formData.get('stateId') ?? ''),
    staffId: String(formData.get('staffId') ?? ''),
    note: String(formData.get('approachNote') ?? ''),
  })
  if (!result.ok) back(personId, seasonId, result.reason)
  revalidatePath('/headhunting')
  revalidatePath('/borderline')
  revalidatePath(`/people/${personId}/edit`)
  back(personId, seasonId, 'approach_saved')
}

/**
 * 直前のアプローチ状態を訂正する（実行⑮。C-131）。
 *
 * 判定は `src/commands/profile.ts` の `correctApproachState`。
 * 置き直しと**同じフォーム**から打つ ―― 出す欄は同じで、押すボタンだけが違う。
 * 欄を2組に分けると、同じことを2箇所で書くことになる。
 *
 * ★ 見送り（終端の状態）を押し間違えると、置き直しでは
 *   「その日に動きがあった」が積まれる。**訂正は打ち消して置く。**
 */
export async function correctApproachAction(formData: FormData): Promise<void> {
  const personId = String(formData.get('personId') ?? '')
  const seasonId = String(formData.get('seasonId') ?? '')
  const db = await getDb()
  const result = await correctApproachState(db, {
    personId,
    seasonId,
    stateId: String(formData.get('stateId') ?? ''),
    staffId: String(formData.get('staffId') ?? ''),
    note: String(formData.get('approachNote') ?? ''),
  })
  if (!result.ok) back(personId, seasonId, result.reason)
  revalidatePath('/headhunting')
  revalidatePath('/borderline')
  revalidatePath(`/people/${personId}/edit`)
  back(personId, seasonId, 'approach_corrected')
}

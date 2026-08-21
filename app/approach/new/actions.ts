'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getDb } from '../../../src/db/server.ts'
import { addPartnerReach, type AddReachCode } from '../../../src/commands/intake.ts'

/** アプローチ（団体への接触）を記録する。判定は `src/commands/intake.ts`。 */
const text = (f: FormData, n: string) => String(f.get(n) ?? '')
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const PHOTO_MAX_BYTES = 2 * 1024 * 1024

async function photoData(formData: FormData): Promise<string> {
  const photo = formData.get('photo')
  if (!(photo instanceof File) || photo.size === 0) return ''
  if (!PHOTO_TYPES.has(photo.type) || photo.size > PHOTO_MAX_BYTES) return 'bad_photo'
  return `data:${photo.type};base64,${Buffer.from(await photo.arrayBuffer()).toString('base64')}`
}

export async function addReachAction(formData: FormData): Promise<void> {
  const seasonId = text(formData, 'seasonId')
  const photo = await photoData(formData)
  if (photo === 'bad_photo') redirect(`/approach/new?season=${seasonId}&add=bad_photo`)
  const db = await getDb()
  const result = await addPartnerReach(db, {
    partnerId: text(formData, 'partnerId'),
    partnerName: text(formData, 'partnerName'),
    category: text(formData, 'category'),
    contactName: text(formData, 'contactName'),
    contactEmail: text(formData, 'contactEmail'),
    occurredOn: text(formData, 'occurredOn'),
    method: text(formData, 'method'),
    estimatedReach: text(formData, 'estimatedReach'),
    note: text(formData, 'note'),
    photoDataUrl: photo,
  })

  const code: AddReachCode = result.ok ? 'saved' : result.reason
  if (result.ok) {
    revalidatePath('/approach')
    revalidatePath('/people')
  }
  redirect(`/approach/new?season=${seasonId}&add=${code}`)
}

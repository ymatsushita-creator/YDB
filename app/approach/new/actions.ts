'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getDb } from '../../../src/db/server.ts'
import { addPartnerReach, type AddReachCode } from '../../../src/commands/intake.ts'

/** アプローチ（団体への接触）を記録する。判定は `src/commands/intake.ts`。 */
const text = (f: FormData, n: string) => String(f.get(n) ?? '')

export async function addReachAction(formData: FormData): Promise<void> {
  const seasonId = text(formData, 'seasonId')
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
  })

  const code: AddReachCode = result.ok ? 'saved' : result.reason
  if (result.ok) {
    revalidatePath('/approach')
    revalidatePath('/people')
  }
  redirect(`/approach/new?season=${seasonId}&add=${code}`)
}

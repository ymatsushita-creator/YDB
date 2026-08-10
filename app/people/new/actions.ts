'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getDb } from '../../../src/db/server.ts'
import { addCandidate, type AddCandidateCode } from '../../../src/commands/intake.ts'

/**
 * 候補者を登録する（依頼者の指示。実行⑩）。
 *
 * 判定は `src/commands/intake.ts` にある。ここは受け渡しだけ。
 * 素の `<form action={...}>` なので `'use client'` は増えない。
 */
const text = (f: FormData, n: string) => String(f.get(n) ?? '')
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const PHOTO_MAX_BYTES = 2 * 1024 * 1024

async function photoData(formData: FormData): Promise<string | null> {
  const photo = formData.get('photo')
  if (!(photo instanceof File) || photo.size === 0) return null
  if (!PHOTO_TYPES.has(photo.type) || photo.size > PHOTO_MAX_BYTES) return null
  return `data:${photo.type};base64,${Buffer.from(await photo.arrayBuffer()).toString('base64')}`
}

export async function addCandidateAction(formData: FormData): Promise<void> {
  const seasonId = text(formData, 'seasonId')
  const photo = formData.get('photo')
  if (photo instanceof File && photo.size > 0
      && (!PHOTO_TYPES.has(photo.type) || photo.size > PHOTO_MAX_BYTES)) {
    redirect(`/people/new?season=${seasonId}&add=bad_photo`)
  }
  const db = await getDb()
  const result = await addCandidate(db, {
    seasonId,
    familyName: text(formData, 'familyName'),
    givenName: text(formData, 'givenName'),
    familyNameKana: text(formData, 'familyNameKana'),
    givenNameKana: text(formData, 'givenNameKana'),
    birthDate: text(formData, 'birthDate'),
    schoolId: text(formData, 'schoolId'),
    faculty: text(formData, 'faculty'),
    email: text(formData, 'email'),
    phone: text(formData, 'phone'),
    lineUserId: text(formData, 'lineUserId'),
    note: text(formData, 'note'),
    photoDataUrl: await photoData(formData) ?? '',
    channelId: text(formData, 'channelId'),
    contactedOn: text(formData, 'contactedOn'),
    staffId: text(formData, 'staffId'),
    formResponseId: text(formData, 'formResponseId'),
  })

  if (!result.ok) {
    const code: AddCandidateCode = result.reason
    redirect(`/people/new?season=${seasonId}&add=${code}`)
  }

  revalidatePath('/people')
  revalidatePath('/headhunting')
  revalidatePath('/borderline')
  // 登録した人の記録へ送る。**一覧へ返さない** ―― 続けて書くことがある。
  redirect(`/people/${result.personId}?season=${seasonId}&add=saved`)
}

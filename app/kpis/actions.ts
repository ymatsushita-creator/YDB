'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { currentTier } from '../../src/auth/current.ts'
import { getDb } from '../../src/db/server.ts'
import { addKpi, archiveKpi, reviseKpi } from '../../src/commands/kpi.ts'

const t = (f: FormData, key: string) => String(f.get(key) ?? '')

function back(seasonId: string, result: string): never {
  const p = new URLSearchParams({ result })
  if (/^[0-9a-f-]{36}$/i.test(seasonId)) p.set('season', seasonId)
  redirect(`/kpis?${p}`)
}

async function requireAll(seasonId: string) {
  if (await currentTier() !== 'all') back(seasonId, 'forbidden')
}

export async function saveKpiAction(formData: FormData): Promise<void> {
  const seasonId = t(formData, 'seasonId')
  await requireAll(seasonId)
  const db = await getDb()
  const common = {
    seasonId, title: t(formData, 'title'), variable: t(formData, 'variable'),
    value: t(formData, 'value'), memo: t(formData, 'memo'),
  }
  const kpiId = t(formData, 'kpiId')
  const result = kpiId ? await reviseKpi(db, { ...common, kpiId }) : await addKpi(db, common)
  if (result.ok) {
    revalidatePath('/')
    revalidatePath('/kpis')
  }
  back(seasonId, result.ok ? 'saved' : result.reason)
}

export async function archiveKpiAction(formData: FormData): Promise<void> {
  const seasonId = t(formData, 'seasonId')
  await requireAll(seasonId)
  const result = await archiveKpi(await getDb(), t(formData, 'kpiId'), seasonId)
  if (result.ok) {
    revalidatePath('/')
    revalidatePath('/kpis')
  }
  back(seasonId, result.ok ? 'archived' : result.reason)
}

import { eq } from 'drizzle-orm'

import type { Db } from '../client'
import { siteSelections } from '../schema'

export type SiteSelection = typeof siteSelections.$inferSelect

type SelectionInput = Omit<SiteSelection, 'registrationId' | 'selectedAt'>

export const saveSelection = async (db: Db, registrationId: string, input: SelectionInput): Promise<void> => {
  const row = { ...input, registrationId, selectedAt: new Date() }
  await db
    .insert(siteSelections)
    .values(row)
    .onConflictDoUpdate({ target: siteSelections.registrationId, set: { ...row, registrationId: undefined } })
}

export const findSelection = async (db: Db, registrationId: string): Promise<SiteSelection | undefined> => {
  const [row] = await db.select().from(siteSelections).where(eq(siteSelections.registrationId, registrationId)).limit(1)

  return row
}

export const clearSelection = async (db: Db, registrationId: string): Promise<void> => {
  await db.delete(siteSelections).where(eq(siteSelections.registrationId, registrationId))
}

export const updateDestination = async (
  db: Db,
  registrationId: string,
  input: { deliveryHost: string; usingDevelopmentUrl: boolean }
): Promise<void> => {
  await db.update(siteSelections).set(input).where(eq(siteSelections.registrationId, registrationId))
}

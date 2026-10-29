import { eq } from 'drizzle-orm'

import type { Db } from '../client'
import type { OnboardingStep } from '../schema'
import { onboarding, pixelState, siteSelections, stores } from '../schema'

export type StoreRow = typeof stores.$inferSelect
export type SiteSelectionRow = typeof siteSelections.$inferSelect
export type PixelStateRow = typeof pixelState.$inferSelect
export type OnboardingRow = typeof onboarding.$inferSelect

export const findStore = async (db: Db, handle: string): Promise<StoreRow | undefined> => {
  const [row] = await db.select().from(stores).where(eq(stores.handle, handle)).limit(1)
  return row
}

/**
 * Records the install.
 *
 * A reinstall clears `uninstalledAt` but keeps `installedAt`, so "when did this merchant first
 * arrive" survives an uninstall cycle.
 */
export const upsertStore = async (db: Db, handle: string): Promise<void> => {
  await db
    .insert(stores)
    .values({ handle, installedAt: new Date() })
    .onConflictDoUpdate({ target: stores.handle, set: { uninstalledAt: null } })
}

export type ShopFacts = {
  shopId: string | null
  shopName: string | null
  primaryDomain: string | null
  currency: string | null
  ianaTimezone: string | null
}

export const updateShopFacts = async (db: Db, handle: string, facts: ShopFacts): Promise<void> => {
  await db.update(stores).set(facts).where(eq(stores.handle, handle))
}

export const markUninstalled = async (db: Db, handle: string): Promise<void> => {
  await db.update(stores).set({ uninstalledAt: new Date() }).where(eq(stores.handle, handle))
}

export const findSelection = async (db: Db, handle: string): Promise<SiteSelectionRow | undefined> => {
  const [row] = await db.select().from(siteSelections).where(eq(siteSelections.handle, handle)).limit(1)
  return row
}

export type SelectionInput = {
  teamId: string
  teamName: string | null
  domainId: string
  siteName: string | null
  deliveryHost: string
  usingDevelopmentUrl: boolean
  qintoUserId: string | null
}

export const saveSelection = async (db: Db, handle: string, input: SelectionInput): Promise<void> => {
  const row = { handle, ...input, selectedAt: new Date() }
  await db
    .insert(siteSelections)
    .values(row)
    .onConflictDoUpdate({ target: siteSelections.handle, set: { ...row, handle: undefined } })
}

export const clearSelection = async (db: Db, handle: string): Promise<void> => {
  await db.delete(siteSelections).where(eq(siteSelections.handle, handle))
}

export const findPixelState = async (db: Db, handle: string): Promise<PixelStateRow | undefined> => {
  const [row] = await db.select().from(pixelState).where(eq(pixelState.handle, handle)).limit(1)
  return row
}

export type PixelStatePatch = Partial<Omit<PixelStateRow, 'handle'>>

/** Creates the row on first write, so no install path has to remember to seed it. */
export const upsertPixelState = async (db: Db, handle: string, patch: PixelStatePatch): Promise<void> => {
  await db
    .insert(pixelState)
    .values({ handle, ...patch })
    .onConflictDoUpdate({ target: pixelState.handle, set: patch })
}

export const findOnboarding = async (db: Db, handle: string): Promise<OnboardingRow | undefined> => {
  const [row] = await db.select().from(onboarding).where(eq(onboarding.handle, handle)).limit(1)
  return row
}

export type OnboardingPatch = {
  step: OnboardingStep
  teamId?: string | null
  domainId?: string | null
  rootDomain?: string | null
  subdomain?: string | null
}

export const saveOnboarding = async (db: Db, handle: string, patch: OnboardingPatch): Promise<void> => {
  await db
    .insert(onboarding)
    .values({ handle, ...patch, updatedAt: new Date() })
    .onConflictDoUpdate({ target: onboarding.handle, set: { ...patch, updatedAt: new Date() } })
}

export const clearOnboarding = async (db: Db, handle: string): Promise<void> => {
  await db.delete(onboarding).where(eq(onboarding.handle, handle))
}

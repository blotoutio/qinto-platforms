import { and, eq, isNull, lt, or } from 'drizzle-orm'

import type { AppConfig } from '../../config'
import { decryptSecret, encryptSecret, secretAad } from '../../crypto/secret'
import type { Db } from '../client'
import { registrations } from '../schema'

/** An unverified registration that never started a login is swept after this long. */
export const UNVERIFIED_TTL_MS = 24 * 60 * 60 * 1000

/** `last_seen_at` is written at most this often. */
export const SEEN_RESOLUTION_MS = 60 * 60 * 1000

export type Registration = typeof registrations.$inferSelect

const siteSecretAad = (id: string): string => secretAad('registrations', id, 'site_secret_enc')

export const createRegistration = async (
  db: Db,
  config: AppConfig,
  input: { id: string; secret: string; shopId: string; returnUrl: string }
): Promise<void> => {
  await db.insert(registrations).values({
    id: input.id,
    siteSecretEnc: await encryptSecret(config.tokenKek, input.secret, siteSecretAad(input.id)),
    shopId: input.shopId,
    returnUrl: input.returnUrl
  })
}

export const findRegistration = async (db: Db, id: string): Promise<Registration | undefined> => {
  const [row] = await db.select().from(registrations).where(eq(registrations.id, id)).limit(1)

  return row
}

export const readSiteSecret = (config: AppConfig, registration: Registration): Promise<string> => {
  return decryptSecret(config.tokenKek, registration.siteSecretEnc, siteSecretAad(registration.id))
}

export const markVerified = async (db: Db, id: string): Promise<void> => {
  await db.update(registrations).set({ verifiedAt: new Date() }).where(eq(registrations.id, id))
}

/** Dates the install's last signed call, so a plugin that went away can be told apart. */
export const touchRegistration = async (db: Db, id: string, now: number): Promise<void> => {
  const staleOrUnset = or(isNull(registrations.lastSeenAt), lt(registrations.lastSeenAt, new Date(now - SEEN_RESOLUTION_MS)))
  await db
    .update(registrations)
    .set({ lastSeenAt: new Date(now) })
    .where(and(eq(registrations.id, id), staleOrUnset))
}

/** Cascades to the install's grant, selection and any in-flight login. */
export const deleteRegistration = async (db: Db, id: string): Promise<void> => {
  await db.delete(registrations).where(eq(registrations.id, id))
}

/** Returns the query unrun, so the hourly sweep can batch it. */
export const sweepUnverified = (db: Db, now: number) => {
  return db
    .delete(registrations)
    .where(and(isNull(registrations.verifiedAt), lt(registrations.createdAt, new Date(now - UNVERIFIED_TTL_MS))))
}

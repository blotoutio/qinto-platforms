import { eq } from 'drizzle-orm'

import type { AppConfig } from '../config'
import { decryptSecret, encryptSecret, secretAad } from '../crypto/secret'
import type { Db } from '../db/client'
import { shoplineSessions } from '../db/schema'
import type { ShoplineGrant } from './oauth'
import { refreshAccessToken } from './oauth'

/**
 * The store's SHOPLINE grant, with the access token in the clear.
 *
 * Only ever built inside this module, and only ever lives for the duration of one request.
 */
export type StoreSession = {
  handle: string
  accessToken: string
  scope: string
  expiresAt: Date
}

/** One offline session per store, so the id is derived rather than generated. */
export const sessionId = (handle: string): string => `offline_${handle}`

const tokenAad = (handle: string): string => secretAad('shopline_sessions', sessionId(handle), 'access_token_enc')

export class MissingSessionError extends Error {
  constructor(handle: string) {
    super(`no SHOPLINE session for ${handle}`)
    this.name = 'MissingSessionError'
  }
}

/** Writes the grant, encrypting the token on the way in. */
export const storeSession = async (db: Db, config: AppConfig, handle: string, grant: ShoplineGrant): Promise<StoreSession> => {
  const row = {
    id: sessionId(handle),
    handle,
    scope: grant.scope,
    expires: grant.expiresAt,
    accessTokenEnc: await encryptSecret(config.tokenKek, grant.accessToken, tokenAad(handle)),
    updatedAt: new Date()
  }

  await db
    .insert(shoplineSessions)
    .values(row)
    .onConflictDoUpdate({
      target: shoplineSessions.id,
      set: { scope: row.scope, expires: row.expires, accessTokenEnc: row.accessTokenEnc, updatedAt: row.updatedAt }
    })

  return { handle, accessToken: grant.accessToken, scope: grant.scope, expiresAt: grant.expiresAt }
}

export const deleteSession = async (db: Db, handle: string): Promise<void> => {
  await db.delete(shoplineSessions).where(eq(shoplineSessions.id, sessionId(handle)))
}

// A token inside this window is treated as already dead, so a long request cannot outlive it.
const RENEW_BEFORE_MS = 60_000

/**
 * Loads the store's session, renewing the access token when it is expired or nearly so.
 *
 * SHOPLINE's token is not permanent — the dev store issued a ten-hour one — so every caller that
 * needs to reach the Admin API comes through here rather than reading the row itself.
 *
 * @throws MissingSessionError when the store has no row, which is what an uninstalled store looks
 * like. Callers surface that as "reinstall the app", never as a retryable failure.
 */
export const loadSession = async (db: Db, config: AppConfig, handle: string): Promise<StoreSession> => {
  const [row] = await db
    .select()
    .from(shoplineSessions)
    .where(eq(shoplineSessions.id, sessionId(handle)))
    .limit(1)
  if (row === undefined || row.accessTokenEnc === null) {
    throw new MissingSessionError(handle)
  }

  if (row.expires !== null && row.expires.getTime() - RENEW_BEFORE_MS > Date.now()) {
    return {
      handle,
      accessToken: await decryptSecret(config.tokenKek, row.accessTokenEnc, tokenAad(handle)),
      scope: row.scope ?? '',
      expiresAt: row.expires
    }
  }

  return storeSession(db, config, handle, await refreshAccessToken(config, handle))
}

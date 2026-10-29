import { eq } from 'drizzle-orm'

import type { AppConfig } from '../config'
import { decryptSecret, encryptSecret, secretAad } from '../crypto/secret'
import type { Db } from '../db/client'
import { blotoutConnections } from '../db/schema'
import type { BlotoutGrant } from './oauth'
import { refreshGrant } from './oauth'

export type BlotoutConnection = {
  handle: string
  accessToken: string
  scope: string
  expiresAt: Date
  userEmail: string | null
  userId: string | null
  appName: string | null
  connectedAt: Date
}

/**
 * A grant that is gone rather than merely stale.
 *
 * Blotout revokes the whole grant server-side when a rotated refresh token is replayed, so a failed
 * refresh is terminal: the merchant reconnects, we never retry.
 */
export class BlotoutGrantRevokedError extends Error {
  constructor(handle: string, cause: string) {
    super(`Blotout grant for ${handle} is no longer valid: ${cause}`)
    this.name = 'BlotoutGrantRevokedError'
  }
}

export class BlotoutNotConnectedError extends Error {
  constructor(handle: string) {
    super(`${handle} has no Blotout connection`)
    this.name = 'BlotoutNotConnectedError'
  }
}

const accessAad = (handle: string): string => secretAad('qinto_connections', handle, 'access_token_enc')
const refreshAad = (handle: string): string => secretAad('qinto_connections', handle, 'refresh_token_enc')

export type BlotoutIdentity = { userId: string | null; userEmail: string | null; appName: string | null }

export type StoreConnectionInput = { handle: string; grant: BlotoutGrant; identity: BlotoutIdentity }

export const storeConnection = async (db: Db, config: AppConfig, input: StoreConnectionInput): Promise<void> => {
  const { handle, grant, identity } = input
  const encrypted = {
    accessTokenEnc: await encryptSecret(config.tokenKek, grant.accessToken, accessAad(handle)),
    refreshTokenEnc: grant.refreshToken === null ? null : await encryptSecret(config.tokenKek, grant.refreshToken, refreshAad(handle))
  }

  const row = {
    handle,
    blotoutUserId: identity.userId,
    blotoutUserEmail: identity.userEmail,
    appName: identity.appName,
    ...encrypted,
    accessTokenExpiresAt: grant.expiresAt,
    scope: grant.scope,
    connectedAt: new Date(),
    revokedAt: null
  }

  await db
    .insert(blotoutConnections)
    .values(row)
    .onConflictDoUpdate({ target: blotoutConnections.handle, set: { ...row, handle: undefined } })
}

/**
 * Rotates the stored tokens in place, keeping the recorded identity.
 *
 * The refresh token is replaced only when the response carried a new one. RFC 6749 §6 makes issuing
 * one optional, so a server that does not rotate returns the access token alone — and clearing the
 * column on that response would strand the grant with nothing left to refresh with.
 */
const replaceTokens = async (db: Db, config: AppConfig, handle: string, grant: BlotoutGrant): Promise<void> => {
  await db
    .update(blotoutConnections)
    .set({
      accessTokenEnc: await encryptSecret(config.tokenKek, grant.accessToken, accessAad(handle)),
      ...(grant.refreshToken === null
        ? {}
        : { refreshTokenEnc: await encryptSecret(config.tokenKek, grant.refreshToken, refreshAad(handle)) }),
      accessTokenExpiresAt: grant.expiresAt,
      scope: grant.scope
    })
    .where(eq(blotoutConnections.handle, handle))
}

export const markRevoked = async (db: Db, handle: string): Promise<void> => {
  await db.update(blotoutConnections).set({ revokedAt: new Date() }).where(eq(blotoutConnections.handle, handle))
}

export const deleteConnection = async (db: Db, handle: string): Promise<void> => {
  await db.delete(blotoutConnections).where(eq(blotoutConnections.handle, handle))
}

const REFRESH_BEFORE_MS = 60_000

type RenewedToken = { accessToken: string; scope: string; expiresAt: Date }

/**
 * Re-reads the row after a failed refresh, to tell a race apart from a revocation.
 *
 * Returns the token another request stored, or null when the row is unchanged — which means the
 * refresh really did fail and the grant is gone.
 */
const liveTokenAfterRace = async (db: Db, config: AppConfig, handle: string, previousEnc: string): Promise<RenewedToken | null> => {
  const [row] = await db.select().from(blotoutConnections).where(eq(blotoutConnections.handle, handle)).limit(1)
  if (row === undefined || row.revokedAt !== null || row.accessTokenEnc === previousEnc) {
    return null
  }

  if (row.accessTokenExpiresAt.getTime() <= Date.now()) {
    return null
  }

  return {
    accessToken: await decryptSecret(config.tokenKek, row.accessTokenEnc, accessAad(handle)),
    scope: row.scope,
    expiresAt: row.accessTokenExpiresAt
  }
}

/**
 * Loads the store's Blotout connection with a usable access token, refreshing when it is close to
 * expiry.
 *
 * @throws BlotoutNotConnectedError when the store never connected.
 * @throws BlotoutGrantRevokedError when the grant is revoked, or when refreshing fails — the row is
 * marked revoked first, so the next `/api/status` tells the merchant to reconnect rather than
 * retrying a refresh that already revoked the grant server-side.
 */
export const loadConnection = async (db: Db, config: AppConfig, handle: string): Promise<BlotoutConnection> => {
  const [row] = await db.select().from(blotoutConnections).where(eq(blotoutConnections.handle, handle)).limit(1)
  if (row === undefined) {
    throw new BlotoutNotConnectedError(handle)
  }

  // Revoked and never-connected are different things to a merchant: one needs "reconnect", the
  // other needs "connect". `/api/status` renders different copy for each, so they cannot share an
  // error type.
  if (row.revokedAt !== null) {
    throw new BlotoutGrantRevokedError(handle, 'the grant was revoked')
  }

  const identity = {
    handle,
    userEmail: row.blotoutUserEmail,
    userId: row.blotoutUserId,
    appName: row.appName,
    connectedAt: row.connectedAt
  }

  if (row.accessTokenExpiresAt.getTime() - REFRESH_BEFORE_MS > Date.now()) {
    return {
      ...identity,
      accessToken: await decryptSecret(config.tokenKek, row.accessTokenEnc, accessAad(handle)),
      scope: row.scope,
      expiresAt: row.accessTokenExpiresAt
    }
  }

  if (row.refreshTokenEnc === null) {
    await markRevoked(db, handle)
    throw new BlotoutGrantRevokedError(handle, 'access token expired and no refresh token was granted')
  }

  let grant: BlotoutGrant
  try {
    grant = await refreshGrant(config, await decryptSecret(config.tokenKek, row.refreshTokenEnc, refreshAad(handle)))
  } catch (error) {
    // Two concurrent requests near expiry read the same refresh token and both present it. Blotout
    // rotates on use, so the second one looks like a replay and fails — and revoking on that would
    // kill a grant the first request just renewed successfully.
    //
    // So before condemning it, look again: if another request has already stored a live token, this
    // failure was the race and not a revocation. D1 offers no row locking, which is why this is a
    // compare-after-the-fact rather than a lock.
    const renewed = await liveTokenAfterRace(db, config, handle, row.accessTokenEnc)
    if (renewed !== null) {
      return { ...identity, ...renewed }
    }

    await markRevoked(db, handle)
    throw new BlotoutGrantRevokedError(handle, error instanceof Error ? error.message : 'refresh failed')
  }

  await replaceTokens(db, config, handle, grant)

  return { ...identity, accessToken: grant.accessToken, scope: grant.scope, expiresAt: grant.expiresAt }
}

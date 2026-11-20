import { and, eq, isNull, lt, or } from 'drizzle-orm'

import type { AppConfig } from '../config'
import { decryptSecret, encryptSecret, secretAad } from '../crypto/secret'
import type { Db } from '../db/client'
import { deleteRegistration } from '../db/queries/registrations'
import { qintoConnections } from '../db/schema'
import type { QintoGrant } from '../qinto/oauth'
import { QintoOauthError, refreshGrant, revokeToken } from '../qinto/oauth'

/** Refresh when the access token has less than this left. */
const REFRESH_BEFORE_MS = 60_000

/** How long one request may hold the right to refresh; longer than a token call ever takes. */
export const REFRESH_LEASE_MS = 30_000

/** How a request that lost the lease waits for the winner's token. */
const LEASE_POLL = { attempts: 4, intervalMs: 250 }

export class QintoNotConnectedError extends Error {
  constructor(registrationId: string) {
    super(`${registrationId} has no Qinto connection`)
    this.name = 'QintoNotConnectedError'
  }
}

/** Qinto answered `invalid_grant`, or there is no usable refresh token. The admin must reconnect. */
export class QintoGrantRevokedError extends Error {
  constructor(registrationId: string, cause: string) {
    super(`Qinto grant for ${registrationId} is no longer valid: ${cause}`)
    this.name = 'QintoGrantRevokedError'
  }
}

/** Another request holds the refresh lease. Never a revocation. */
export class QintoRefreshBusyError extends Error {
  constructor(registrationId: string) {
    super(`Qinto grant for ${registrationId} is being refreshed by another request`)
    this.name = 'QintoRefreshBusyError'
  }
}

/** Qinto could not answer the refresh (5xx, network, other error). The grant is kept. */
export class QintoUnavailableError extends Error {
  constructor(registrationId: string, cause: string) {
    super(`Qinto could not refresh the grant for ${registrationId}: ${cause}`)
    this.name = 'QintoUnavailableError'
  }
}

type Row = typeof qintoConnections.$inferSelect

const accessAad = (id: string): string => secretAad('qinto_connections', id, 'access_token_enc')
const refreshAad = (id: string): string => secretAad('qinto_connections', id, 'refresh_token_enc')

const byId = (id: string) => eq(qintoConnections.registrationId, id)

const findRow = async (db: Db, id: string): Promise<Row | undefined> => {
  const [row] = await db.select().from(qintoConnections).where(byId(id)).limit(1)

  return row
}

/** Without a new refresh token the result has no `refreshTokenEnc`, so an update keeps the stored one. */
const encryptGrant = async (config: AppConfig, id: string, grant: QintoGrant) => {
  const columns = {
    accessTokenEnc: await encryptSecret(config.tokenKek, grant.accessToken, accessAad(id)),
    accessTokenExpiresAt: grant.expiresAt,
    scope: grant.scope
  }
  if (grant.refreshToken === null) {
    return columns
  }

  return { ...columns, refreshTokenEnc: await encryptSecret(config.tokenKek, grant.refreshToken, refreshAad(id)) }
}

type StoreConnectionInput = {
  registrationId: string
  grant: QintoGrant
  identity: { userId: string | null; userEmail: string | null }
}

export const storeConnection = async (db: Db, config: AppConfig, input: StoreConnectionInput): Promise<void> => {
  const { registrationId, grant, identity } = input
  const row = {
    registrationId,
    qintoUserId: identity.userId,
    qintoUserEmail: identity.userEmail,
    refreshTokenEnc: null,
    ...(await encryptGrant(config, registrationId, grant)),
    connectedAt: new Date(),
    revokedAt: null,
    refreshLeaseUntil: null
  }

  await db
    .insert(qintoConnections)
    .values(row)
    .onConflictDoUpdate({ target: qintoConnections.registrationId, set: { ...row, registrationId: undefined } })
}

const markRevoked = async (db: Db, id: string): Promise<void> => {
  await db.update(qintoConnections).set({ revokedAt: new Date(), refreshLeaseUntil: null }).where(byId(id))
}

/**
 * Compare-and-set lease so only one request presents the refresh token: Qinto revokes the whole
 * grant when a rotated refresh token is replayed. Fails if held, or if the token already rotated.
 */
const acquireLease = async (db: Db, row: Row): Promise<boolean> => {
  const now = Date.now()
  const taken = await db
    .update(qintoConnections)
    .set({ refreshLeaseUntil: new Date(now + REFRESH_LEASE_MS) })
    .where(
      and(
        byId(row.registrationId),
        eq(qintoConnections.accessTokenEnc, row.accessTokenEnc),
        or(isNull(qintoConnections.refreshLeaseUntil), lt(qintoConnections.refreshLeaseUntil, new Date(now)))
      )
    )
    .returning({ id: qintoConnections.registrationId })

  return taken.length === 1
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Polls for the lease holder's new access token. */
const waitForRotation = async (db: Db, config: AppConfig, row: Row): Promise<string> => {
  const id = row.registrationId
  for (let attempt = 0; attempt < LEASE_POLL.attempts; attempt += 1) {
    await sleep(LEASE_POLL.intervalMs)
    const current = await findRow(db, id)
    if (current === undefined || current.revokedAt !== null) {
      throw new QintoGrantRevokedError(id, 'the grant was revoked while refreshing')
    }

    if (current.accessTokenEnc !== row.accessTokenEnc) {
      return decryptSecret(config.tokenKek, current.accessTokenEnc, accessAad(id))
    }
  }

  throw new QintoRefreshBusyError(id)
}

const refreshAccessToken = async (db: Db, config: AppConfig, row: Row): Promise<string> => {
  const id = row.registrationId
  if (row.refreshTokenEnc === null) {
    await markRevoked(db, id)
    throw new QintoGrantRevokedError(id, 'access token expired and no refresh token was granted')
  }

  if (!(await acquireLease(db, row))) {
    return waitForRotation(db, config, row)
  }

  const refreshToken = await decryptSecret(config.tokenKek, row.refreshTokenEnc, refreshAad(id)).catch(() => null)
  if (refreshToken === null) {
    await markRevoked(db, id)
    throw new QintoGrantRevokedError(id, 'the stored refresh token no longer decrypts')
  }

  let grant: QintoGrant
  try {
    grant = await refreshGrant(config, refreshToken)
  } catch (error) {
    const cause = error instanceof Error ? error.message : 'refresh failed'
    // Only the lease holder refreshes, so `invalid_grant` is Qinto refusing the grant, not a race.
    if (error instanceof QintoOauthError && error.code === 'invalid_grant') {
      await markRevoked(db, id)
      throw new QintoGrantRevokedError(id, cause)
    }

    await db.update(qintoConnections).set({ refreshLeaseUntil: null }).where(byId(id))
    throw new QintoUnavailableError(id, cause)
  }

  await db
    .update(qintoConnections)
    .set({ ...(await encryptGrant(config, id, grant)), refreshLeaseUntil: null })
    .where(byId(id))

  return grant.accessToken
}

/** A usable access token for the install, refreshed when close to expiry. */
export const loadAccessToken = async (db: Db, config: AppConfig, registrationId: string): Promise<string> => {
  const row = await findRow(db, registrationId)
  if (row === undefined) {
    throw new QintoNotConnectedError(registrationId)
  }

  if (row.revokedAt !== null) {
    throw new QintoGrantRevokedError(registrationId, 'the grant was revoked')
  }

  if (row.accessTokenExpiresAt.getTime() - REFRESH_BEFORE_MS <= Date.now()) {
    return refreshAccessToken(db, config, row)
  }

  return decryptSecret(config.tokenKek, row.accessTokenEnc, accessAad(registrationId))
}

type StoredGrant = { userId: string | null; tokens: string[] }

/** The stored grant's tokens, for revoking at Qinto. A token that no longer decrypts is left out. */
export const storedGrant = async (db: Db, config: AppConfig, registrationId: string): Promise<StoredGrant | undefined> => {
  const row = await findRow(db, registrationId)
  if (row === undefined) {
    return undefined
  }

  const decryptOrNull = (enc: string, aad: string) => decryptSecret(config.tokenKek, enc, aad).catch(() => null)
  const accessToken = await decryptOrNull(row.accessTokenEnc, accessAad(registrationId))
  const refreshToken = row.refreshTokenEnc === null ? null : await decryptOrNull(row.refreshTokenEnc, refreshAad(registrationId))

  return { userId: row.qintoUserId, tokens: [accessToken, refreshToken].filter((token) => token !== null) }
}

/** Revokes tokens at Qinto, best effort. */
export const revokeTokens = async (config: AppConfig, tokens: string[]): Promise<void> => {
  await Promise.all(tokens.map((token) => revokeToken(config, token)))
}

/** Revokes the install's grant at Qinto, then deletes the install (cascading to its grant and selection). */
export const forgetInstall = async (db: Db, config: AppConfig, registrationId: string): Promise<void> => {
  const grant = await storedGrant(db, config, registrationId)
  await revokeTokens(config, grant?.tokens ?? [])
  await deleteRegistration(db, registrationId)
}

/** For status: no token is decrypted or refreshed. */
export const connectionState = async (db: Db, registrationId: string) => {
  const row = await findRow(db, registrationId)
  if (row === undefined) {
    return { state: 'none', userEmail: null } as const
  }

  return { state: row.revokedAt === null ? 'connected' : 'revoked', userEmail: row.qintoUserEmail } as const
}

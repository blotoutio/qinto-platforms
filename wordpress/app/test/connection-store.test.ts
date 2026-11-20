import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { qintoConnections } from '../src/db/schema'
import {
  connectionState,
  loadAccessToken,
  QintoGrantRevokedError,
  QintoNotConnectedError,
  QintoRefreshBusyError,
  QintoUnavailableError,
  REFRESH_LEASE_MS,
  storedGrant
} from '../src/services/connection-store'
import type { SeededRegistration } from './helpers'
import { jsonResponse, rawColumn, resetDb, seedConnection, seedRegistration, stubFetch, testConfig, testDb } from './helpers'

const db = testDb()
const config = testConfig()

let registration: SeededRegistration
let restore: (() => void) | undefined
beforeEach(async () => {
  await resetDb(db)
  registration = await seedRegistration(db)
})
afterEach(() => {
  restore?.()
  restore = undefined
})

const EXPIRED = new Date(Date.now() - 1000)

describe('loadAccessToken', () => {
  it('tells "never connected" from "revoked"', async () => {
    await expect(loadAccessToken(db, config, registration.id)).rejects.toThrow(QintoNotConnectedError)

    await seedConnection(db, registration.id, { revoked: true })
    await expect(loadAccessToken(db, config, registration.id)).rejects.toThrow(QintoGrantRevokedError)
  })

  it('returns a fresh token without calling Qinto', async () => {
    await seedConnection(db, registration.id)
    const stub = stubFetch(() => jsonResponse({}, 500))
    restore = stub.restore

    expect(await loadAccessToken(db, config, registration.id)).toBe('qoa_access')
    expect(stub.calls).toHaveLength(0)
  })

  it('rotates an expiring grant and stores both new tokens encrypted', async () => {
    await seedConnection(db, registration.id, { expiresAt: EXPIRED })
    const stub = stubFetch(() => jsonResponse({ access_token: 'qoa_2', refresh_token: 'qor_2', expires_in: 3600, scope: 'profile' }))
    restore = stub.restore

    expect(await loadAccessToken(db, config, registration.id)).toBe('qoa_2')
    expect(new URLSearchParams(stub.bodies[0]).get('refresh_token')).toBe('qor_refresh')
    const stored = await rawColumn('qinto_connections', 'refresh_token_enc', 'registration_id', registration.id)
    expect(stored).not.toContain('qor_2')
    expect(await loadAccessToken(db, config, registration.id)).toBe('qoa_2')
  })

  it('keeps the old refresh token when Qinto does not rotate it', async () => {
    await seedConnection(db, registration.id, { expiresAt: EXPIRED })
    const before = await rawColumn('qinto_connections', 'refresh_token_enc', 'registration_id', registration.id)
    restore = stubFetch(() => jsonResponse({ access_token: 'qoa_2', expires_in: 3600 })).restore

    await loadAccessToken(db, config, registration.id)

    expect(await rawColumn('qinto_connections', 'refresh_token_enc', 'registration_id', registration.id)).toBe(before)
  })

  it('marks the grant revoked, and never retries, when the refresh fails', async () => {
    await seedConnection(db, registration.id, { expiresAt: EXPIRED })
    const stub = stubFetch(() => jsonResponse({ error: 'invalid_grant' }, 400))
    restore = stub.restore

    await expect(loadAccessToken(db, config, registration.id)).rejects.toThrow(QintoGrantRevokedError)
    await expect(loadAccessToken(db, config, registration.id)).rejects.toThrow('the grant was revoked')
    expect(stub.calls).toHaveLength(1)
  })

  it.each([
    ['a 5xx', () => jsonResponse({ error: 'server_error' }, 503)],
    ['an error other than invalid_grant', () => jsonResponse({ error: 'invalid_client' }, 401)],
    ['a network failure', () => Promise.reject(new Error('offline'))]
  ])('keeps the grant through %s, and the next request refreshes', async (_label, failure) => {
    await seedConnection(db, registration.id, { expiresAt: EXPIRED })
    restore = stubFetch(failure).restore

    await expect(loadAccessToken(db, config, registration.id)).rejects.toThrow(QintoUnavailableError)
    expect((await connectionState(db, registration.id)).state).toBe('connected')
    expect(await rawColumn('qinto_connections', 'refresh_lease_until', 'registration_id', registration.id)).toBeNull()

    restore()
    restore = stubFetch(() => jsonResponse({ access_token: 'qoa_back', expires_in: 3600 })).restore
    expect(await loadAccessToken(db, config, registration.id)).toBe('qoa_back')
  })

  it('marks the grant revoked when the stored refresh token no longer decrypts', async () => {
    await seedConnection(db, registration.id, { expiresAt: EXPIRED })
    await db
      .update(qintoConnections)
      .set({ refreshTokenEnc: 'v1.broken.broken' })
      .where(eq(qintoConnections.registrationId, registration.id))

    await expect(loadAccessToken(db, config, registration.id)).rejects.toThrow('no longer decrypts')
    expect((await connectionState(db, registration.id)).state).toBe('revoked')
  })

  it('marks the grant revoked when it expired with no refresh token', async () => {
    await seedConnection(db, registration.id, { expiresAt: EXPIRED, refreshToken: null })

    await expect(loadAccessToken(db, config, registration.id)).rejects.toThrow('no refresh token')
    expect((await connectionState(db, registration.id)).state).toBe('revoked')
  })

  it('lets only one of two concurrent requests refresh, and gives the other its token', async () => {
    await seedConnection(db, registration.id, { expiresAt: EXPIRED })
    const stub = stubFetch(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100))

      return jsonResponse({ access_token: 'qoa_2', refresh_token: 'qor_2', expires_in: 3600 })
    })
    restore = stub.restore

    const [first, second] = await Promise.all([loadAccessToken(db, config, registration.id), loadAccessToken(db, config, registration.id)])

    expect(stub.calls).toHaveLength(1)
    expect([first, second]).toEqual(['qoa_2', 'qoa_2'])
    expect(await rawColumn('qinto_connections', 'refresh_lease_until', 'registration_id', registration.id)).toBeNull()
    expect((await connectionState(db, registration.id)).state).toBe('connected')
  })

  it('answers "busy", never "revoked", while another request holds the lease too long', async () => {
    await seedConnection(db, registration.id, { expiresAt: EXPIRED })
    await db
      .update(qintoConnections)
      .set({ refreshLeaseUntil: new Date(Date.now() + REFRESH_LEASE_MS) })
      .where(eq(qintoConnections.registrationId, registration.id))
    const stub = stubFetch(() => jsonResponse({}, 500))
    restore = stub.restore

    await expect(loadAccessToken(db, config, registration.id)).rejects.toThrow(QintoRefreshBusyError)
    expect(stub.calls).toHaveLength(0)
    expect((await connectionState(db, registration.id)).state).toBe('connected')
  })

  it('stops waiting when the lease holder finds the grant revoked', async () => {
    await seedConnection(db, registration.id, { expiresAt: EXPIRED })
    await db
      .update(qintoConnections)
      .set({ refreshLeaseUntil: new Date(Date.now() + REFRESH_LEASE_MS) })
      .where(eq(qintoConnections.registrationId, registration.id))
    setTimeout(() => {
      // A Drizzle query runs only once something awaits it.
      void db
        .update(qintoConnections)
        .set({ revokedAt: new Date() })
        .where(eq(qintoConnections.registrationId, registration.id))
        .then(() => undefined)
    }, 50)

    await expect(loadAccessToken(db, config, registration.id)).rejects.toThrow('revoked while refreshing')
  })

  it('takes over a lease left behind by a request that died', async () => {
    await seedConnection(db, registration.id, { expiresAt: EXPIRED })
    await db
      .update(qintoConnections)
      .set({ refreshLeaseUntil: new Date(Date.now() - 1) })
      .where(eq(qintoConnections.registrationId, registration.id))
    restore = stubFetch(() => jsonResponse({ access_token: 'qoa_3', expires_in: 3600 })).restore

    expect(await loadAccessToken(db, config, registration.id)).toBe('qoa_3')
  })

  it('names a non-Error refresh failure too', async () => {
    await seedConnection(db, registration.id, { expiresAt: EXPIRED })
    restore = stubFetch(() => Promise.reject('socket closed')).restore

    await expect(loadAccessToken(db, config, registration.id)).rejects.toThrow('refresh failed')
  })
})

describe('storedGrant', () => {
  it('hands back both tokens to revoke, and skips one that no longer decrypts', async () => {
    expect(await storedGrant(db, config, registration.id)).toBeUndefined()

    await seedConnection(db, registration.id)
    expect(await storedGrant(db, config, registration.id)).toEqual({ userId: 'user-1', tokens: ['qoa_access', 'qor_refresh'] })

    await db
      .update(qintoConnections)
      .set({ accessTokenEnc: 'v1.x.y', refreshTokenEnc: null })
      .where(eq(qintoConnections.registrationId, registration.id))
    expect(await storedGrant(db, config, registration.id)).toEqual({ userId: 'user-1', tokens: [] })
  })
})

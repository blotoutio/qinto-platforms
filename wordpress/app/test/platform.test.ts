import { env } from 'cloudflare:workers'
import { eq, inArray } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { OAUTH_STATE_TTL_MS, putOauthState } from '../src/db/queries/oauth-states'
import { findRegistration, UNVERIFIED_TTL_MS } from '../src/db/queries/registrations'
import { qintoConnections, registrations, usedNonces } from '../src/db/schema'
import app from '../src/index'
import { QintoApiError, QintoContractError, qintoApi } from '../src/qinto/http'
import { exchangeCode, QintoOauthError, refreshGrant } from '../src/qinto/oauth'
import { sitesResponse } from '../src/qinto/schemas'
import { connectionState } from '../src/services/connection-store'
import { KEEP_ALIVE_AFTER_MS, keepGrantsAlive, reapSilent, SILENT_AFTER_MS, sweepExpired } from '../src/services/scheduled'
import { jsonResponse, rawColumn, resetDb, seedConnection, seedRegistration, stubFetch, testConfig, testDb } from './helpers'
import { call, signedCall, signedHeaders, signedJson } from './routes'

const db = testDb()
const config = testConfig()

let restore: (() => void) | undefined
beforeEach(async () => {
  await resetDb(db)
})
afterEach(() => {
  restore?.()
  restore = undefined
})

describe('qinto transport', () => {
  it('passes Qinto’s error slug through, or "unknown" when it sent none', async () => {
    restore = stubFetch(() => jsonResponse({ error: 'already_exists' }, 409)).restore
    await expect(qintoApi(config, 't').get('/x', sitesResponse)).rejects.toMatchObject({ code: 'already_exists', status: 409 })
    restore()

    restore = stubFetch(() => new Response('<html>', { status: 503 })).restore
    await expect(qintoApi(config, 't').get('/x', sitesResponse)).rejects.toThrow(QintoApiError)
    await expect(qintoApi(config, 't').get('/x', sitesResponse)).rejects.toMatchObject({ code: 'unknown' })
  })

  it('refuses a 2xx body that does not match the contract', async () => {
    restore = stubFetch(() => jsonResponse({ sites: 'nope' })).restore

    await expect(qintoApi(config, 't').get('/x', sitesResponse)).rejects.toThrow(QintoContractError)
  })
})

describe('qinto token endpoint', () => {
  it('names Qinto’s own description, its code, or nothing at all', async () => {
    restore = stubFetch(() => jsonResponse({ error: 'invalid_grant', error_description: 'code used' }, 400)).restore
    await expect(refreshGrant(config, 'r')).rejects.toThrow('400: code used')
    restore()

    restore = stubFetch(() => new Response('<html>', { status: 502 })).restore
    await expect(exchangeCode(config, { code: 'c', verifier: 'v', redirectUri: 'u' })).rejects.toThrow('502: no detail')
    await expect(refreshGrant(config, 'r')).rejects.toBeInstanceOf(QintoOauthError)
  })

  it('treats an unknown lifetime as already due, so it refreshes eagerly', async () => {
    restore = stubFetch(() => jsonResponse({ access_token: 'qoa' })).restore

    const grant = await refreshGrant(config, 'r')

    expect(grant.expiresAt.getTime()).toBeLessThanOrEqual(Date.now())
    expect(grant).toMatchObject({ refreshToken: null, scope: '' })
  })
})

describe('scheduled work', () => {
  it('sweeps used nonces, abandoned logins and registrations never verified', async () => {
    const now = Date.now()
    const stale = await seedRegistration(db, { verified: false })
    const kept = await seedRegistration(db)
    await putOauthState(db, config.tokenKek, { state: 's', registrationId: kept.id, codeVerifier: 'v', wpNonce: 'n' })
    await db.insert(usedNonces).values({ registrationId: kept.id, nonce: 'n1', expiresAt: new Date(now - 1) })

    await sweepExpired(db, now + Math.max(UNVERIFIED_TTL_MS, OAUTH_STATE_TTL_MS) + 1000)

    expect(await findRegistration(db, stale.id)).toBeUndefined()
    expect(await findRegistration(db, kept.id)).toBeDefined()
    expect(await rawColumn('oauth_states', 'state', 'state', 's')).toBeNull()
    expect(await rawColumn('used_nonces', 'nonce', 'nonce', 'n1')).toBeNull()
  })

  it('rotates idle grants and counts the dead ones', async () => {
    const idle = await seedRegistration(db)
    const dead = await seedRegistration(db)
    const active = await seedRegistration(db)
    const longAgo = new Date(Date.now() - KEEP_ALIVE_AFTER_MS - 1000)
    await seedConnection(db, idle.id, { expiresAt: longAgo, refreshToken: 'qor_idle' })
    await seedConnection(db, dead.id, { expiresAt: new Date(longAgo.getTime() - 1000), refreshToken: 'qor_dead' })
    await seedConnection(db, active.id)
    restore = stubFetch(async (request) => {
      const body = await request.clone().text()

      return body.includes('qor_dead')
        ? jsonResponse({ error: 'invalid_grant' }, 400)
        : jsonResponse({ access_token: 'qoa', expires_in: 3600 })
    }).restore

    expect(await keepGrantsAlive(db, config)).toEqual({ refreshed: 1, revoked: 1, skipped: 0 })
    expect((await connectionState(db, dead.id)).state).toBe('revoked')
  })

  it('carries on past a grant it cannot refresh this hour', async () => {
    const stuck = await seedRegistration(db)
    const idle = await seedRegistration(db)
    const longAgo = new Date(Date.now() - KEEP_ALIVE_AFTER_MS - 1000)
    await seedConnection(db, stuck.id, { expiresAt: new Date(longAgo.getTime() - 1000), refreshToken: 'qor_stuck' })
    await seedConnection(db, idle.id, { expiresAt: longAgo, refreshToken: 'qor_idle' })
    await db
      .update(qintoConnections)
      .set({ refreshLeaseUntil: new Date(Date.now() + 60_000) })
      .where(eq(qintoConnections.registrationId, stuck.id))
    restore = stubFetch(() => jsonResponse({ access_token: 'qoa', expires_in: 3600 })).restore

    expect(await keepGrantsAlive(db, config)).toEqual({ refreshed: 1, revoked: 0, skipped: 1 })
    expect((await connectionState(db, stuck.id)).state).toBe('connected')
  })

  it('stops keeping a silent install alive, then revokes its grant and forgets it', async () => {
    const now = Date.now()
    const silent = await seedRegistration(db)
    const neverConnected = await seedRegistration(db)
    const quiet = await seedRegistration(db)
    const longAgo = new Date(now - KEEP_ALIVE_AFTER_MS - 1000)
    await seedConnection(db, silent.id, { expiresAt: longAgo, refreshToken: 'qor_silent' })
    await seedConnection(db, quiet.id, { expiresAt: longAgo, refreshToken: 'qor_quiet' })
    await db
      .update(registrations)
      .set({ lastSeenAt: new Date(now - SILENT_AFTER_MS - 1000) })
      .where(inArray(registrations.id, [silent.id, neverConnected.id]))
    const stub = stubFetch(() => jsonResponse({ access_token: 'qoa', expires_in: 3600 }))
    restore = stub.restore

    expect(await keepGrantsAlive(db, config, now)).toEqual({ refreshed: 1, revoked: 0, skipped: 0 })
    expect(stub.bodies.join()).not.toContain('qor_silent')

    expect(await reapSilent(db, config, now)).toBe(2)
    const revoked = stub.bodies.slice(1).map((body) => new URLSearchParams(body).get('token'))
    expect(revoked.sort()).toEqual(['qoa_access', 'qor_silent'])
    expect(await findRegistration(db, silent.id)).toBeUndefined()
    expect(await findRegistration(db, neverConnected.id)).toBeUndefined()
    expect(await findRegistration(db, quiet.id)).toBeDefined()
  })

  it('takes a check-in as a sign of life', async () => {
    const registration = await seedRegistration(db)

    expect((await signedCall(registration, '/heartbeat', { method: 'POST' })).status).toBe(204)
    expect(await rawColumn('registrations', 'last_seen_at', 'id', registration.id)).not.toBeNull()
  })

  it('runs both from the cron entry point', async () => {
    const waits: Promise<unknown>[] = []
    const ctx = { waitUntil: (promise: Promise<unknown>) => waits.push(promise), passThroughOnException: () => undefined, props: {} }

    await app.scheduled?.(
      { cron: '17 * * * *', scheduledTime: Date.now(), noRetry: () => undefined } as ScheduledController,
      env,
      ctx as never
    )
    await Promise.all(waits)

    expect(waits).toHaveLength(1)
  })
})

describe('the error table', () => {
  it('answers health and an unknown path', async () => {
    expect(await (await call('/health')).json()).toEqual({ ok: true })
    expect((await call('/nope')).status).toBe(404)
  })

  it('says "misconfigured" without naming a secret', async () => {
    const response = await call('/health', { env: { TOKEN_KEK: '' } })

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'misconfigured' })
  })

  it('maps a broken Qinto contract, a not-connected install and an unexpected failure', async () => {
    const registration = await seedRegistration(db)
    expect((await signedJson(registration, '/sites')).body).toEqual({ error: 'qinto_not_connected' })

    await seedConnection(db, registration.id)
    restore = stubFetch(() => jsonResponse({ teams: 'nope' })).restore
    expect((await signedJson(registration, '/sites')).body).toEqual({ error: 'qinto_contract' })
    restore()

    restore = stubFetch(() => Promise.reject(new Error('boom'))).restore
    const failed = await signedJson<{ error: string; debug?: string }>(registration, '/sites')
    expect(failed.status).toBe(500)
    expect(failed.body.debug).toContain('boom')
  })

  it('says why a signed call was refused, so the plugin forgets its secret only when it should', async () => {
    const registration = await seedRegistration(db)
    const skewed = await signedJson(registration, '/status', { tamper: { timestamp: String(Math.floor(Date.now() / 1000) + 600) } })
    const unknown = await signedJson({ ...registration, id: crypto.randomUUID() }, '/status')

    expect(skewed).toEqual({ status: 401, body: { error: 'clock_skew' } })
    expect(unknown).toEqual({ status: 401, body: { error: 'unknown_registration' } })
  })

  it('says "qinto_unavailable", and keeps the grant, when Qinto cannot refresh it', async () => {
    const registration = await seedRegistration(db)
    await seedConnection(db, registration.id, { expiresAt: new Date(0) })
    restore = stubFetch(() => jsonResponse({}, 502)).restore

    expect(await signedJson(registration, '/sites')).toEqual({ status: 503, body: { error: 'qinto_unavailable' } })
    expect((await connectionState(db, registration.id)).state).toBe('connected')
  })

  it('says "busy" with a retry hint while another request is refreshing', async () => {
    const registration = await seedRegistration(db)
    await seedConnection(db, registration.id, { expiresAt: new Date(0) })
    await db.update(qintoConnections).set({ refreshLeaseUntil: new Date(Date.now() + 60_000) })

    const response = await signedCall(registration, '/sites')

    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('1')
  })

  it('says "revoked" for a dead grant, and hides the debug detail outside test and local', async () => {
    const registration = await seedRegistration(db)
    await seedConnection(db, registration.id, { revoked: true })
    expect((await signedJson(registration, '/sites')).body).toEqual({ error: 'qinto_grant_revoked' })

    const live = await seedRegistration(db)
    await seedConnection(db, live.id)
    restore = stubFetch(() => Promise.reject(new Error('boom'))).restore
    const signed = await signedHeaders(live, '/sites')
    const response = await call('/sites', { headers: signed.headers, env: { DEBUG_ERRORS: 'false' } })

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'internal' })
  })
})

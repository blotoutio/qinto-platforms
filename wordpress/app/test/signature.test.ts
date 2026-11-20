import { beforeEach, describe, expect, it } from 'vitest'

import { SEEN_RESOLUTION_MS } from '../src/db/queries/registrations'
import { canonicalMessage, SIGNATURE_WINDOW_MS, verifySignedRequest } from '../src/services/signature'
import type { SeededRegistration } from './helpers'
import { rawColumn, resetDb, seedRegistration, testConfig, testDb } from './helpers'
import { ORIGIN, signedHeaders } from './routes'

const db = testDb()
const config = testConfig()

let registration: SeededRegistration

beforeEach(async () => {
  await resetDb(db)
  registration = await seedRegistration(db)
})

const PATH = '/select-site'
const BODY = { teamId: 't', domainId: 'd' }

const verify = async (
  signed: Awaited<ReturnType<typeof signedHeaders>>,
  overrides: { method?: string; path?: string; body?: string } = {}
) => {
  const request = {
    headers: new Headers(signed.headers),
    method: overrides.method ?? 'POST',
    url: `${ORIGIN}${overrides.path ?? PATH}`,
    body: overrides.body ?? signed.body
  }

  return verifySignedRequest(db, config, request, { allowUnverified: false })
}

describe('canonicalMessage', () => {
  it('is versioned and newline-joined, so the PHP signer can match it byte for byte', () => {
    const message = canonicalMessage({
      registrationId: 'r',
      timestamp: '1',
      nonce: 'n',
      shopId: 's',
      method: 'POST',
      pathAndQuery: '/p?q=1',
      bodySha256: 'h'
    })

    expect(message).toBe('v1\nr\n1\nn\ns\nPOST\n/p?q=1\nh')
  })
})

describe('verifySignedRequest', () => {
  it('accepts a call signed by the install', async () => {
    const result = await verify(await signedHeaders(registration, PATH, { method: 'POST', body: BODY }))

    expect(result.ok).toBe(true)
  })

  it('refuses the same signature twice', async () => {
    const signed = await signedHeaders(registration, PATH, { method: 'POST', body: BODY })
    await verify(signed)

    expect(await verify(signed)).toEqual({ ok: false, reason: 'replay' })
  })

  it('keeps the nonce per install and until the signature itself expires', async () => {
    const other = await seedRegistration(db, { shopId: 'https://other.example.com' })
    const nonce = 'shared-nonce-0123456789'
    const timestamp = String(Math.floor(Date.now() / 1000) + 240)
    await verify(await signedHeaders(other, PATH, { method: 'POST', body: BODY, tamper: { nonce } }))

    expect((await verify(await signedHeaders(registration, PATH, { method: 'POST', body: BODY, tamper: { nonce, timestamp } }))).ok).toBe(
      true
    )
    const stored = await rawColumn('used_nonces', 'expires_at', 'registration_id', registration.id)
    expect(stored).toBe(Number(timestamp) * 1000 + SIGNATURE_WINDOW_MS)
  })

  it.each([
    ['another body', { body: '{"teamId":"other"}' }],
    ['another path', { path: '/destination' }],
    ['another method', { method: 'PUT' }]
  ])('binds the request: a signature does not carry over to %s', async (_label, overrides) => {
    const signed = await signedHeaders(registration, PATH, { method: 'POST', body: BODY })

    expect(await verify(signed, overrides)).toEqual({ ok: false, reason: 'unauthorized' })
  })

  it("binds the stored shop, so another site's identity cannot be claimed", async () => {
    const signed = await signedHeaders(registration, PATH, { method: 'POST', body: BODY, tamper: { shopId: 'https://other.example.com' } })

    expect((await verify(signed)).ok).toBe(false)
  })

  it("refuses another install's secret", async () => {
    const signed = await signedHeaders(registration, PATH, { method: 'POST', body: BODY, secret: 'f'.repeat(64) })

    expect((await verify(signed)).ok).toBe(false)
  })

  it('refuses a call outside the clock window, either side, as a clock problem', async () => {
    const skew = (SIGNATURE_WINDOW_MS + 60_000) / 1000
    for (const seconds of [-skew, skew]) {
      const timestamp = String(Math.floor(Date.now() / 1000 + seconds))
      const signed = await signedHeaders(registration, PATH, { method: 'POST', body: BODY, tamper: { timestamp } })

      expect(await verify(signed)).toEqual({ ok: false, reason: 'clock_skew' })
    }
  })

  it('refuses malformed headers before touching the database', async () => {
    const signed = await signedHeaders(registration, PATH, { method: 'POST', body: BODY })
    for (const [name, value] of [
      ['X-Blotout-Registration', 'not-a-uuid'],
      ['X-Blotout-Ts', 'soon'],
      ['X-Blotout-Nonce', 'short'],
      ['X-Blotout-Sig', 'XYZ']
    ] as const) {
      expect((await verify({ ...signed, headers: { ...signed.headers, [name]: value } })).ok).toBe(false)
    }

    expect((await verify({ ...signed, headers: {} as typeof signed.headers })).ok).toBe(false)
  })

  it('refuses an unknown registration, and says so', async () => {
    const signed = await signedHeaders({ ...registration, id: crypto.randomUUID() }, PATH, { method: 'POST', body: BODY })

    expect(await verify(signed)).toEqual({ ok: false, reason: 'unknown_registration' })
  })

  it('dates the last signed call, at most once an hour', async () => {
    const lastSeen = () => rawColumn('registrations', 'last_seen_at', 'id', registration.id)
    const at = async (now: number) => {
      const signed = await signedHeaders(registration, PATH, {
        method: 'POST',
        body: BODY,
        tamper: { timestamp: String(Math.floor(now / 1000)) }
      })
      const request = { headers: new Headers(signed.headers), method: 'POST', url: `${ORIGIN}${PATH}`, body: signed.body }
      await verifySignedRequest(db, config, request, { allowUnverified: false, now })
    }
    const start = Date.now()

    expect(await lastSeen()).toBeNull()
    await at(start)
    expect(await lastSeen()).toBe(start)
    await at(start + 1000)
    expect(await lastSeen()).toBe(start)
    await at(start + SEEN_RESOLUTION_MS + 1000)
    expect(await lastSeen()).toBe(start + SEEN_RESOLUTION_MS + 1000)
  })

  it('refuses an unverified registration unless the route allows it', async () => {
    const fresh = await seedRegistration(db, { verified: false })
    const signed = await signedHeaders(fresh, PATH, { method: 'POST', body: BODY })
    const request = { headers: new Headers(signed.headers), method: 'POST', url: `${ORIGIN}${PATH}`, body: signed.body }

    expect(await verifySignedRequest(db, config, request, { allowUnverified: false })).toEqual({
      ok: false,
      reason: 'unknown_registration'
    })
    expect((await verifySignedRequest(db, config, request, { allowUnverified: true })).ok).toBe(true)
  })
})

import { beforeEach, describe, expect, it } from 'vitest'

import { markRevoked, storeConnection } from '../src/blotout/connection-store'
import {
  findPixelState,
  findSelection,
  findStore,
  saveOnboarding,
  saveSelection,
  updateShopFacts,
  upsertPixelState,
  upsertStore
} from '../src/db/queries/stores'
import type { StatusPayload } from '../src/routes/status'
import { storeSession } from '../src/shopline/session-store'
import { jsonResponse, resetDb, stubFetch, testConfig, testDb } from './helpers'
import { call, callJson, HANDLE, sessionToken } from './routes'

const config = testConfig()
const db = testDb()

const TEAM = 'team-1'
const DOMAIN = 'domain-1'
const HOST = 'q.srini-shopline.com'

const connect = () =>
  storeConnection(db, config, {
    handle: HANDLE,
    grant: { accessToken: 'qoa_live', refreshToken: 'qor_live', scope: 'team:read domain:write', expiresAt: new Date(Date.now() + 36e5) },
    identity: { userId: 'u', userEmail: 'karri@blotout.io', appName: 'Blotout' }
  })

const select = (overrides: { deliveryHost?: string; usingDevelopmentUrl?: boolean; qintoUserId?: string | null } = {}) =>
  saveSelection(db, HANDLE, {
    teamId: TEAM,
    teamName: 'karri’s Team',
    domainId: DOMAIN,
    siteName: 'srini-shopline.com',
    deliveryHost: overrides.deliveryHost ?? HOST,
    usingDevelopmentUrl: overrides.usingDevelopmentUrl ?? false,
    qintoUserId: overrides.qintoUserId === undefined ? 'u' : overrides.qintoUserId
  })

const site = (deliveryLive: boolean) =>
  jsonResponse({
    site: {
      domainId: DOMAIN,
      name: 'srini-shopline.com',
      domain: HOST,
      rootDomain: 'srini-shopline.com',
      subdomain: 'q',
      status: 'active',
      developmentUrl: null,
      deliveryMode: 'domain',
      deliveryLive,
      hostId: 'host-1'
    }
  })

/** Blotout's own DNS verdict for the selected site. `unreadable` is a Blotout-side failure, not a transport one. */
const dns = (state: 'valid' | 'invalid' | 'unreadable' | undefined) => {
  if (state === 'unreadable') {
    return jsonResponse({ error: 'server_error' }, 500)
  }

  const valid = state !== 'invalid'

  return jsonResponse({
    records: [{ type: 'CNAME', name: 'q', value: 'q.customers.qinto.tech' }],
    valid,
    required: true,
    checked: true,
    failureKind: valid ? null : 'missing',
    message: valid ? 'ok' : 'custom hostname does not CNAME to this zone.'
  })
}

type StubOptions = { deliveryLive?: boolean; pushOk?: boolean; dns?: 'valid' | 'invalid' | 'unreadable' }

const stub = (options: StubOptions = {}) =>
  stubFetch((request) => {
    const { pathname } = new URL(request.url)
    if (pathname.endsWith('/pixel/update_config.json')) {
      // SHOPLINE's real refusal, verbatim: a store with no pixel record answers 500 `record not
      // found`, and the body is the only thing that says which failure it is.
      return options.pushOk === false ? jsonResponse({ errors: 'record not found' }, 500) : jsonResponse({ data: {} })
    }

    if (pathname.endsWith('/dns')) {
      return dns(options.dns)
    }

    return site(options.deliveryLive ?? true)
  })

beforeEach(async () => {
  await resetDb(db)
  await upsertStore(db, HANDLE)
  await storeSession(db, config, HANDLE, {
    accessToken: 'shopline-token',
    scope: 'read_pixels,write_pixels',
    expiresAt: new Date(Date.now() + 36e5)
  })
  await updateShopFacts(db, HANDLE, {
    shopId: '1',
    shopName: 'Srini Test',
    primaryDomain: `${HANDLE}.myshopline.com`,
    currency: 'USD',
    ianaTimezone: 'Asia/Kolkata'
  })
})

describe('GET /api/status', () => {
  it('sends a disconnected store to the connect screen', async () => {
    const { status, body } = await callJson<StatusPayload>('/api/status')

    expect(status).toBe(200)
    expect(body.screen).toBe('connect')
    expect(body.connection).toEqual({ connected: false, reason: 'never' })
    expect(body.selection).toBeNull()
  })

  it('distinguishes a revoked grant from one that never existed', async () => {
    await connect()
    await markRevoked(db, HANDLE)

    const { body } = await callJson<StatusPayload>('/api/status')

    expect(body.screen).toBe('connect')
    expect(body.connection).toEqual({ connected: false, reason: 'revoked' })
  })

  describe('when a grant is revoked while a site is selected', () => {
    beforeEach(async () => {
      await connect()
      await select()
      await upsertPixelState(db, HANDLE, { trackingEnabled: true, pushedEnabled: true, destination: HOST })
      await markRevoked(db, HANDLE)
    })

    it('leaves tracking running with the saved config', async () => {
      const stubs = stub()
      try {
        await callJson<StatusPayload>('/api/status')

        expect(stubs.calls.some((request) => request.url.endsWith('/pixel/update_config.json'))).toBe(false)
      } finally {
        stubs.restore()
      }

      await expect(findPixelState(db, HANDLE)).resolves.toMatchObject({ trackingEnabled: true, pushedEnabled: true })
    })

    it('shows the connect screen but keeps the selection', async () => {
      const stubs = stub()
      try {
        const { body } = await callJson<StatusPayload>('/api/status')

        expect(body.screen).toBe('connect')
        expect(body.selection).toMatchObject({ domainId: DOMAIN, deliveryHost: HOST })
      } finally {
        stubs.restore()
      }

      await expect(findSelection(db, HANDLE)).resolves.toMatchObject({ domainId: DOMAIN })
    })

    it('sends a reconnecting store straight back to its site', async () => {
      const stubs = stub()
      try {
        await callJson<StatusPayload>('/api/status')
        // Reconnecting is what `storeConnection` does after a fresh consent.
        await connect()

        expect((await callJson<StatusPayload>('/api/status')).body.screen).toBe('ready')
      } finally {
        stubs.restore()
      }
    })
  })

  it('sends a connected store with no site to the chooser', async () => {
    await connect()

    const { body } = await callJson<StatusPayload>('/api/status')

    expect(body.screen).toBe('choose')
    expect(body.connection).toMatchObject({ connected: true, userEmail: 'karri@blotout.io', scopes: ['team:read', 'domain:write'] })
  })

  it('sends a store mid-onboarding back to where it left off', async () => {
    await connect()
    await saveOnboarding(db, HANDLE, { step: 'dns', teamId: TEAM, domainId: DOMAIN, rootDomain: 'srini-shopline.com' })

    const { body } = await callJson<StatusPayload>('/api/status')

    expect(body.screen).toBe('onboarding')
    expect(body.onboarding).toMatchObject({ step: 'dns', teamId: TEAM, domainId: DOMAIN })
  })

  it('treats the choose and done steps as no flow in progress', async () => {
    await connect()
    await saveOnboarding(db, HANDLE, { step: 'choose' })

    expect((await callJson<StatusPayload>('/api/status')).body.screen).toBe('choose')
  })

  it('sends a store with a selection to the ready screen', async () => {
    await connect()
    await select()
    const stubs = stub()

    try {
      const { body } = await callJson<StatusPayload>('/api/status')

      expect(body.screen).toBe('ready')
      expect(body.selection).toMatchObject({ deliveryHost: HOST, deliveryLive: true, teamName: 'karri’s Team' })
    } finally {
      stubs.restore()
    }
  })

  it('reads deliveryLive from Blotout rather than from our own row', async () => {
    await connect()
    await select()
    const stubs = stub({ deliveryLive: false })

    try {
      // A site can stop serving without telling us, so a stored copy would go stale silently.
      expect((await callJson<StatusPayload>('/api/status')).body.selection?.deliveryLive).toBe(false)
    } finally {
      stubs.restore()
    }
  })

  describe('when the connected account cannot read the saved site', () => {
    const unreadable = (status: number) => stubFetch(() => jsonResponse({ error: 'not_found' }, status))

    beforeEach(async () => {
      await connect()
      await upsertPixelState(db, HANDLE, { trackingEnabled: true, pushedEnabled: true, destination: HOST })
    })

    it('asks the same Qinto user to approve the team, keeping the site and tracking', async () => {
      await select()
      const stubs = unreadable(403)

      try {
        const { body } = await callJson<StatusPayload>('/api/status')

        expect(body.screen).toBe('ready')
        expect(body.selection).toMatchObject({ deliveryHost: HOST, notVisible: 'team_not_approved' })
        expect(body.tracking.enabled).toBe(true)
      } finally {
        stubs.restore()
      }
    })

    it('sends a different Qinto user to the chooser without touching the live selection', async () => {
      await select({ qintoUserId: 'someone-else' })
      const stubs = unreadable(404)

      try {
        const { body } = await callJson<StatusPayload>('/api/status')

        expect(body.screen).toBe('choose')
        expect(body.selection).toMatchObject({ deliveryHost: HOST, notVisible: 'other_account' })
        expect(stubs.calls.some((request) => request.url.endsWith('/pixel/update_config.json'))).toBe(false)
      } finally {
        stubs.restore()
      }

      await expect(findSelection(db, HANDLE)).resolves.toMatchObject({ deliveryHost: HOST })
      await expect(findPixelState(db, HANDLE)).resolves.toMatchObject({ trackingEnabled: true, pushedEnabled: true })
    })

    it('treats a selection with no recorded owner as another account', async () => {
      await select({ qintoUserId: null })
      const stubs = unreadable(403)

      try {
        expect((await callJson<StatusPayload>('/api/status')).body.selection?.notVisible).toBe('other_account')
      } finally {
        stubs.restore()
      }
    })

    it('claims nothing when Blotout cannot answer, because that proves nothing', async () => {
      await select()
      const stubs = unreadable(503)

      try {
        const { status, body } = await callJson<StatusPayload>('/api/status')

        expect(status).toBe(200)
        expect(body.screen).toBe('ready')
        expect(body.selection).toMatchObject({ deliveryLive: false, notVisible: null })
        expect(body.tracking.live).toBe(false)
      } finally {
        stubs.restore()
      }
    })
  })

  it('refuses to call a store live when its delivery host does not resolve yet', async () => {
    // Blotout reports a site as serving the moment it is deployed, before the merchant has added the
    // CNAME. Seen for real: a freshly deployed host answered nothing while the app called it live.
    await connect()
    await select({ usingDevelopmentUrl: false })
    await upsertPixelState(db, HANDLE, { trackingEnabled: true, pushedEnabled: true })
    const stubs = stub({ dns: 'invalid' })

    try {
      const { body } = await callJson<StatusPayload>('/api/status')

      expect(body.selection?.dnsValid).toBe(false)
      expect(body.selection?.dnsMessage).toContain('CNAME')
      // Carried on the status payload so the screen can print the records without a second Blotout
      // round trip — the read above already has them.
      expect(body.selection?.dnsRecords).toEqual([{ type: 'CNAME', name: 'q', value: 'q.customers.qinto.tech' }])
      // Everything else says yes. This is the only thing standing between the merchant and a
      // screen that reads "Live" while every event dies in the browser.
      expect(body.selection?.deliveryLive).toBe(true)
      expect(body.tracking).toMatchObject({ enabled: true, pushedEnabled: true, live: false })
    } finally {
      stubs.restore()
    }
  })

  it('calls it live once the records are satisfied', async () => {
    await connect()
    await select({ usingDevelopmentUrl: false })
    await upsertPixelState(db, HANDLE, { trackingEnabled: true, pushedEnabled: true })
    const stubs = stub({ dns: 'valid' })

    try {
      const { body } = await callJson<StatusPayload>('/api/status')

      expect(body.selection?.dnsValid).toBe(true)
      expect(body.selection?.dnsMessage).toBeNull()
      // Blotout reports the records of a verified site too; showing a merchant records they have
      // already published would read as work outstanding.
      expect(body.selection?.dnsRecords).toEqual([])
      expect(body.tracking.live).toBe(true)
    } finally {
      stubs.restore()
    }
  })

  it('leaves the verdict unknown when the check cannot be read, rather than reporting a store down', async () => {
    await connect()
    await select({ usingDevelopmentUrl: false })
    await upsertPixelState(db, HANDLE, { trackingEnabled: true, pushedEnabled: true })
    const stubs = stub({ dns: 'unreadable' })

    try {
      const { body } = await callJson<StatusPayload>('/api/status')

      expect(body.selection?.dnsValid).toBeNull()
      expect(body.selection?.dnsRecords).toEqual([])
      expect(body.tracking.live).toBe(true)
    } finally {
      stubs.restore()
    }
  })

  it('never asks about DNS for a development URL, which needs no records', async () => {
    await connect()
    await select({ usingDevelopmentUrl: true })
    await upsertPixelState(db, HANDLE, { trackingEnabled: true, pushedEnabled: true })
    const stubs = stub()

    try {
      const { body } = await callJson<StatusPayload>('/api/status')

      expect(body.selection?.dnsValid).toBeNull()
      expect(body.tracking.live).toBe(true)
      expect(stubs.calls.some((call) => new URL(call.url).pathname.endsWith('/dns'))).toBe(false)
    } finally {
      stubs.restore()
    }
  })

  it('carries why the last push failed, so the screen can withhold a pointless retry', async () => {
    await connect()
    await select({ usingDevelopmentUrl: true })
    const stubs = stub({ pushOk: false })

    try {
      // A real first push against a store with no pixel record: SHOPLINE answers 500 `record not
      // found` and nothing a merchant does can change it.
      await call('/api/settings/retry-push', { method: 'POST' })
    } finally {
      stubs.restore()
    }

    const readback = stub()
    try {
      const { body } = await callJson<StatusPayload>('/api/status')

      expect(body.tracking.pushedEnabled).toBeNull()
      expect(body.tracking.lastPushReason).toBe('extension_not_published')
    } finally {
      readback.restore()
    }
  })

  it('marks a store still on its myshopline.com domain', async () => {
    expect((await callJson<StatusPayload>('/api/status')).body.store.usesDefaultDomain).toBe(true)
  })

  it('marks a store on its own domain', async () => {
    await updateShopFacts(db, HANDLE, {
      shopId: '1',
      shopName: 'Srini Test',
      primaryDomain: 'shop.example.com',
      currency: 'USD',
      ianaTimezone: 'UTC'
    })

    expect((await callJson<StatusPayload>('/api/status')).body.store.usesDefaultDomain).toBe(false)
  })

  it('never re-fetches the shop facts, because the endpoint is forbidden to this app', async () => {
    await updateShopFacts(db, HANDLE, { shopId: null, shopName: null, primaryDomain: null, currency: null, ianaTimezone: null })
    // Any Admin API call from here would be the one SHOPLINE answers
    // `403 ACCESS_TOKEN is no permission!` to, on the endpoint the SPA polls.
    const stubs = stubFetch((url) => {
      throw new Error(`/api/status must not call SHOPLINE: ${url}`)
    })

    try {
      const { status, body } = await callJson<StatusPayload>('/api/status')

      expect(status).toBe(200)
      expect(body.store.primaryDomain).toBeNull()
      expect(body.store.shopName).toBeNull()
    } finally {
      stubs.restore()
    }

    await expect(findStore(db, HANDLE)).resolves.toMatchObject({ primaryDomain: null })
  })

  it('reports a store with no session as not installed rather than as an internal error', async () => {
    await resetDb(db)

    const { status, body } = await callJson<{ error: string }>('/api/status')

    expect(status).toBe(200)
    expect((body as unknown as StatusPayload).screen).toBe('connect')
  })

  it('defaults tracking to on for a store that has never been set up', async () => {
    const { body } = await callJson<StatusPayload>('/api/status')

    // "Never set up" is the absence of a selection, not a disabled switch.
    expect(body.tracking).toMatchObject({ enabled: true, pushedEnabled: null, live: false })
  })

  it('requires a session token', async () => {
    expect((await call('/api/status', { token: null })).status).toBe(401)
  })

  it('acts only for the store the session token names', async () => {
    await connect()
    await select()
    const stubs = stub()

    try {
      const { body } = await callJson<StatusPayload>('/api/status', { token: await sessionToken({ handle: 'someone-else' }) })

      // A handle from a token, never from a query parameter — otherwise any caller could act as any
      // store.
      expect(body.store.handle).toBe('someone-else')
      expect(body.screen).toBe('connect')
    } finally {
      stubs.restore()
    }
  })
})

describe('PUT /api/settings/tracking — the kill switch', () => {
  beforeEach(async () => {
    await connect()
    await select()
    await upsertPixelState(db, HANDLE, { trackingEnabled: true, pushedEnabled: true, destination: HOST })
  })

  it('turns tracking off and pushes enabled=false', async () => {
    const stubs = stub()
    try {
      const { status, body } = await callJson<{ enabled: boolean; pushed: boolean }>('/api/settings/tracking', {
        method: 'PUT',
        body: { enabled: false }
      })

      expect(status).toBe(200)
      expect(body).toEqual({ enabled: false, pushed: true })
      const push = stubs.bodies[stubs.calls.findIndex((request) => request.url.endsWith('/pixel/update_config.json'))]
      expect(JSON.parse(JSON.parse(push ?? '{}').settings)).toEqual({ destination: HOST, enabled: 'false' })
    } finally {
      stubs.restore()
    }

    await expect(findPixelState(db, HANDLE)).resolves.toMatchObject({ trackingEnabled: false, pushedEnabled: false })
  })

  it('records who turned it off and when', async () => {
    const stubs = stub()
    try {
      await callJson('/api/settings/tracking', { method: 'PUT', body: { enabled: false } })
    } finally {
      stubs.restore()
    }

    const state = await findPixelState(db, HANDLE)
    expect(state?.disabledBy).toBe('staff-1')
    expect(state?.disabledAt).toBeInstanceOf(Date)
  })

  it('clears the disabled trail when tracking comes back on', async () => {
    const stubs = stub()
    try {
      await callJson('/api/settings/tracking', { method: 'PUT', body: { enabled: false } })
      await callJson('/api/settings/tracking', { method: 'PUT', body: { enabled: true } })
    } finally {
      stubs.restore()
    }

    await expect(findPixelState(db, HANDLE)).resolves.toMatchObject({ trackingEnabled: true, disabledAt: null, disabledBy: null })
  })

  it('re-enabling needs no re-setup — the selection is untouched', async () => {
    const stubs = stub()
    try {
      await callJson('/api/settings/tracking', { method: 'PUT', body: { enabled: false } })
      await callJson('/api/settings/tracking', { method: 'PUT', body: { enabled: true } })
    } finally {
      stubs.restore()
    }

    await expect(findSelection(db, HANDLE)).resolves.toMatchObject({ domainId: DOMAIN, deliveryHost: HOST })
  })

  it('keeps the merchant’s intent but leaves pushedEnabled alone when the push fails', async () => {
    const stubs = stub({ pushOk: false })
    try {
      const { body } = await callJson<{ pushed: boolean; error?: string }>('/api/settings/tracking', {
        method: 'PUT',
        body: { enabled: false }
      })

      expect(body.pushed).toBe(false)
      expect(body.error).toBeDefined()
    } finally {
      stubs.restore()
    }

    // The intent is stored; what SHOPLINE accepted is not overwritten. That gap is what lets the UI
    // say "you turned this off but it may still be sending" instead of quietly lying.
    const state = await findPixelState(db, HANDLE)
    expect(state?.trackingEnabled).toBe(false)
    expect(state?.pushedEnabled).toBe(true)
    expect(state?.lastPushError).toBeTruthy()
  })

  it('makes the disagreement visible in /api/status', async () => {
    const stubs = stub({ pushOk: false })
    try {
      await callJson('/api/settings/tracking', { method: 'PUT', body: { enabled: false } })
      const { body } = await callJson<StatusPayload>('/api/status')

      expect(body.tracking.enabled).toBe(false)
      expect(body.tracking.pushedEnabled).toBe(true)
      expect(body.tracking.lastPushError).toBeTruthy()
    } finally {
      stubs.restore()
    }
  })

  it('reports tracking as not live when the merchant has switched it off', async () => {
    const stubs = stub()
    try {
      await callJson('/api/settings/tracking', { method: 'PUT', body: { enabled: false } })

      expect((await callJson<StatusPayload>('/api/status')).body.tracking.live).toBe(false)
    } finally {
      stubs.restore()
    }
  })

  it('reports tracking as not live when the site is not serving, even with everything else on', async () => {
    const stubs = stub({ deliveryLive: false })
    try {
      expect((await callJson<StatusPayload>('/api/status')).body.tracking.live).toBe(false)
    } finally {
      stubs.restore()
    }
  })

  it.each([
    ['a missing flag', {}],
    ['a string', { enabled: 'false' }],
    ['a number', { enabled: 0 }],
    ['null', { enabled: null }]
  ])('refuses %s', async (_label, body) => {
    expect((await call('/api/settings/tracking', { method: 'PUT', body })).status).toBe(400)
  })

  it('requires a session token', async () => {
    expect((await call('/api/settings/tracking', { method: 'PUT', body: { enabled: false }, token: null })).status).toBe(401)
  })

  it('cannot push without a selected site', async () => {
    const { clearSelection } = await import('../src/db/queries/stores')
    await clearSelection(db, HANDLE)

    const { body } = await callJson<{ pushed: boolean; error?: string }>('/api/settings/tracking', {
      method: 'PUT',
      body: { enabled: true }
    })

    expect(body.pushed).toBe(false)
    expect(body.error).toContain('no site is selected')
  })
})

describe('POST /api/settings/retry-push', () => {
  beforeEach(async () => {
    await connect()
    await select()
  })

  it('re-pushes the merchant’s current intent without changing it', async () => {
    await upsertPixelState(db, HANDLE, { trackingEnabled: false, lastPushError: 'earlier failure' })
    const stubs = stub()

    try {
      const { body } = await callJson<{ enabled: boolean; pushed: boolean }>('/api/settings/retry-push', { method: 'POST' })

      expect(body).toEqual({ enabled: false, pushed: true })
    } finally {
      stubs.restore()
    }

    await expect(findPixelState(db, HANDLE)).resolves.toMatchObject({
      trackingEnabled: false,
      pushedEnabled: false,
      lastPushError: null
    })
  })

  it('defaults to on for a store with no pixel row yet', async () => {
    const stubs = stub()
    try {
      expect((await callJson<{ enabled: boolean }>('/api/settings/retry-push', { method: 'POST' })).body.enabled).toBe(true)
    } finally {
      stubs.restore()
    }
  })

  it('reports a repeated failure rather than claiming success', async () => {
    const stubs = stub({ pushOk: false })
    try {
      const { body } = await callJson<{ pushed: boolean; error?: string }>('/api/settings/retry-push', { method: 'POST' })

      expect(body.pushed).toBe(false)
      expect(body.error).toBeDefined()
    } finally {
      stubs.restore()
    }
  })
})

describe('POST /api/settings/change-site', () => {
  beforeEach(async () => {
    await connect()
    await select()
    await upsertPixelState(db, HANDLE, { trackingEnabled: true, pushedEnabled: true, destination: HOST })
  })

  it('stops tracking, then clears the selection', async () => {
    const stubs = stub()
    try {
      const { body } = await callJson<{ cleared: boolean; trackingStopped: boolean }>('/api/settings/change-site', { method: 'POST' })

      expect(body).toMatchObject({ cleared: true, trackingStopped: true })
      const push = stubs.bodies[stubs.calls.findIndex((request) => request.url.endsWith('/pixel/update_config.json'))]
      expect(JSON.parse(JSON.parse(push ?? '{}').settings)).toEqual({ destination: HOST, enabled: 'false' })
    } finally {
      stubs.restore()
    }

    await expect(findSelection(db, HANDLE)).resolves.toBeUndefined()
  })

  it('sends the merchant back to the chooser', async () => {
    const stubs = stub()
    try {
      await callJson('/api/settings/change-site', { method: 'POST' })

      expect((await callJson<StatusPayload>('/api/status')).body.screen).toBe('choose')
    } finally {
      stubs.restore()
    }
  })

  it('warns when the pixel could not be switched off first', async () => {
    const stubs = stub({ pushOk: false })
    try {
      const { body } = await callJson<{ trackingStopped: boolean; warning?: string }>('/api/settings/change-site', { method: 'POST' })

      expect(body.trackingStopped).toBe(false)
      expect(body.warning).toBeDefined()
    } finally {
      stubs.restore()
    }
  })
})

describe('unmatched routes', () => {
  it('answers an unknown API path with a 404, not the app shell', async () => {
    const { status, body } = await callJson<{ error: string }>('/api/nope')

    expect(status).toBe(404)
    expect(body.error).toBe('not_found')
  })

  it('answers /api/health without a session', async () => {
    expect((await call('/api/health', { token: null })).status).toBe(200)
  })
})

import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'

import type { StatusPayload } from '../src/routes/status'
import { jsonResponse, resetDb, stubFetch, testDb } from './helpers'
import { call, callJson, HANDLE, installCallback, webhook } from './routes'

/**
 * One merchant, start to finish, with both upstreams stubbed.
 *
 * Live testing against a real store cannot reach the end of this journey: `pixel/update_config.json`
 * answers `500 record not found` until the extension is published on the store, so the one thing
 * the app exists to do — get a settings push accepted — has never once succeeded against the real
 * API. Mocking that endpoint is the only way to see the whole state machine reach `live: true`,
 * and it is worth having permanently: this is the only test that asserts the *order* of the
 * lifecycle rather than one route at a time.
 *
 * Everything else here is real: the Hono app, the middleware, the signature checks, D1, and the
 * encryption. Only the two networks are replaced.
 */

const TEAM = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const DOMAIN = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'
const DELIVERY = 'q-srini-shopline-com-abc123.dev.qinto.tech'

const db = testDb()

const site = (overrides: Record<string, unknown> = {}) => ({
  domainId: DOMAIN,
  name: 'srini-shopline.com',
  domain: 'q.srini-shopline.com',
  rootDomain: 'srini-shopline.com',
  subdomain: 'q',
  status: 'active',
  developmentUrl: `https://${DELIVERY}`,
  deliveryMode: 'development_url',
  deliveryLive: true,
  ...overrides
})

type Upstream = { pixelPushes: { destination: string; enabled: string }[]; fail: Set<string> }

/**
 * SHOPLINE's half. Returns null for a path it does not own.
 *
 * `merchants/shop.json` fails, as the install-time lookup can — the journey has to survive it, not
 * be spared it.
 */
const shoplineStub = async (request: Request, path: string, state: Upstream): Promise<Response | null> => {
  if (path.endsWith('/admin/oauth/token/create') || path.endsWith('/admin/oauth/token/refresh')) {
    return jsonResponse({
      code: 200,
      data: { accessToken: 'shpat_stub', scope: 'read_pixels,write_pixels', expireTime: new Date(Date.now() + 36e6).toISOString() }
    })
  }

  if (path.endsWith('/pixel/update_config.json')) {
    state.pixelPushes.push(JSON.parse(JSON.parse(await request.text()).settings))

    return jsonResponse({ data: {} })
  }

  if (path.endsWith('/webhooks.json')) {
    return jsonResponse({ data: {} })
  }

  if (path.endsWith('/merchants/shop.json')) {
    return new Response('{"errors":"ACCESS_TOKEN is no permission!"}', { status: 403 })
  }

  return null
}

/** Blotout's half, including an empty team until a site is created. */
const blotoutStub = (request: Request, path: string): Response | null => {
  const responses: Record<string, () => Response> = {
    '/oauth/token': () =>
      jsonResponse({
        access_token: 'qoa_stub',
        refresh_token: 'qor_stub',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'profile team:read domain:write offline_access'
      }),
    '/oauth/revoke': () => jsonResponse({}),
    '/me': () =>
      jsonResponse({
        tokenType: 'oauth',
        name: 'Blotout for SHOPLINE',
        user: { userId: 'u-1', email: 'karri+1@blotout.io', firstName: null, lastName: null },
        teams: [],
        organizations: [],
        scopes: []
      }),
    '/teams': () =>
      jsonResponse({ teams: [{ teamId: TEAM, name: "karri's Team", createdAt: '2026-09-01T00:00:00Z', scopes: ['team:read'] }] }),
    [`/teams/${TEAM}/domains/${DOMAIN}`]: () => jsonResponse({ site: site() }),
    [`/teams/${TEAM}/domains/${DOMAIN}/dns/check`]: () =>
      jsonResponse({ records: [], valid: true, required: true, checked: true, failureKind: null, message: 'ok' }),
    [`/teams/${TEAM}/domains/${DOMAIN}/dns`]: () =>
      jsonResponse({
        records: [{ type: 'CNAME', name: 'q', value: 'edge.qinto.tech' }],
        valid: false,
        required: true,
        checked: true,
        failureKind: 'missing',
        message: 'add the record'
      }),
    [`/teams/${TEAM}/domains/${DOMAIN}/deploy`]: () => jsonResponse({ site: site() }),
    [`/teams/${TEAM}/domains/${DOMAIN}/snippet`]: () =>
      jsonResponse({ host: DELIVERY, usingDevelopmentUrl: true, snippet: '<script></script>' })
  }

  if (path === `/teams/${TEAM}/domains`) {
    if (request.method === 'POST') {
      siteCreated = true

      return jsonResponse({ site: site({ status: 'pending', deliveryLive: false }) })
    }

    return jsonResponse({ sites: siteCreated ? [site()] : [] })
  }

  return responses[path]?.() ?? null
}

/**
 * Stands in for both platforms.
 *
 * `fail` names paths that should answer 500 for this call, so a test can watch the app report a
 * refusal honestly and then recover from it.
 */
const stubUpstreams = (state: Upstream) => {
  return stubFetch(async (request) => {
    const path = new URL(request.url).pathname
    if (state.fail.has(path)) {
      return new Response('{"errors":"record not found"}', { status: 500 })
    }

    const answer = (await shoplineStub(request, path, state)) ?? blotoutStub(request, path)
    if (answer === null) {
      throw new Error(`the journey called something it should not: ${request.method} ${request.url}`)
    }

    return answer
  })
}

let siteCreated = false

const status = async (): Promise<StatusPayload> => (await callJson<StatusPayload>('/api/status')).body

/** Installs the store the way SHOPLINE does, signature and all. */
const install = async (): Promise<void> => {
  const response = await installCallback({
    appkey: env.SHOPLINE_APP_KEY,
    code: 'install-code',
    handle: HANDLE,
    lang: 'en',
    timestamp: String(Date.now())
  })

  expect(response.status).toBe(302)
}

/** Connects Blotout through the real state table, the way the callback does. */
const connectBlotout = async (): Promise<void> => {
  const started = await callJson<{ authorizeUrl: string }>('/api/qinto/connect')
  expect(started.status).toBe(200)

  const state = new URL(started.body.authorizeUrl).searchParams.get('state') ?? ''
  expect(state).not.toBe('')

  const response = await call(`/api/qinto/callback?state=${state}&code=consent-code`, { token: null })
  expect(response.status).toBe(200)
}

describe('the whole merchant journey', () => {
  let upstream: Upstream

  beforeEach(async () => {
    await resetDb(db)
    siteCreated = false
    upstream = { pixelPushes: [], fail: new Set() }
  })

  it('installs, connects, picks a site, goes live, and comes back down', async () => {
    const stubs = stubUpstreams(upstream)

    try {
      // 1. Nothing installed yet.
      expect((await status()).screen).toBe('connect')

      // 2. Install.
      await install()
      const installed = await status()
      expect(installed.screen).toBe('connect')
      expect(installed.connection.connected).toBe(false)

      // 3. Connect Blotout, through a real state row.
      await connectBlotout()
      const connected = await status()
      expect(connected.screen).toBe('choose')
      expect(connected.connection).toMatchObject({ connected: true, userEmail: 'karri+1@blotout.io' })

      // 4. The chooser's data.
      const teams = await callJson<{ teams: { teamId: string; sites: unknown[] }[] }>('/api/qinto/teams')
      expect(teams.body.teams[0]?.teamId).toBe(TEAM)

      const suggestions = await callJson<{ suggestions: { host: string }[] }>(`/api/qinto/domain-suggestions?teamId=${TEAM}`)
      expect(suggestions.body.suggestions.map((one) => one.host)).toContain(`${HANDLE}.myshopline.com`)

      // 5. Pick the site. This is the push that has never succeeded against the real store.
      const selected = await callJson<{ tracking: { live: boolean } }>('/api/setup/select', {
        method: 'POST',
        body: { teamId: TEAM, domainId: DOMAIN }
      })
      expect(selected.status).toBe(200)
      expect(selected.body.tracking.live).toBe(true)
      expect(upstream.pixelPushes).toEqual([{ destination: DELIVERY, enabled: 'true' }])

      // 6. Live, with SHOPLINE and the app agreeing.
      const ready = await status()
      expect(ready.screen).toBe('ready')
      expect(ready.tracking).toMatchObject({ enabled: true, pushedEnabled: true, live: true, lastPushError: null })

      // 7. The kill switch, both ways.
      await callJson('/api/settings/tracking', { method: 'PUT', body: { enabled: false } })
      expect(upstream.pixelPushes.at(-1)).toEqual({ destination: DELIVERY, enabled: 'false' })
      expect(await status()).toMatchObject({ tracking: { enabled: false, pushedEnabled: false, live: false } })

      await callJson('/api/settings/tracking', { method: 'PUT', body: { enabled: true } })
      expect(await status()).toMatchObject({ tracking: { enabled: true, pushedEnabled: true, live: true } })

      // 8. A refused push, reported honestly, then recovered by retrying.
      upstream.fail.add(`/admin/openapi/v20270301/pixel/update_config.json`)
      const refused = await callJson<{ pushed: boolean }>('/api/settings/tracking', { method: 'PUT', body: { enabled: false } })
      expect(refused.body.pushed).toBe(false)

      const disagreeing = await status()
      // The merchant's intent is stored; what SHOPLINE accepted is not overwritten by a failure.
      expect(disagreeing.tracking).toMatchObject({ enabled: false, pushedEnabled: true, live: false })
      expect(disagreeing.tracking.lastPushError).toContain('500')

      upstream.fail.clear()
      const retried = await callJson<{ pushed: boolean }>('/api/settings/retry-push', { method: 'POST' })
      expect(retried.body.pushed).toBe(true)
      expect(await status()).toMatchObject({ tracking: { enabled: false, pushedEnabled: false, lastPushError: null } })

      // 9. Change site: tracking is pushed off first, then the selection goes.
      await callJson('/api/settings/tracking', { method: 'PUT', body: { enabled: true } })
      await callJson('/api/settings/change-site', { method: 'POST' })
      const rechoosing = await status()
      expect(rechoosing.screen).toBe('choose')
      expect(rechoosing.selection).toBeNull()
      expect(rechoosing.connection.connected).toBe(true)
      expect(upstream.pixelPushes.at(-1)?.enabled).toBe('false')

      // 10. Disconnect: everything Blotout-shaped is forgotten, the install survives.
      await callJson('/api/setup/select', { method: 'POST', body: { teamId: TEAM, domainId: DOMAIN } })
      await callJson('/api/qinto/disconnect', { method: 'POST' })
      const disconnected = await status()
      expect(disconnected.screen).toBe('connect')
      expect(disconnected.connection).toMatchObject({ connected: false, reason: 'never' })
      expect(disconnected.selection).toBeNull()

      // 11. Uninstall. A reinstall must not resume against a stale selection.
      const uninstalled = await webhook('apps/installed_uninstalled', { handle: HANDLE, operate: 'UNINSTALL' })
      expect(uninstalled.status).toBe(200)
      expect(await status()).toMatchObject({ screen: 'connect', tracking: { enabled: false } })
    } finally {
      stubs.restore()
    }
  })

  it('walks the onboarding branch a merchant with no sites gets', async () => {
    // The branch the live scripts have never touched, because the sandbox team already had a site.
    const stubs = stubUpstreams(upstream)

    try {
      await install()
      await connectBlotout()

      // A team with no sites belongs on the chooser, which offers to create one.
      const empty = await callJson<{ teams: { sites: unknown[] }[] }>('/api/qinto/teams')
      expect(empty.body.teams[0]?.sites).toEqual([])

      // Step 1 — create the site.
      const created = await callJson<{ site: { domainId: string } }>('/api/setup/site', {
        method: 'POST',
        body: { teamId: TEAM, rootDomain: 'srini-shopline.com' }
      })
      expect(created.status).toBe(200)
      expect(created.body.site.domainId).toBe(DOMAIN)
      expect((await status()).onboarding).toMatchObject({ teamId: TEAM })

      // Step 2 — the records to add, then the check.
      const dns = await callJson<{ records: unknown[]; valid: boolean }>(`/api/setup/dns?teamId=${TEAM}&domainId=${DOMAIN}`)
      expect(dns.body.records).toHaveLength(1)
      expect(dns.body.valid).toBe(false)

      const checked = await callJson<{ valid: boolean }>('/api/setup/dns/check', {
        method: 'POST',
        body: { teamId: TEAM, domainId: DOMAIN }
      })
      expect(checked.body.valid).toBe(true)

      // Step 3 — deploy, which selects the site and turns tracking on in one move.
      const deployed = await callJson<{ tracking: { live: boolean } }>('/api/setup/deploy', {
        method: 'POST',
        body: { teamId: TEAM, domainId: DOMAIN }
      })
      expect(deployed.status).toBe(200)
      expect(deployed.body.tracking.live).toBe(true)
      expect(upstream.pixelPushes.at(-1)).toEqual({ destination: DELIVERY, enabled: 'true' })

      const ready = await status()
      expect(ready.screen).toBe('ready')
      expect(ready.onboarding).toBeNull()
      expect(ready.tracking).toMatchObject({ enabled: true, pushedEnabled: true, live: true })
    } finally {
      stubs.restore()
    }
  })
})

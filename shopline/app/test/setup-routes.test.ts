import { beforeEach, describe, expect, it } from 'vitest'

import { storeConnection } from '../src/blotout/connection-store'
import { findOnboarding, findPixelState, findSelection, updateShopFacts, upsertPixelState, upsertStore } from '../src/db/queries/stores'
import { storeSession } from '../src/shopline/session-store'
import { jsonResponse, resetDb, stubFetch, testConfig, testDb } from './helpers'
import { call, callJson, HANDLE } from './routes'

const config = testConfig()
const db = testDb()

const TEAM = 'e04dfb0b-dfb1-4e83-bca0-0d74dfc3a52d'
const DOMAIN = 'b1969e53-1d4d-4ec0-91f3-5b209f5be433'

const SITE = {
  domainId: DOMAIN,
  name: 'srini-shopline.com',
  domain: 'xfbaos.srini-shopline.com',
  rootDomain: 'srini-shopline.com',
  subdomain: 'xfbaos',
  status: 'active',
  developmentUrl: 'xfbaossrini-shoplinecom-7be4300e42603eca.dev.qinto.tech',
  deliveryMode: 'development_url',
  deliveryLive: true,
  hostId: 'host-1'
}

const TEAMS = [{ teamId: TEAM, name: 'karri’s Team', createdAt: '2026-09-08T11:37:18.321Z', scopes: ['team:read', 'domain:write'] }]

const SUBMISSION = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

/** A valid share request, so each test's `overrides` read as the one thing it is about. */
const share = (overrides: Record<string, unknown> = {}) => ({
  teamId: TEAM,
  domainId: DOMAIN,
  emails: ['dev@example.com', 'ops@example.com'],
  submissionId: SUBMISSION,
  ...overrides
})

/**
 * The default answer for each path a setup route calls.
 *
 * A table rather than a chain of ifs, so one stub covers a whole flow and a test's `overrides` read
 * as a diff from the happy path.
 */
const DEFAULT_ROUTES: { match: (pathname: string, method: string) => boolean; respond: () => Response }[] = [
  { match: (path) => path === '/teams', respond: () => jsonResponse({ teams: TEAMS }) },
  {
    match: (path, method) => path === `/teams/${TEAM}/domains` && method === 'POST',
    respond: () => jsonResponse({ site: { ...SITE, status: 'pending', deliveryLive: false } }, 201)
  },
  { match: (path) => path === `/teams/${TEAM}/domains`, respond: () => jsonResponse({ sites: [SITE] }) },
  { match: (path) => path === `/teams/${TEAM}/domains/${DOMAIN}`, respond: () => jsonResponse({ site: SITE }) },
  {
    match: (path) => path.endsWith('/snippet'),
    respond: () => jsonResponse({ host: SITE.developmentUrl, usingDevelopmentUrl: true, snippet: '<script></script>' })
  },
  {
    match: (path) => path.endsWith('/dns/check'),
    respond: () => jsonResponse({ records: [], valid: true, required: true, checked: true, failureKind: null, message: '' })
  },
  { match: (path) => path.endsWith('/dns/share'), respond: () => jsonResponse({ sent: 2 }) },
  {
    match: (path) => path.endsWith('/dns'),
    respond: () =>
      jsonResponse({
        records: [{ type: 'CNAME', name: 'xfbaos', value: 'edge.qinto.tech', note: 'Disable the proxy.' }],
        valid: false,
        required: true,
        checked: true,
        failureKind: null,
        message: 'Waiting for the CNAME.'
      })
  },
  { match: (path) => path.endsWith('/deploy'), respond: () => jsonResponse({ deploymentId: 'dep-1', version: '1.4.0' }) },
  { match: (path) => path.endsWith('/pixel/update_config.json'), respond: () => jsonResponse({ data: {} }) }
]

/** Answers the Blotout and SHOPLINE calls a setup route makes. `overrides` are keyed by path suffix. */
const blotoutStub = (overrides: Record<string, () => Response> = {}) =>
  stubFetch((request) => {
    const { pathname } = new URL(request.url)

    const override = Object.entries(overrides).find(([suffix]) => pathname.endsWith(suffix))?.[1]
    const route = DEFAULT_ROUTES.find((candidate) => candidate.match(pathname, request.method))?.respond

    return (override ?? route ?? (() => new Response(`unexpected ${pathname}`, { status: 418 })))()
  })

beforeEach(async () => {
  await resetDb(db)
  await upsertStore(db, HANDLE)
  await storeSession(db, config, HANDLE, {
    accessToken: 'shopline-token',
    scope: 'read_pixels,write_pixels',
    expiresAt: new Date(Date.now() + 36e5)
  })
  await storeConnection(db, config, {
    handle: HANDLE,
    grant: { accessToken: 'qoa_live', refreshToken: 'qor_live', scope: 'team:read domain:write', expiresAt: new Date(Date.now() + 36e5) },
    identity: { userId: 'u', userEmail: 'karri@blotout.io', appName: 'Blotout' }
  })
})

describe('GET /api/qinto/teams', () => {
  it('returns each team with its sites', async () => {
    const stubs = blotoutStub()
    try {
      const { status, body } = await callJson<{ teams: { teamId: string; sites: unknown[] }[] }>('/api/qinto/teams')

      expect(status).toBe(200)
      expect(body.teams).toHaveLength(1)
      expect(body.teams[0]).toMatchObject({ teamId: TEAM, name: 'karri’s Team' })
      expect(body.teams[0]?.sites).toHaveLength(1)
    } finally {
      stubs.restore()
    }
  })

  it('keeps a team whose sites failed, with the reason', async () => {
    const stubs = blotoutStub({ [`/teams/${TEAM}/domains`]: () => jsonResponse({ error: 'forbidden' }, 403) })
    try {
      const { body } = await callJson<{ teams: { sites: unknown[]; error?: string }[] }>('/api/qinto/teams')

      // A merchant with one broken team must still be able to pick a site in another.
      expect(body.teams[0]?.sites).toEqual([])
      expect(body.teams[0]?.error).toContain('forbidden')
    } finally {
      stubs.restore()
    }
  })

  it('requires a session token', async () => {
    expect((await call('/api/qinto/teams', { token: null })).status).toBe(401)
  })

  it('reports a missing Blotout connection as a conflict the SPA can act on', async () => {
    await resetDb(db)
    await upsertStore(db, HANDLE)

    const { status, body } = await callJson<{ error: string }>('/api/qinto/teams')

    expect(status).toBe(409)
    expect(body.error).toBe('qinto_not_connected')
  })
})

describe('GET /api/qinto/domain-suggestions', () => {
  it('offers the storefront domain and marks a SHOPLINE-owned one as unusable', async () => {
    await updateShopFacts(db, HANDLE, {
      shopId: '1',
      shopName: 'Srini Test',
      primaryDomain: `${HANDLE}.myshopline.com`,
      currency: 'USD',
      ianaTimezone: 'Asia/Kolkata'
    })
    const stubs = blotoutStub()

    try {
      const { body } = await callJson<{ suggestions: { host: string; source: string; isDefault: boolean }[] }>(
        `/api/qinto/domain-suggestions?teamId=${TEAM}`
      )

      expect(body.suggestions).toEqual([
        { host: `${HANDLE}.myshopline.com`, source: 'shopline_primary', isDefault: true },
        { host: 'srini-shopline.com', source: 'qinto_site', isDefault: false }
      ])
    } finally {
      stubs.restore()
    }
  })

  it('marks a custom storefront domain as usable', async () => {
    await updateShopFacts(db, HANDLE, {
      shopId: '1',
      shopName: 'Srini Test',
      primaryDomain: 'shop.example.com',
      currency: 'USD',
      ianaTimezone: 'UTC'
    })

    const { body } = await callJson<{ suggestions: { host: string; isDefault: boolean }[] }>('/api/qinto/domain-suggestions')

    expect(body.suggestions).toEqual([{ host: 'shop.example.com', source: 'shopline_primary', isDefault: false }])
  })

  it("offers the handle's own SHOPLINE host, disabled, when the Admin API never told us the domain", async () => {
    // The install-time shop lookup failed, so there is no recorded domain. The row exists to explain why a custom domain is needed, which is why it is
    // marked `isDefault` and rendered disabled.
    const { body } = await callJson<{ suggestions: unknown[] }>('/api/qinto/domain-suggestions')

    expect(body.suggestions).toEqual([{ host: `${HANDLE}.myshopline.com`, source: 'shopline_default', isDefault: true }])
  })

  it('does not repeat a root domain already offered', async () => {
    await updateShopFacts(db, HANDLE, {
      shopId: '1',
      shopName: 'x',
      primaryDomain: 'srini-shopline.com',
      currency: null,
      ianaTimezone: null
    })
    const stubs = blotoutStub()

    try {
      const { body } = await callJson<{ suggestions: unknown[] }>(`/api/qinto/domain-suggestions?teamId=${TEAM}`)

      expect(body.suggestions).toHaveLength(1)
    } finally {
      stubs.restore()
    }
  })
})

describe('POST /api/setup/select', () => {
  it('stores the selection and turns tracking on', async () => {
    const stubs = blotoutStub()
    try {
      const { status, body } = await callJson<{ selected: boolean; deliveryHost: string; tracking: { live: boolean } }>(
        '/api/setup/select',
        { method: 'POST', body: { teamId: TEAM, domainId: DOMAIN } }
      )

      expect(status).toBe(200)
      expect(body).toMatchObject({ selected: true, deliveryHost: SITE.developmentUrl, tracking: { live: true } })
    } finally {
      stubs.restore()
    }

    await expect(findSelection(db, HANDLE)).resolves.toMatchObject({
      teamId: TEAM,
      domainId: DOMAIN,
      teamName: 'karri’s Team',
      deliveryHost: SITE.developmentUrl,
      usingDevelopmentUrl: true,
      // Recorded so a later reconnect can tell this user missing a team from another account.
      qintoUserId: 'u'
    })
    await expect(findPixelState(db, HANDLE)).resolves.toMatchObject({ trackingEnabled: true, pushedEnabled: true })
  })

  it('turns tracking back on for a store that had previously switched it off', async () => {
    // Disconnecting, changing site, and a revocation all leave `trackingEnabled: false` behind.
    // Choosing a site is an act of setup, so it has to record the intent as well as push it —
    // otherwise the app pushes `enabled=true` while its own stored intent still says off.
    await upsertPixelState(db, HANDLE, { trackingEnabled: false, disabledAt: new Date(), disabledBy: 'staff-earlier' })
    const stubs = blotoutStub()

    try {
      const { body } = await callJson<{ tracking: { live: boolean } }>('/api/setup/select', {
        method: 'POST',
        body: { teamId: TEAM, domainId: DOMAIN }
      })

      expect(body.tracking.live).toBe(true)
    } finally {
      stubs.restore()
    }

    await expect(findPixelState(db, HANDLE)).resolves.toMatchObject({
      trackingEnabled: true,
      pushedEnabled: true,
      disabledAt: null,
      disabledBy: null
    })
  })

  it('takes the delivery host from the snippet, not the site record', async () => {
    const stubs = blotoutStub()
    try {
      await callJson('/api/setup/select', { method: 'POST', body: { teamId: TEAM, domainId: DOMAIN } })
      const push = stubs.bodies[stubs.calls.findIndex((request) => request.url.endsWith('/pixel/update_config.json'))]

      // `site.domain` is the customer hostname; `snippet.host` is what Blotout actually serves on, and
      // the two differ whenever delivery is the development URL.
      expect(JSON.parse(JSON.parse(push ?? '{}').settings)).toEqual({ destination: SITE.developmentUrl, enabled: 'true' })
    } finally {
      stubs.restore()
    }
  })

  it('falls back to the site record when the snippet endpoint refuses', async () => {
    const stubs = blotoutStub({ '/snippet': () => jsonResponse({ error: 'forbidden' }, 403) })
    try {
      const { body } = await callJson<{ deliveryHost: string }>('/api/setup/select', {
        method: 'POST',
        body: { teamId: TEAM, domainId: DOMAIN }
      })

      expect(body.deliveryHost).toBe(SITE.developmentUrl)
    } finally {
      stubs.restore()
    }
  })

  it('stores a site whose delivery is not live, and says tracking is not live', async () => {
    const stubs = blotoutStub({
      [`/teams/${TEAM}/domains/${DOMAIN}`]: () => jsonResponse({ site: { ...SITE, deliveryLive: false } })
    })

    try {
      const { body } = await callJson<{ deliveryLive: boolean; tracking: { live: boolean } }>('/api/setup/select', {
        method: 'POST',
        body: { teamId: TEAM, domainId: DOMAIN }
      })

      expect(body.deliveryLive).toBe(false)
      expect(body.tracking.live).toBe(false)
    } finally {
      stubs.restore()
    }

    await expect(findSelection(db, HANDLE)).resolves.toMatchObject({ domainId: DOMAIN })
  })

  it('reports a failed pixel push instead of claiming tracking is live', async () => {
    const stubs = blotoutStub({ '/pixel/update_config.json': () => new Response('nope', { status: 500 }) })
    try {
      const { body } = await callJson<{ tracking: { live: boolean; error?: string } }>('/api/setup/select', {
        method: 'POST',
        body: { teamId: TEAM, domainId: DOMAIN }
      })

      expect(body.tracking.live).toBe(false)
      expect(body.tracking.error).toBeDefined()
    } finally {
      stubs.restore()
    }

    await expect(findPixelState(db, HANDLE)).resolves.toMatchObject({ trackingEnabled: true, pushedEnabled: null })
  })

  it.each([
    ['no body fields', {}],
    ['only a team', { teamId: TEAM }],
    ['only a domain', { domainId: DOMAIN }]
  ])('refuses %s', async (_label, body) => {
    expect((await call('/api/setup/select', { method: 'POST', body })).status).toBe(400)
  })

  it('passes a Blotout error slug through so the UI can write specific copy', async () => {
    const stubs = blotoutStub({
      [`/teams/${TEAM}/domains/${DOMAIN}`]: () => jsonResponse({ error: 'not_found' }, 404)
    })

    try {
      const { status, body } = await callJson<{ error: string; code: string }>('/api/setup/select', {
        method: 'POST',
        body: { teamId: TEAM, domainId: DOMAIN }
      })

      expect(status).toBe(502)
      expect(body).toMatchObject({ error: 'qinto_api', code: 'not_found' })
    } finally {
      stubs.restore()
    }
  })
})

describe('the new-user chain', () => {
  it('creates a site and parks onboarding at the DNS step', async () => {
    const stubs = blotoutStub()
    try {
      const { status, body } = await callJson<{ site: { domainId: string } }>('/api/setup/site', {
        method: 'POST',
        body: { teamId: TEAM, rootDomain: '  srini-shopline.com  ' }
      })

      expect(status).toBe(200)
      expect(body.site.domainId).toBe(DOMAIN)
      // Trimmed before it reaches Blotout, which would otherwise reject the padded hostname.
      expect(JSON.parse(stubs.bodies[stubs.calls.findIndex((r) => r.method === 'POST')] ?? '{}')).toMatchObject({
        rootDomain: 'srini-shopline.com',
        mode: 'managed'
      })
    } finally {
      stubs.restore()
    }

    await expect(findOnboarding(db, HANDLE)).resolves.toMatchObject({ step: 'dns', teamId: TEAM, domainId: DOMAIN })
  })

  it('refuses a blank domain', async () => {
    expect((await call('/api/setup/site', { method: 'POST', body: { teamId: TEAM, rootDomain: '   ' } })).status).toBe(400)
  })

  it('refuses a create with no team', async () => {
    expect((await call('/api/setup/site', { method: 'POST', body: { rootDomain: 'x.com' } })).status).toBe(400)
  })

  it('returns the DNS records to publish', async () => {
    const stubs = blotoutStub()
    try {
      const { body } = await callJson<{ records: { type: string; value: string }[]; valid: boolean }>(
        `/api/setup/dns?teamId=${TEAM}&domainId=${DOMAIN}`
      )

      expect(body.valid).toBe(false)
      expect(body.records[0]).toMatchObject({ type: 'CNAME', value: 'edge.qinto.tech' })
    } finally {
      stubs.restore()
    }
  })

  it('refuses a DNS read with no site reference', async () => {
    expect((await call('/api/setup/dns')).status).toBe(400)
  })

  it('advances to deploy once the DNS check passes', async () => {
    const stubs = blotoutStub()
    try {
      const { body } = await callJson<{ valid: boolean }>('/api/setup/dns/check', {
        method: 'POST',
        body: { teamId: TEAM, domainId: DOMAIN }
      })

      expect(body.valid).toBe(true)
    } finally {
      stubs.restore()
    }

    await expect(findOnboarding(db, HANDLE)).resolves.toMatchObject({ step: 'deploy' })
  })

  it('advances when DNS is not required at all', async () => {
    const stubs = blotoutStub({
      '/dns/check': () => jsonResponse({ records: [], valid: false, required: false, checked: true, failureKind: null, message: '' })
    })

    try {
      await callJson('/api/setup/dns/check', { method: 'POST', body: { teamId: TEAM, domainId: DOMAIN } })
    } finally {
      stubs.restore()
    }

    await expect(findOnboarding(db, HANDLE)).resolves.toMatchObject({ step: 'deploy' })
  })

  it('stays on the DNS step while the records are outstanding', async () => {
    const stubs = blotoutStub({
      '/dns/check': () => jsonResponse({ records: [], valid: false, required: true, checked: true, failureKind: null, message: 'Not yet.' })
    })

    try {
      await callJson('/api/setup/dns/check', { method: 'POST', body: { teamId: TEAM, domainId: DOMAIN } })
    } finally {
      stubs.restore()
    }

    await expect(findOnboarding(db, HANDLE)).resolves.toBeUndefined()
  })

  it('refuses a DNS check with no site reference', async () => {
    expect((await call('/api/setup/dns/check', { method: 'POST', body: {} })).status).toBe(400)
  })

  it('emails the records to the recipients the merchant named', async () => {
    const stubs = blotoutStub()
    try {
      const { status, body } = await callJson<{ sent: number }>('/api/setup/dns/share', { method: 'POST', body: share() })

      expect(status).toBe(200)
      expect(body.sent).toBe(2)
    } finally {
      stubs.restore()
    }

    const request = stubs.calls.findIndex((candidate) => candidate.url.endsWith('/dns/share'))
    expect(stubs.calls[request]?.url).toBe(`${config.blotoutApiOrigin}/teams/${TEAM}/domains/${DOMAIN}/dns/share`)
    // Sent verbatim: the idempotency key is what stops a retry from delivering a second email, so
    // minting our own here would defeat it.
    expect(JSON.parse(stubs.bodies[request] ?? '{}')).toEqual({
      emails: ['dev@example.com', 'ops@example.com'],
      submissionId: SUBMISSION
    })
  })

  it('lowercases nothing and trims nothing Blotout would not', async () => {
    const stubs = blotoutStub()
    try {
      await callJson('/api/setup/dns/share', { method: 'POST', body: share({ emails: ['  dev@example.com  '] }) })
    } finally {
      stubs.restore()
    }

    const request = stubs.calls.findIndex((candidate) => candidate.url.endsWith('/dns/share'))
    expect(JSON.parse(stubs.bodies[request] ?? '{}').emails).toEqual(['dev@example.com'])
  })

  it('refuses an address that is not one, rather than letting Blotout mail it', async () => {
    const { status, body } = await callJson<{ error: string }>('/api/setup/dns/share', {
      method: 'POST',
      body: share({ emails: ['dev@example.com', 'not-an-address'] })
    })

    expect(status).toBe(400)
    expect(body.error).toContain('email addresses')
  })

  it('refuses more recipients than Blotout accepts', async () => {
    const emails = Array.from({ length: 11 }, (_, index) => `dev${index}@example.com`)

    expect((await call('/api/setup/dns/share', { method: 'POST', body: share({ emails }) })).status).toBe(400)
  })

  it('refuses an empty recipient list', async () => {
    expect((await call('/api/setup/dns/share', { method: 'POST', body: share({ emails: [] }) })).status).toBe(400)
  })

  it('refuses a recipient list that is not a list', async () => {
    expect((await call('/api/setup/dns/share', { method: 'POST', body: share({ emails: 'dev@example.com' }) })).status).toBe(400)
  })

  it('refuses a recipient that is not a string', async () => {
    expect((await call('/api/setup/dns/share', { method: 'POST', body: share({ emails: [42] }) })).status).toBe(400)
  })

  it('refuses a submissionId that is not a uuid, which Blotout would reject anyway', async () => {
    expect((await call('/api/setup/dns/share', { method: 'POST', body: share({ submissionId: 'retry-1' }) })).status).toBe(400)
  })

  it('refuses a share with no site reference', async () => {
    expect((await call('/api/setup/dns/share', { method: 'POST', body: { emails: ['dev@example.com'] } })).status).toBe(400)
  })

  it('passes Blotout’s refusal through with its own slug, so the SPA can word it', async () => {
    const stubs = blotoutStub({ '/dns/share': () => jsonResponse({ error: 'rate_limited' }, 429) })
    try {
      const { status, body } = await callJson<{ error: string; code: string }>('/api/setup/dns/share', {
        method: 'POST',
        body: share()
      })

      expect(status).toBe(502)
      expect(body).toMatchObject({ error: 'qinto_api', code: 'rate_limited' })
    } finally {
      stubs.restore()
    }
  })

  it('deploys, selects the site and clears onboarding', async () => {
    const stubs = blotoutStub()
    try {
      const { status, body } = await callJson<{ deployment: { version: string }; tracking: { live: boolean } }>('/api/setup/deploy', {
        method: 'POST',
        body: { teamId: TEAM, domainId: DOMAIN }
      })

      expect(status).toBe(200)
      expect(body.deployment.version).toBe('1.4.0')
      expect(body.tracking.live).toBe(true)
    } finally {
      stubs.restore()
    }

    await expect(findSelection(db, HANDLE)).resolves.toMatchObject({ domainId: DOMAIN, qintoUserId: 'u' })
    await expect(findOnboarding(db, HANDLE)).resolves.toBeUndefined()
    await expect(findPixelState(db, HANDLE)).resolves.toMatchObject({ trackingEnabled: true, pushedEnabled: true })
  })

  it('refuses a deploy with no site reference', async () => {
    expect((await call('/api/setup/deploy', { method: 'POST', body: {} })).status).toBe(400)
  })
})

describe('PUT /api/setup/onboarding', () => {
  it('records the step so a reload resumes rather than restarting', async () => {
    const { status, body } = await callJson<{ step: string }>('/api/setup/onboarding', {
      method: 'PUT',
      body: { step: 'dns', teamId: TEAM, domainId: DOMAIN, rootDomain: 'srini-shopline.com' }
    })

    expect(status).toBe(200)
    expect(body.step).toBe('dns')
    await expect(findOnboarding(db, HANDLE)).resolves.toMatchObject({ step: 'dns', rootDomain: 'srini-shopline.com' })
  })

  it('rejects a step outside the enum, which the database also refuses', async () => {
    const { status, body } = await callJson<{ error: string }>('/api/setup/onboarding', { method: 'PUT', body: { step: 'whatever' } })

    expect(status).toBe(400)
    expect(body.error).toContain('step must be one of')
  })

  it('rejects a missing step', async () => {
    expect((await call('/api/setup/onboarding', { method: 'PUT', body: {} })).status).toBe(400)
  })
})

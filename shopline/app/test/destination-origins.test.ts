import { beforeEach, describe, expect, it } from 'vitest'

import { storeConnection } from '../src/blotout/connection-store'
import { findPixelState, findSelection, saveSelection, upsertPixelState, upsertStore } from '../src/db/queries/stores'
import type { StatusPayload } from '../src/routes/status'
import { storeSession } from '../src/shopline/session-store'
import { jsonResponse, resetDb, stubFetch, testConfig, testDb } from './helpers'
import { callJson, HANDLE } from './routes'

const config = testConfig()
const db = testDb()

const TEAM = 'e04dfb0b-dfb1-4e83-bca0-0d74dfc3a52d'
const DOMAIN = 'b1969e53-1d4d-4ec0-91f3-5b209f5be433'
const DEV_URL = 'xfbaossrini-shoplinecom-7be4300e42603eca.dev.qinto.tech'
const STORE_ORIGIN = `https://${HANDLE}.myshopline.com`

const SITE = {
  domainId: DOMAIN,
  name: 'srini-shopline.com',
  domain: 'xfbaos.srini-shopline.com',
  rootDomain: 'srini-shopline.com',
  subdomain: 'xfbaos',
  status: 'active',
  developmentUrl: DEV_URL,
  deliveryMode: 'development_url',
  deliveryLive: true
}

type Fake = {
  pushFails?: boolean
  originsThrow?: boolean
} & {
  site: typeof SITE | (Omit<typeof SITE, 'developmentUrl'> & { developmentUrl: null })
  origins: string[]
  originsFail: boolean
}

const originsAnswer = async (request: Request, fake: Fake): Promise<Response> => {
  if (fake.originsThrow === true) {
    throw new TypeError('network down')
  }

  if (fake.originsFail) {
    return jsonResponse({ error: 'unavailable' }, 503)
  }

  if (request.method === 'PATCH') {
    fake.origins = (JSON.parse(await request.text()) as { allowedOrigins: string[] }).allowedOrigins
  }

  return jsonResponse({ originCheck: true, allowedOrigins: fake.origins, deployed: true })
}

const TEAMS = [{ teamId: TEAM, name: 'karri’s Team', createdAt: '2026-09-08T00:00:00Z', scopes: [] }]
const DNS = { records: [{ type: 'CNAME', name: 'xfbaos', value: 'x' }], valid: false, required: true, checked: true, message: 'm' }

const otherAnswer = (path: string, fake: Fake): Response => {
  const routes: [(candidate: string) => boolean, () => Response][] = [
    [(candidate) => candidate === `/teams/${TEAM}/domains/${DOMAIN}`, () => jsonResponse({ site: fake.site })],
    [(candidate) => candidate === '/teams', () => jsonResponse({ teams: TEAMS })],
    [(candidate) => candidate.endsWith('/snippet'), () => jsonResponse({ host: DEV_URL, usingDevelopmentUrl: true, snippet: '' })],
    [(candidate) => candidate.endsWith('/dns'), () => jsonResponse(DNS)],
    [(candidate) => candidate.endsWith('/pixel/update_config.json'), () => jsonResponse({ data: {} })]
  ]

  return (routes.find(([match]) => match(path))?.[1] ?? (() => new Response(`unexpected ${path}`, { status: 418 })))()
}

/** Qinto and SHOPLINE, with the origins list held in memory so a PATCH is observable. */
const upstream = (fake: Fake) =>
  stubFetch((request) => {
    const path = new URL(request.url).pathname

    if (fake.pushFails === true && path.endsWith('/pixel/update_config.json')) {
      return new Response('{"errors":"boom"}', { status: 500 })
    }

    return path.endsWith('/origins') ? originsAnswer(request, fake) : otherAnswer(path, fake)
  })

const fake = (overrides: Partial<Fake> = {}): Fake => ({ site: SITE, origins: [], originsFail: false, ...overrides })

const selectDevUrl = () =>
  saveSelection(db, HANDLE, {
    teamId: TEAM,
    teamName: null,
    domainId: DOMAIN,
    siteName: SITE.name,
    deliveryHost: DEV_URL,
    usingDevelopmentUrl: true,
    qintoUserId: 'u'
  })

beforeEach(async () => {
  await resetDb(db)
  await upsertStore(db, HANDLE)
  await storeSession(db, config, HANDLE, { accessToken: 'shopline-token', scope: 'write_pixels', expiresAt: new Date(Date.now() + 36e5) })
  await storeConnection(db, config, {
    handle: HANDLE,
    grant: { accessToken: 'qoa_live', refreshToken: 'qor_live', scope: 'team:read domain:write', expiresAt: new Date(Date.now() + 36e5) },
    identity: { userId: 'u', userEmail: 'karri@blotout.io', appName: 'Blotout' }
  })
})

describe('allowed origins on select', () => {
  it('appends the storefront origin to the site’s list', async () => {
    const state = fake({ origins: ['https://kept.example.com'] })
    const stubs = upstream(state)
    try {
      const { status, body } = await callJson<{ origins: unknown }>('/api/setup/select', {
        method: 'POST',
        body: { teamId: TEAM, domainId: DOMAIN }
      })

      expect(status).toBe(200)
      expect(body.origins).toEqual({ state: 'allowed', missing: [] })
      expect(state.origins).toEqual(['https://kept.example.com', STORE_ORIGIN])
    } finally {
      stubs.restore()
    }
  })

  it('still selects the site when the list cannot be written', async () => {
    const stubs = upstream(fake({ originsFail: true }))
    try {
      const { status, body } = await callJson<{ selected: boolean; origins: unknown }>('/api/setup/select', {
        method: 'POST',
        body: { teamId: TEAM, domainId: DOMAIN }
      })

      expect(status).toBe(200)
      expect(body).toMatchObject({ selected: true, origins: null })
    } finally {
      stubs.restore()
    }

    await expect(findSelection(db, HANDLE)).resolves.toBeDefined()
  })
})

describe('POST /api/setup/origins', () => {
  it('adds the missing origin on retry', async () => {
    await selectDevUrl()
    const state = fake()
    const stubs = upstream(state)
    try {
      const { status, body } = await callJson<{ origins: unknown }>('/api/setup/origins', { method: 'POST' })

      expect(status).toBe(200)
      expect(body.origins).toEqual({ state: 'allowed', missing: [] })
      expect(state.origins).toEqual([STORE_ORIGIN])
    } finally {
      stubs.restore()
    }
  })

  it('needs a selected site', async () => {
    expect((await callJson('/api/setup/origins', { method: 'POST' })).status).toBe(409)
  })
})

describe('PUT /api/setup/destination', () => {
  it('points the pixel at the first-party domain without touching Qinto’s delivery mode', async () => {
    await selectDevUrl()
    const stubs = upstream(fake())
    try {
      const { status, body } = await callJson('/api/setup/destination', { method: 'PUT', body: { target: 'domain' } })

      expect(status).toBe(200)
      expect(body).toMatchObject({ deliveryHost: SITE.domain, usingDevelopmentUrl: false, pushed: true })
      expect(stubs.calls.some((request) => request.url.endsWith('/delivery'))).toBe(false)
    } finally {
      stubs.restore()
    }

    await expect(findSelection(db, HANDLE)).resolves.toMatchObject({ deliveryHost: SITE.domain, usingDevelopmentUrl: false })
    await expect(findPixelState(db, HANDLE)).resolves.toMatchObject({ destination: SITE.domain, pushedEnabled: true })
  })

  it('saves the new host but says so when SHOPLINE refuses the push', async () => {
    await selectDevUrl()
    const stubs = upstream(fake({ pushFails: true }))
    try {
      const { body } = await callJson<{ pushed: boolean; error?: string }>('/api/setup/destination', {
        method: 'PUT',
        body: { target: 'domain' }
      })

      expect(body.pushed).toBe(false)
      expect(body.error).toBeTruthy()
    } finally {
      stubs.restore()
    }

    await expect(findSelection(db, HANDLE)).resolves.toMatchObject({ deliveryHost: SITE.domain })
  })

  it('keeps tracking off when the merchant turned it off', async () => {
    await selectDevUrl()
    await upsertPixelState(db, HANDLE, { trackingEnabled: false })
    const stubs = upstream(fake())
    try {
      await callJson('/api/setup/destination', { method: 'PUT', body: { target: 'domain' } })
    } finally {
      stubs.restore()
    }

    await expect(findPixelState(db, HANDLE)).resolves.toMatchObject({ pushedEnabled: false })
  })

  it('refuses the Qinto URL for a site that has none', async () => {
    await selectDevUrl()
    const stubs = upstream(fake({ site: { ...SITE, developmentUrl: null } }))
    try {
      expect((await callJson('/api/setup/destination', { method: 'PUT', body: { target: 'development_url' } })).status).toBe(409)
    } finally {
      stubs.restore()
    }
  })

  it('rejects an unknown target', async () => {
    expect((await callJson('/api/setup/destination', { method: 'PUT', body: { target: 'elsewhere' } })).status).toBe(400)
  })

  it('needs a selected site', async () => {
    expect((await callJson('/api/setup/destination', { method: 'PUT', body: { target: 'domain' } })).status).toBe(409)
  })
})

describe('GET /api/status destination fields', () => {
  it('carries both hosts and the live origins status', async () => {
    await selectDevUrl()
    const stubs = upstream(fake())
    try {
      const { body } = await callJson<StatusPayload>('/api/status')

      expect(body.selection).toMatchObject({
        hosts: { domain: SITE.domain, developmentUrl: DEV_URL },
        origins: { state: 'missing', missing: [STORE_ORIGIN] }
      })
    } finally {
      stubs.restore()
    }
  })

  it('fails loudly when the origins read breaks for a reason other than Qinto refusing', async () => {
    await selectDevUrl()
    const stubs = upstream(fake({ originsThrow: true }))
    try {
      expect((await callJson('/api/status')).status).toBe(500)
    } finally {
      stubs.restore()
    }
  })

  it('leaves the origins status unknown when the list cannot be read', async () => {
    await selectDevUrl()
    const stubs = upstream(fake({ originsFail: true }))
    try {
      const { body } = await callJson<StatusPayload>('/api/status')

      expect(body.selection?.origins).toBeNull()
    } finally {
      stubs.restore()
    }
  })
})

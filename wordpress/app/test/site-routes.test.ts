import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { findRegistration } from '../src/db/queries/registrations'
import { findSelection, saveSelection } from '../src/db/queries/selections'
import { qintoConnections } from '../src/db/schema'
import type { SeededRegistration } from './helpers'
import {
  DOMAIN_ID,
  fakeQinto,
  jsonResponse,
  qintoSite,
  resetDb,
  SITE_PATH,
  seedConnection,
  seedRegistration,
  TEAM_ID,
  testDb
} from './helpers'
import { call, signedHeaders, signedJson } from './routes'

const db = testDb()

let registration: SeededRegistration
let restore: (() => void) | undefined
beforeEach(async () => {
  await resetDb(db)
  registration = await seedRegistration(db)
  await seedConnection(db, registration.id)
})
afterEach(() => {
  restore?.()
  restore = undefined
})

const REF = { teamId: TEAM_ID, domainId: DOMAIN_ID }

const qinto = (routes: Record<string, () => Response>) => {
  const stub = fakeQinto(routes)
  restore = stub.restore

  return stub
}

describe('GET /sites', () => {
  it("lists the first team's sites when no team is named", async () => {
    const stub = qinto({
      'GET /teams': () => jsonResponse({ teams: [{ teamId: TEAM_ID, name: 'Shop team' }] }),
      [`GET /teams/${TEAM_ID}/domains`]: () => jsonResponse({ sites: [qintoSite()] })
    })

    const { status, body } = await signedJson<{ teamId: string; sites: { domainId: string }[] }>(registration, '/sites')

    expect(status).toBe(200)
    expect(body.teamId).toBe(TEAM_ID)
    expect(body.sites).toEqual([expect.objectContaining({ domainId: DOMAIN_ID, developmentUrl: 'shop-abc.qinto.site' })])
    expect(stub.calls[0]?.headers.get('Authorization')).toBe('Bearer qoa_access')
  })

  it('lists the named team, and nothing when the grant has no team', async () => {
    const other = '33333333-3333-4333-8333-333333333333'
    qinto({ 'GET /teams': () => jsonResponse({ teams: [] }), [`GET /teams/${other}/domains`]: () => jsonResponse({ sites: [] }) })

    expect((await signedJson(registration, `/sites?teamId=${other}`)).body).toMatchObject({ teamId: other, sites: [] })
    expect((await signedJson(registration, '/sites')).body).toEqual({ teams: [], teamId: null, sites: [] })
  })

  it('refuses a team id that is not a Qinto id, before it reaches a URL path', async () => {
    expect((await signedJson(registration, '/sites?teamId=..%2F..%2Fme')).status).toBe(400)
  })
})

describe('POST /sites', () => {
  it('creates a managed site', async () => {
    const stub = qinto({ [`POST /teams/${TEAM_ID}/domains`]: () => jsonResponse({ site: qintoSite({ status: 'pending' }) }, 201) })

    const { status, body } = await signedJson(registration, '/sites', {
      method: 'POST',
      body: { teamId: TEAM_ID, rootDomain: 'Shop.Example.com', subdomain: 'q', name: 'Shop' }
    })

    expect(status).toBe(201)
    expect(body).toMatchObject({ site: { status: 'pending' } })
    expect(JSON.parse(stub.bodies[0] ?? '{}')).toEqual({ rootDomain: 'shop.example.com', mode: 'managed', name: 'Shop', subdomain: 'q' })
  })

  it('sends only what was given, and refuses a root domain that is not a hostname', async () => {
    const stub = qinto({ [`POST /teams/${TEAM_ID}/domains`]: () => jsonResponse({ site: qintoSite() }, 201) })

    await signedJson(registration, '/sites', { method: 'POST', body: { teamId: TEAM_ID, rootDomain: 'shop.example.com' } })
    expect(JSON.parse(stub.bodies[0] ?? '{}')).toEqual({ rootDomain: 'shop.example.com', mode: 'managed' })
    expect((await signedJson(registration, '/sites', { method: 'POST', body: { teamId: TEAM_ID, rootDomain: 'https://x' } })).status).toBe(
      400
    )
  })
})

describe('DNS and deploy', () => {
  const dnsBody = { records: [{ type: 'CNAME', name: 'q', value: 'edge.qinto.site' }], valid: false, required: true, message: 'pending' }

  it('reads, checks and shares the records', async () => {
    const stub = qinto({
      [`GET ${SITE_PATH}/dns`]: () => jsonResponse(dnsBody),
      [`POST ${SITE_PATH}/dns/check`]: () => jsonResponse({ ...dnsBody, valid: true }),
      [`POST ${SITE_PATH}/dns/share`]: () => jsonResponse({ sent: 1 })
    })

    expect((await signedJson(registration, `/dns?teamId=${TEAM_ID}&domainId=${DOMAIN_ID}`)).body).toMatchObject({ valid: false })
    expect((await signedJson(registration, '/dns/check', { method: 'POST', body: REF })).body).toMatchObject({ valid: true })
    const share = { ...REF, emails: ['dns@shop.example.com'], submissionId: crypto.randomUUID() }
    expect((await signedJson(registration, '/dns/share', { method: 'POST', body: share })).body).toEqual({ sent: 1 })
    expect(JSON.parse(stub.bodies[2] ?? '{}')).toEqual({ emails: share.emails, submissionId: share.submissionId })
  })

  it('refuses a bad recipient list', async () => {
    const share = { ...REF, emails: ['not-an-email'], submissionId: crypto.randomUUID() }

    expect((await signedJson(registration, '/dns/share', { method: 'POST', body: share })).status).toBe(400)
  })

  it('deploys', async () => {
    qinto({ [`POST ${SITE_PATH}/deploy`]: () => jsonResponse({ deploymentId: 'dep-1', version: '7' }) })

    expect((await signedJson(registration, '/deploy', { method: 'POST', body: REF })).body).toEqual({ deploymentId: 'dep-1', version: '7' })
  })
})

describe('POST /select-site', () => {
  const provisioning = (overrides: Record<string, () => Response> = {}) => {
    return qinto({
      [`GET ${SITE_PATH}`]: () => jsonResponse({ site: qintoSite({ rootDomain: 'qinto-only.example.com' }) }),
      [`PUT ${SITE_PATH}/apps/blotout-consent`]: () => jsonResponse({ domainAppId: 'da-1', action: 'installed' }),
      [`GET ${SITE_PATH}/settings`]: () => jsonResponse({ settings: { fallbackCookie: null, gpc: false } }),
      [`PATCH ${SITE_PATH}/settings`]: () => jsonResponse({ settings: {}, deployed: false }),
      [`GET ${SITE_PATH}/origins`]: () => jsonResponse({ originCheck: true, allowedOrigins: ['https://a.example.com'] }),
      [`PATCH ${SITE_PATH}/origins`]: () => jsonResponse({ originCheck: true, allowedOrigins: [], deployed: true }),
      [`POST ${SITE_PATH}/deploy`]: () => jsonResponse({ deploymentId: 'dep-1', version: '1' }),
      [`GET ${SITE_PATH}/snippet`]: () => jsonResponse({ host: 'q.shop.example.com', usingDevelopmentUrl: false, snippet: '<script>' }),
      [`GET ${SITE_PATH}/dns`]: () => jsonResponse({ records: [], valid: true, required: true, message: 'ok' }),
      ...overrides
    })
  }

  it('installs the consent app, applies settings, allows the WP origin and stores only the host', async () => {
    const stub = provisioning()

    const { status, body } = await signedJson(registration, '/select-site', { method: 'POST', body: REF })

    expect(status).toBe(200)
    expect(body).toMatchObject({ host: 'q.shop.example.com', usingDevelopmentUrl: false, app: 'installed' })
    const sent = Object.fromEntries(
      stub.calls.map((request, index) => [`${request.method} ${new URL(request.url).pathname}`, stub.bodies[index]])
    )
    expect(JSON.parse(sent[`PUT ${SITE_PATH}/apps/blotout-consent`] ?? '{}')).toEqual({ acknowledgeNecessary: true })
    expect(JSON.parse(sent[`PATCH ${SITE_PATH}/settings`] ?? '{}')).toEqual({
      consent: { enabled: true },
      gpc: true,
      fallbackCookie: 'tag_user_id'
    })
    expect(JSON.parse(sent[`PATCH ${SITE_PATH}/origins`] ?? '{}')).toEqual({
      allowedOrigins: ['https://a.example.com', 'https://shop.example.com']
    })
    expect(await findSelection(db, registration.id)).toMatchObject({ deliveryHost: 'q.shop.example.com', teamId: TEAM_ID })
    const order = stub.calls.map((request) => `${request.method} ${new URL(request.url).pathname}`)
    expect(order.indexOf(`POST ${SITE_PATH}/deploy`)).toBeGreaterThan(order.indexOf(`PATCH ${SITE_PATH}/origins`))
    expect(order.indexOf(`POST ${SITE_PATH}/deploy`)).toBeLessThan(order.indexOf(`GET ${SITE_PATH}/snippet`))
  })

  it('falls back to the Qinto URL while the custom domain’s DNS is not verified', async () => {
    provisioning({
      [`GET ${SITE_PATH}/dns`]: () => jsonResponse({ records: [], valid: false, required: true, message: 'pending' })
    })

    const { body } = await signedJson(registration, '/select-site', { method: 'POST', body: REF })

    expect(body).toMatchObject({ host: 'shop-abc.qinto.site', usingDevelopmentUrl: true })
    expect(await findSelection(db, registration.id)).toMatchObject({ deliveryHost: 'shop-abc.qinto.site', usingDevelopmentUrl: true })
  })

  it('skips the DNS check when Qinto already serves the Qinto URL or the site has none', async () => {
    const onQintoUrl = provisioning({
      [`GET ${SITE_PATH}/snippet`]: () => jsonResponse({ host: 'shop-abc.qinto.site', usingDevelopmentUrl: true, snippet: '<script>' })
    })
    await signedJson(registration, '/select-site', { method: 'POST', body: REF })
    expect(onQintoUrl.calls.some((request) => new URL(request.url).pathname.endsWith('/dns'))).toBe(false)

    restore?.()
    const noQintoUrl = provisioning({
      [`GET ${SITE_PATH}`]: () => jsonResponse({ site: qintoSite({ rootDomain: 'qinto-only.example.com', developmentUrl: null }) })
    })
    const { body } = await signedJson(registration, '/select-site', { method: 'POST', body: REF })
    expect(body).toMatchObject({ host: 'q.shop.example.com', usingDevelopmentUrl: false })
    expect(noQintoUrl.calls.some((request) => new URL(request.url).pathname.endsWith('/dns'))).toBe(false)
  })

  it('keeps the recovery cookie an existing site already uses', async () => {
    const stub = provisioning({
      [`GET ${SITE_PATH}/settings`]: () => jsonResponse({ settings: { fallbackCookie: 'shop_uid', gpc: false } })
    })

    await signedJson(registration, '/select-site', { method: 'POST', body: REF })

    const patch = stub.calls.findIndex((request) => request.method === 'PATCH' && new URL(request.url).pathname.endsWith('/settings'))
    expect(JSON.parse(stub.bodies[patch] ?? '{}')).toEqual({ consent: { enabled: true }, gpc: true })
  })

  it('skips the origin write when the site already allows it', async () => {
    const stub = provisioning({ [`GET ${SITE_PATH}`]: () => jsonResponse({ site: qintoSite() }) })
    await signedJson(registration, '/select-site', { method: 'POST', body: REF })
    expect(stub.calls.some((request) => new URL(request.url).pathname.endsWith('/origins'))).toBe(false)

    restore?.()
    const listed = provisioning({
      [`GET ${SITE_PATH}/origins`]: () => jsonResponse({ originCheck: true, allowedOrigins: ['https://shop.example.com'] })
    })
    await signedJson(registration, '/select-site', { method: 'POST', body: REF })
    expect(listed.calls.some((request) => request.method === 'PATCH' && new URL(request.url).pathname.endsWith('/origins'))).toBe(false)
  })

  it('stores nothing when the install is refused, and passes Qinto’s reason through', async () => {
    provisioning({ [`PUT ${SITE_PATH}/apps/blotout-consent`]: () => jsonResponse({ error: 'forbidden' }, 403) })

    const { status, body } = await signedJson(registration, '/select-site', { method: 'POST', body: REF })

    expect(status).toBe(502)
    expect(body).toEqual({ error: 'qinto_api', code: 'forbidden' })
    expect(await findSelection(db, registration.id)).toBeUndefined()
  })
})

describe('PUT /destination', () => {
  const select = () =>
    saveSelection(db, registration.id, {
      ...REF,
      siteName: 'Shop',
      deliveryHost: 'q.shop.example.com',
      usingDevelopmentUrl: false,
      appInstalledAt: new Date()
    })

  it('flips between the Qinto URL and the own domain without touching Qinto’s delivery mode', async () => {
    await select()
    const stub = qinto({ [`GET ${SITE_PATH}`]: () => jsonResponse({ site: qintoSite() }) })

    const toQinto = await signedJson(registration, '/destination', { method: 'PUT', body: { target: 'development_url' } })
    expect(toQinto.body).toEqual({ host: 'shop-abc.qinto.site', usingDevelopmentUrl: true })
    const toDomain = await signedJson(registration, '/destination', { method: 'PUT', body: { target: 'domain' } })
    expect(toDomain.body).toEqual({ host: 'q.shop.example.com', usingDevelopmentUrl: false })
    expect(stub.calls.every((request) => request.method === 'GET')).toBe(true)
  })

  it('needs a selected site and a Qinto URL', async () => {
    expect((await signedJson(registration, '/destination', { method: 'PUT', body: { target: 'domain' } })).status).toBe(409)

    await select()
    qinto({ [`GET ${SITE_PATH}`]: () => jsonResponse({ site: qintoSite({ developmentUrl: null }) }) })
    const { status, body } = await signedJson(registration, '/destination', { method: 'PUT', body: { target: 'development_url' } })
    expect(status).toBe(409)
    expect(body).toEqual({ error: 'no_qinto_url' })
  })
})

describe('GET /status', () => {
  it('shows a connected install with its site, live from Qinto', async () => {
    await saveSelection(db, registration.id, {
      ...REF,
      siteName: 'Shop',
      deliveryHost: 'q.shop.example.com',
      usingDevelopmentUrl: false,
      appInstalledAt: new Date()
    })
    qinto({ [`GET ${SITE_PATH}`]: () => jsonResponse({ site: qintoSite() }) })

    const { body } = await signedJson(registration, '/status')

    expect(body).toMatchObject({
      connection: { state: 'connected', userEmail: 'admin@example.com' },
      selection: {
        host: 'q.shop.example.com',
        usingDevelopmentUrl: false,
        bannerSettingsUrl: `${env.QINTO_AUTHORIZE_ORIGIN}/team/${TEAM_ID}/domain/${DOMAIN_ID}/apps/blotout-consent/ui`
      },
      site: { deliveryLive: true }
    })
  })

  it('still answers when Qinto is down or the grant died', async () => {
    await saveSelection(db, registration.id, {
      ...REF,
      siteName: null,
      deliveryHost: 'h.example.com',
      usingDevelopmentUrl: false,
      appInstalledAt: new Date()
    })
    qinto({})
    expect((await signedJson(registration, '/status')).body).toMatchObject({ site: null, selection: { host: 'h.example.com' } })

    restore?.()
    const expired = await seedRegistration(db)
    await seedConnection(db, expired.id, { expiresAt: new Date(0), refreshToken: null })
    await saveSelection(db, expired.id, {
      ...REF,
      siteName: null,
      deliveryHost: 'h.example.com',
      usingDevelopmentUrl: false,
      appInstalledAt: new Date()
    })
    expect((await signedJson(expired, '/status')).body).toMatchObject({ site: null })

    const due = await seedRegistration(db)
    await seedConnection(db, due.id, { expiresAt: new Date(0) })
    await saveSelection(db, due.id, {
      ...REF,
      siteName: null,
      deliveryHost: 'h.example.com',
      usingDevelopmentUrl: false,
      appInstalledAt: new Date()
    })
    restore?.()
    qinto({})
    expect((await signedJson(due, '/status')).body).toMatchObject({ connection: { state: 'connected' }, site: null })
  })

  it('shows a never-connected install with no site', async () => {
    const fresh = await seedRegistration(db)

    expect((await signedJson(fresh, '/status')).body).toEqual({
      connection: { state: 'none', userEmail: null },
      selection: null,
      site: null
    })
  })
})

const corruptToken = async (registrationId: string) => {
  await db.update(qintoConnections).set({ accessTokenEnc: 'v1.broken.broken' }).where(eq(qintoConnections.registrationId, registrationId))
}

describe('a stored token that no longer decrypts', () => {
  it('is a server fault in status, but disconnect still ends the grant with the refresh token', async () => {
    await saveSelection(db, registration.id, {
      ...REF,
      siteName: null,
      deliveryHost: 'h.example.com',
      usingDevelopmentUrl: false,
      appInstalledAt: new Date()
    })
    await corruptToken(registration.id)

    expect((await signedJson(registration, '/status')).status).toBe(500)
    expect(await findRegistration(db, registration.id)).toBeDefined()

    const stub = qinto({ 'POST /oauth/revoke': () => new Response(null, { status: 200 }) })
    expect((await signedJson(registration, '/disconnect', { method: 'POST', body: {} })).status).toBe(200)
    expect(stub.bodies.map((body) => new URLSearchParams(body).get('token'))).toEqual(['qor_refresh'])
  })
})

describe('POST /disconnect', () => {
  it('revokes the whole grant at Qinto, with the refresh token, and forgets the install', async () => {
    const stub = qinto({ 'POST /oauth/revoke': () => new Response(null, { status: 200 }) })

    const { body } = await signedJson(registration, '/disconnect', { method: 'POST', body: {} })

    expect(body).toEqual({ disconnected: true })
    expect(stub.bodies.map((sent) => new URLSearchParams(sent).get('token')).sort()).toEqual(['qoa_access', 'qor_refresh'])
    expect(stub.calls.some((call) => new URL(call.url).pathname === '/oauth/token')).toBe(false)
    expect(await findRegistration(db, registration.id)).toBeUndefined()
  })

  it('still forgets the install when there is no live grant or Qinto is unreachable', async () => {
    const fresh = await seedRegistration(db)
    expect((await signedJson(fresh, '/disconnect', { method: 'POST', body: {} })).body).toEqual({ disconnected: true })

    const revoked = await seedRegistration(db)
    await seedConnection(db, revoked.id, { revoked: true })
    expect((await signedJson(revoked, '/disconnect', { method: 'POST', body: {} })).body).toEqual({ disconnected: true })

    const stub = fakeQinto({})
    restore = stub.restore
    globalThis.fetch = (() => Promise.reject(new Error('offline'))) as typeof fetch
    expect((await signedJson(registration, '/disconnect', { method: 'POST', body: {} })).body).toEqual({ disconnected: true })
  })
})

describe('once a site is selected', () => {
  const OTHER = { teamId: TEAM_ID, domainId: '44444444-4444-4444-8444-444444444444' }

  beforeEach(async () => {
    await saveSelection(db, registration.id, {
      ...REF,
      siteName: null,
      deliveryHost: 'h.example.com',
      usingDevelopmentUrl: false,
      appInstalledAt: new Date()
    })
  })

  it('refuses to act on any other site, even one the grant can see', async () => {
    const stub = qinto({})
    const share = { ...OTHER, emails: ['a@example.com'], submissionId: crypto.randomUUID() }
    const calls = [
      signedJson(registration, `/dns?teamId=${OTHER.teamId}&domainId=${OTHER.domainId}`),
      signedJson(registration, '/dns/check', { method: 'POST', body: OTHER }),
      signedJson(registration, '/dns/share', { method: 'POST', body: share }),
      signedJson(registration, '/deploy', { method: 'POST', body: OTHER }),
      signedJson(registration, '/select-site', { method: 'POST', body: OTHER }),
      signedJson(registration, '/sites', { method: 'POST', body: { teamId: TEAM_ID, rootDomain: 'new.example.com' } })
    ]

    for (const result of await Promise.all(calls)) {
      expect(result).toEqual({ status: 409, body: { error: 'site_locked' } })
    }
    expect(stub.calls).toHaveLength(0)
  })

  it('still acts on its own site', async () => {
    qinto({ [`POST ${SITE_PATH}/deploy`]: () => jsonResponse({ deploymentId: 'dep-2', version: '8' }) })

    expect((await signedJson(registration, '/deploy', { method: 'POST', body: REF })).status).toBe(200)
  })
})

describe('DNS share throttle', () => {
  it('is keyed by install', async () => {
    const keys: string[] = []
    const deny: RateLimit = {
      limit: async ({ key }) => {
        keys.push(key)

        return { success: false }
      }
    }
    const share = { ...REF, emails: ['a@example.com'], submissionId: crypto.randomUUID() }
    const signed = await signedHeaders(registration, '/dns/share', { method: 'POST', body: share })

    const response = await call('/dns/share', { method: 'POST', headers: signed.headers, body: signed.body, env: { SHARE_LIMITER: deny } })

    expect(response.status).toBe(429)
    expect(keys).toEqual([registration.id])
  })
})

import { beforeEach, describe, expect, it } from 'vitest'

import { findStore } from '../src/db/queries/stores'
import { loadSession } from '../src/shopline/session-store'
import { jsonResponse, rawColumn, resetDb, stubFetch, testConfig, testDb } from './helpers'
import { call, HANDLE, installCallback, ORIGIN } from './routes'

const config = testConfig()
const db = testDb()

const okTokenCreate = () =>
  jsonResponse({
    code: 200,
    data: {
      accessToken: 'shopline-offline-token',
      scope: 'read_pixels,write_pixels',
      expireTime: new Date(Date.now() + 36e5).toISOString()
    }
  })

const shopInfo = () =>
  jsonResponse({
    data: { id: 1788859124912, name: 'Srini Test', domain: `${HANDLE}.myshopline.com`, currency: 'USD', iana_timezone: 'Asia/Kolkata' }
  })

/** Answers each leg of the install: token create, then shop info, then the webhook subscription. */
const installStubs = () =>
  stubFetch((request) => {
    const url = new URL(request.url)
    if (url.pathname === '/admin/oauth/token/create') {
      return okTokenCreate()
    }

    if (url.pathname.endsWith('/merchants/shop.json')) {
      return shopInfo()
    }

    if (url.pathname.endsWith('/webhooks.json')) {
      return jsonResponse({ webhook: { id: 1, topic: 'apps/installed_uninstalled' } })
    }

    return new Response('unexpected', { status: 418 })
  })

beforeEach(async () => {
  await resetDb(db)
})

describe('GET /api/auth', () => {
  it('redirects to the store’s consent page with our scopes', async () => {
    const response = await call(`/api/auth?handle=${HANDLE}`, { token: null })

    expect(response.status).toBe(302)
    const location = response.headers.get('location') ?? ''
    expect(location).toContain(`https://${HANDLE}.myshopline.com/admin/oauth-web/#/oauth/authorize?`)
    expect(location).toContain('scope=read_pixels%2Cwrite_pixels%2Cread_store_information')
    expect(location).toContain(`redirectUri=${encodeURIComponent(`${ORIGIN}/api/auth/callback`)}`)
  })

  it('puts the query before the fragment, so the Admin SPA can read it', async () => {
    const response = await call(`/api/auth?handle=${HANDLE}`, { token: null })
    const location = response.headers.get('location') ?? ''

    expect(location.indexOf('?')).toBeGreaterThan(location.indexOf('#'))
  })

  it.each([
    ['no handle', '/api/auth'],
    ['an empty handle', '/api/auth?handle='],
    ['a handle with a dot', '/api/auth?handle=evil.com'],
    ['a handle with a slash', '/api/auth?handle=a/b'],
    ['an uppercase handle', '/api/auth?handle=Srini']
  ])('refuses %s', async (_label, path) => {
    expect((await call(path, { token: null })).status).toBe(400)
  })
})

describe('GET /api/auth/callback', () => {
  it('stores the session and redirects into the Admin', async () => {
    const stubs = installStubs()
    try {
      const response = await installCallback({ handle: HANDLE, code: 'the-code', timestamp: String(Date.now()) })

      expect(response.status).toBe(302)
      expect(response.headers.get('location')).toBe(`https://${HANDLE}.myshopline.com/admin/apps/${config.appKey}`)
      await expect(loadSession(db, config, HANDLE)).resolves.toMatchObject({ accessToken: 'shopline-offline-token' })
    } finally {
      stubs.restore()
    }
  })

  it('finishes the install when the Admin loads the callback with a trailing slash', async () => {
    // Seen on the dev store: the embedded Admin opens `/api/auth/callback/`, and a strict match
    // answered it with the API 404, so every install stopped there.
    const stubs = installStubs()
    try {
      const response = await installCallback({ handle: HANDLE, code: 'the-code', timestamp: String(Date.now()) }, '/api/auth/callback/')

      expect(response.status).toBe(302)
      await expect(loadSession(db, config, HANDLE)).resolves.toMatchObject({ accessToken: 'shopline-offline-token' })
    } finally {
      stubs.restore()
    }
  })

  it.each([
    ['the Admin’s language when it sent one', { lang: 'zh-hans-cn' }, 'zh-hans-cn'],
    ['English when it did not', {}, 'en']
  ])('sends a callback loaded inside the app iframe to the app, keeping %s', async (_label, extra, lang) => {
    // Redirecting the frame to the Admin URL rendered the whole Admin nested inside itself.
    const stubs = installStubs()
    try {
      const response = await installCallback(
        { handle: HANDLE, code: 'the-code', timestamp: String(Date.now()), ...extra },
        '/api/auth/callback/',
        { 'Sec-Fetch-Dest': 'iframe' }
      )

      expect(response.status).toBe(302)
      expect(response.headers.get('location')).toBe(`/?${new URLSearchParams({ appkey: config.appKey, handle: HANDLE, lang })}`)
    } finally {
      stubs.restore()
    }
  })

  it('records the store and its primary domain', async () => {
    const stubs = installStubs()
    try {
      await installCallback({ handle: HANDLE, code: 'the-code', timestamp: String(Date.now()) })
    } finally {
      stubs.restore()
    }

    await expect(findStore(db, HANDLE)).resolves.toMatchObject({
      shopName: 'Srini Test',
      primaryDomain: `${HANDLE}.myshopline.com`,
      currency: 'USD'
    })
  })

  it('never writes the token in the clear', async () => {
    const stubs = installStubs()
    try {
      await installCallback({ handle: HANDLE, code: 'the-code', timestamp: String(Date.now()) })
    } finally {
      stubs.restore()
    }

    expect(await rawColumn('shopline_sessions', 'access_token_enc', 'handle', HANDLE)).not.toContain('shopline-offline-token')
  })

  it('subscribes the uninstall webhook to our own origin', async () => {
    const stubs = installStubs()
    try {
      await installCallback({ handle: HANDLE, code: 'the-code', timestamp: String(Date.now()) })
    } finally {
      stubs.restore()
    }

    const subscription = stubs.bodies[stubs.calls.findIndex((request) => request.url.endsWith('/webhooks.json'))]
    expect(JSON.parse(subscription ?? '{}')).toEqual({
      webhook: { topic: 'apps/installed_uninstalled', address: `${ORIGIN}/api/webhooks`, api_version: 'v20270301' }
    })
  })

  it('completes the install even when the shop lookup fails', async () => {
    const stubs = stubFetch((request) =>
      new URL(request.url).pathname === '/admin/oauth/token/create' ? okTokenCreate() : new Response('nope', { status: 500 })
    )

    try {
      expect((await installCallback({ handle: HANDLE, code: 'c', timestamp: String(Date.now()) })).status).toBe(302)
      await expect(loadSession(db, config, HANDLE)).resolves.toMatchObject({ accessToken: 'shopline-offline-token' })
    } finally {
      stubs.restore()
    }
  })

  it('rejects a tampered signature', async () => {
    const query = new URLSearchParams({ handle: HANDLE, code: 'c', timestamp: String(Date.now()), sign: 'forged' }).toString()
    const response = await call(`/api/auth/callback?${query}`, { token: null })

    expect(response.status).toBe(400)
    expect(await response.text()).toContain('invalid signature')
  })

  it('tells a merchant an old callback expired rather than calling it forged', async () => {
    const response = await installCallback({ handle: HANDLE, code: 'c', timestamp: String(Date.now() - 20 * 60 * 1000) })

    expect(response.status).toBe(400)
    expect(await response.text()).toContain('expired')
  })

  it('refuses a callback with no code', async () => {
    expect((await installCallback({ handle: HANDLE, timestamp: String(Date.now()) })).status).toBe(400)
  })

  it('refuses a malformed handle', async () => {
    expect((await installCallback({ handle: 'evil.com', code: 'c', timestamp: String(Date.now()) })).status).toBe(400)
  })

  it('reports upstream refusal as a bad gateway, not a success', async () => {
    const stubs = stubFetch(() => jsonResponse({ code: 401, message: 'bad code' }))
    try {
      const response = await installCallback({ handle: HANDLE, code: 'stale', timestamp: String(Date.now()) })

      expect(response.status).toBe(502)
      expect(await response.text()).toContain('could not complete the install')
    } finally {
      stubs.restore()
    }
  })
})

describe('framing', () => {
  it('names only the calling store’s Admin in frame-ancestors', async () => {
    const response = await call(`/api/health?handle=${HANDLE}`, { token: null })

    expect(response.headers.get('content-security-policy')).toBe(
      `frame-ancestors https://${HANDLE}.myshopline.com https://*.myshopline.com;`
    )
  })

  it('denies framing when no handle identifies a store', async () => {
    const response = await call('/api/health', { token: null })

    expect(response.headers.get('content-security-policy')).toBe("frame-ancestors 'none';")
  })

  it.each([
    ['a wildcard host-source, which would permit every HTTPS origin', '*%20evil'],
    ['a second source smuggled in', 'shop%20https://attacker.example.com'],
    ['a directive terminator', 'shop%3B%20script-src%20%27unsafe-inline%27'],
    ['a dot, which would name another origin entirely', 'evil.com'],
    ['an empty handle', '']
  ])('denies framing rather than emitting a broken policy for %s', async (_label, handle) => {
    // This header runs on unauthenticated requests too, so the query parameter is attacker-
    // controlled. `?handle=*%20evil` would otherwise emit `frame-ancestors https://* evil...`,
    // where `https://*` matches every HTTPS origin — the header would permit what it exists to stop.
    const response = await call(`/api/health?handle=${handle}`, { token: null })

    expect(response.headers.get('content-security-policy')).toBe("frame-ancestors 'none';")
  })

  it('sets the companion headers', async () => {
    const response = await call('/api/health', { token: null })

    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
  })
})

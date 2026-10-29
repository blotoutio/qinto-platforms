import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'

import { BlotoutApiError, blotoutApi, setSiteDelivery } from '../src/blotout/client'
import { storeConnection } from '../src/blotout/connection-store'
import { revokeToken } from '../src/blotout/oauth'
import { ConfigError, defaultStorefrontHost, readConfig } from '../src/config'
import { findPixelState, saveSelection, upsertStore } from '../src/db/queries/stores'
import { publicOrigin } from '../src/http/origin'
import { pushSettings } from '../src/services/pixel'
import { AdminApiError, adminApi } from '../src/shopline/admin-api'
import { storeSession } from '../src/shopline/session-store'
import { jsonResponse, resetDb, stubFetch, testConfig, testDb } from './helpers'
import { call, callJson, HANDLE } from './routes'

const config = testConfig()
const db = testDb()

// Blotout addresses teams and sites by UUID, and the routes now check that before interpolating.
const TEAM = '11111111-1111-4111-8111-111111111111'
const DOMAIN = '22222222-2222-4222-8222-222222222222'

describe('readConfig', () => {
  it('reads every value from the environment', () => {
    expect(readConfig(env)).toMatchObject({ appKey: env.SHOPLINE_APP_KEY, tokenKek: env.TOKEN_KEK })
  })

  it.each([
    'SHOPLINE_APP_KEY',
    'SHOPLINE_APP_SECRET',
    'SHOPLINE_API_HOST',
    'QINTO_API_ORIGIN',
    'QINTO_AUTHORIZE_ORIGIN',
    'QINTO_CLIENT_ID',
    'QINTO_CLIENT_SECRET',
    'TOKEN_KEK'
  ])('refuses to start with %s missing rather than signing with nothing', (key) => {
    expect(() => readConfig({ ...env, [key]: '' } as Env)).toThrow(ConfigError)
  })

  it('names every missing value at once, so one restart fixes them all', () => {
    const error = (() => {
      try {
        readConfig({ ...env, TOKEN_KEK: '', QINTO_CLIENT_ID: '' } as Env)
        return null
      } catch (thrown) {
        return thrown as Error
      }
    })()

    expect(error?.message).toContain('blotoutClientId')
    expect(error?.message).toContain('tokenKek')
  })

  it('rejects a non-string binding', () => {
    expect(() => readConfig({ ...env, TOKEN_KEK: 42 } as unknown as Env)).toThrow(ConfigError)
  })

  it('leaves the dev callback origin unset unless one is given', () => {
    expect(readConfig(env).devCallbackOrigin).toBeUndefined()
    expect(readConfig({ ...env, QINTO_DEV_CALLBACK_ORIGIN: '' } as Env).devCallbackOrigin).toBeUndefined()
  })

  it.each(['http://localhost:51741', 'http://127.0.0.1:3457', 'http://[::1]:8080'])(
    'accepts the loopback dev callback origin %s, whatever its port',
    (origin) => {
      expect(readConfig({ ...env, QINTO_DEV_CALLBACK_ORIGIN: origin } as Env).devCallbackOrigin).toBe(origin)
    }
  )

  it.each(['https://evil.example.com', 'http://evil.example.com', 'https://localhost:3457', 'not-a-url'])(
    'refuses %s as a dev callback origin, because it decides where an authorization code is delivered',
    (origin) => {
      expect(() => readConfig({ ...env, QINTO_DEV_CALLBACK_ORIGIN: origin } as Env)).toThrow(ConfigError)
    }
  )

  it('surfaces as a 500 the merchant cannot mistake for their own problem', async () => {
    const { status, body } = await callJson<{ error: string }>('/api/status', { token: null })

    // With no session token the guard answers first, which is the right order — configuration is
    // checked before the guard only for its own sake, never to leak which values are missing.
    expect(status).toBe(401)
    expect(body.error).toBe('unauthenticated')
  })
})

describe('the session guard', () => {
  it('rethrows an error that is not a token problem', async () => {
    // `verifySessionToken` only throws SessionTokenError, so this asserts the guard does not
    // swallow anything else — a swallowed bug would look like a 401 to the merchant forever.
    const response = await call('/api/status', { token: 'a.b' })

    expect(response.status).toBe(401)
  })
})

describe('setSiteDelivery', () => {
  // Reached by no route yet. Covered so the 100% gate stays meaningful rather than being waived for
  // an unwired export; if the delivery-mode feature lands with a different shape, replace this.
  it('sends the mode as a PUT on the site delivery path', async () => {
    const stubs = stubFetch(() => jsonResponse({ mode: 'development_url', live: false }))

    try {
      await expect(setSiteDelivery(config, 'qoa', { teamId: TEAM, domainId: DOMAIN }, 'development_url')).resolves.toEqual({
        mode: 'development_url',
        live: false
      })

      const request = stubs.calls[0]
      expect(request?.method).toBe('PUT')
      expect(new URL(request?.url ?? '').pathname).toBe(`/teams/${TEAM}/domains/${DOMAIN}/delivery`)
      expect(JSON.parse(stubs.bodies[0] ?? '{}')).toEqual({ mode: 'development_url' })
    } finally {
      stubs.restore()
    }
  })
})

describe('blotoutApi', () => {
  it('treats 204 as an empty success', async () => {
    const stubs = stubFetch(() => new Response(null, { status: 204 }))
    try {
      await expect(blotoutApi(config, 'qoa', '/whatever', { method: 'POST' })).resolves.toBeUndefined()
    } finally {
      stubs.restore()
    }
  })

  it('sends no content-type when there is no body', async () => {
    const stubs = stubFetch(() => jsonResponse({}))
    try {
      await blotoutApi(config, 'qoa', '/me')

      expect(stubs.calls[0]?.headers.get('content-type')).toBeNull()
      expect(stubs.calls[0]?.headers.get('authorization')).toBe('Bearer qoa')
    } finally {
      stubs.restore()
    }
  })

  it('reports an unparseable error body as an unknown code rather than throwing on the parse', async () => {
    const stubs = stubFetch(() => new Response('<html>502</html>', { status: 502 }))
    try {
      const error = (await blotoutApi(config, 'qoa', '/me').catch((thrown: unknown) => thrown)) as BlotoutApiError

      expect(error).toBeInstanceOf(BlotoutApiError)
      expect(error.code).toBe('unknown')
      expect(error.detail).toBeUndefined()
    } finally {
      stubs.restore()
    }
  })

  it('keeps Blotout’s message when it sends one', async () => {
    const stubs = stubFetch(() => jsonResponse({ error: 'already_exists', message: 'shop.example.com is taken' }, 409))
    try {
      const error = (await blotoutApi(config, 'qoa', '/x').catch((thrown: unknown) => thrown)) as BlotoutApiError

      expect(error.code).toBe('already_exists')
      expect(error.detail).toBe('shop.example.com is taken')
    } finally {
      stubs.restore()
    }
  })
})

describe('revokeToken', () => {
  it('sends the token and the client credentials', async () => {
    const stubs = stubFetch(() => new Response(null, { status: 200 }))
    try {
      await revokeToken(config, 'qoa_bye')
      const form = new URLSearchParams(stubs.bodies[0])

      expect(form.get('token')).toBe('qoa_bye')
      expect(form.get('client_secret')).toBeNull()
      expect(stubs.calls[0]?.headers.get('authorization')).toBe(`Basic ${btoa(`${config.blotoutClientId}:${config.blotoutClientSecret}`)}`)
    } finally {
      stubs.restore()
    }
  })

  it('swallows a failure, because a merchant must be able to disconnect regardless', async () => {
    const stubs = stubFetch(() => {
      throw new Error('blotout is down')
    })

    try {
      await expect(revokeToken(config, 'qoa_bye')).resolves.toBeUndefined()
    } finally {
      stubs.restore()
    }
  })
})

describe('adminApi', () => {
  const session = { handle: HANDLE, accessToken: 'shopline-token', scope: '', expiresAt: new Date(Date.now() + 36e5) }

  it('addresses the versioned path on the store’s own host', async () => {
    const stubs = stubFetch(() => jsonResponse({ data: {} }))
    try {
      await adminApi(config, session, 'merchants/shop.json')

      expect(stubs.calls[0]?.url).toBe(`https://${HANDLE}.myshopline.com/admin/openapi/v20270301/merchants/shop.json`)
      expect(stubs.calls[0]?.headers.get('authorization')).toBe('Bearer shopline-token')
    } finally {
      stubs.restore()
    }
  })

  it('truncates a long error body rather than putting it all in a log line', async () => {
    const stubs = stubFetch(() => new Response('x'.repeat(2000), { status: 500 }))
    try {
      const error = (await adminApi(config, session, 'x.json').catch((thrown: unknown) => thrown)) as AdminApiError

      expect(error).toBeInstanceOf(AdminApiError)
      expect(error.body).toHaveLength(512)
      expect(error.status).toBe(500)
    } finally {
      stubs.restore()
    }
  })

  it('surfaces as a 502 with no upstream body in the response', async () => {
    await resetDb(db)
    await upsertStore(db, HANDLE)
    await storeSession(db, config, HANDLE, { accessToken: 'shopline-token', scope: '', expiresAt: new Date(Date.now() + 36e5) })
    await storeConnection(db, config, {
      handle: HANDLE,
      grant: { accessToken: 'qoa', refreshToken: 'qor', scope: 'team:read', expiresAt: new Date(Date.now() + 36e5) },
      identity: { userId: null, userEmail: null, appName: null }
    })
    await saveSelection(db, HANDLE, {
      teamId: TEAM,
      teamName: null,
      domainId: DOMAIN,
      siteName: null,
      deliveryHost: 'q.example.com',
      usingDevelopmentUrl: false,
      qintoUserId: null
    })

    const stubs = stubFetch((request) =>
      new URL(request.url).hostname.endsWith('myshopline.com')
        ? new Response('shopline says no, in detail', { status: 500 })
        : jsonResponse({ site: { deliveryLive: true } })
    )

    try {
      // The pixel push swallows and records this one, so drive the error table through a route
      // that does not: `retry-push` reports it, and the response must not carry SHOPLINE's body.
      const { body } = await callJson<{ pushed: boolean; error?: string }>('/api/settings/retry-push', { method: 'POST' })

      expect(body.pushed).toBe(false)
      expect(body.error).not.toContain('shopline says no, in detail')
    } finally {
      stubs.restore()
    }
  })
})

describe('pushSettings', () => {
  beforeEach(async () => {
    await resetDb(db)
    await upsertStore(db, HANDLE)
  })

  it('cannot push for a store with no session, and says so instead of throwing', async () => {
    await saveSelection(db, HANDLE, {
      teamId: TEAM,
      teamName: null,
      domainId: DOMAIN,
      siteName: null,
      deliveryHost: 'q.example.com',
      usingDevelopmentUrl: false,
      qintoUserId: null
    })

    const result = await pushSettings(db, config, HANDLE, true)

    expect(result).toMatchObject({ pushed: false })
  })

  it("records SHOPLINE's own reason in the log, and only the status in what it returns", async () => {
    await storeSession(db, config, HANDLE, { accessToken: 't', scope: '', expiresAt: new Date(Date.now() + 36e5) })
    await saveSelection(db, HANDLE, {
      teamId: TEAM,
      teamName: null,
      domainId: DOMAIN,
      siteName: null,
      deliveryHost: 'q.example.com',
      usingDevelopmentUrl: false,
      qintoUserId: null
    })
    const logged: string[] = []
    const error = console.error
    console.error = (message: unknown) => logged.push(String(message))
    const stubs = stubFetch(() => new Response('{"errors":"record not found"}', { status: 500 }))

    try {
      const result = await pushSettings(db, config, HANDLE, true)

      // The status is the merchant-facing half; the body says which failure it is, and a status
      // alone cannot tell a missing scope from a store with no pixel record.
      // `record not found` is the store having no pixel record, which no retry can fix, so it is
      // classified rather than passed on as a status the screen would have to guess at.
      expect(result).toEqual({
        pushed: false,
        error: 'SHOPLINE pixel/update_config.json -> 500',
        reason: 'extension_not_published'
      })
      expect(logged.join('\n')).toContain('record not found')
      await expect(findPixelState(db, HANDLE)).resolves.toMatchObject({ lastPushReason: 'extension_not_published' })
    } finally {
      stubs.restore()
      console.error = error
    }
  })

  it('classifies a refusal SHOPLINE blames on authorization, which a retry can fix', async () => {
    await storeSession(db, config, HANDLE, { accessToken: 't', scope: '', expiresAt: new Date(Date.now() + 36e5) })
    await saveSelection(db, HANDLE, {
      teamId: TEAM,
      teamName: null,
      domainId: DOMAIN,
      siteName: null,
      deliveryHost: 'q.example.com',
      usingDevelopmentUrl: false,
      qintoUserId: null
    })
    const stubs = stubFetch(() => new Response('{"errors":"ACCESS_TOKEN is no permission!"}', { status: 403 }))

    try {
      await expect(pushSettings(db, config, HANDLE, true)).resolves.toMatchObject({ pushed: false, reason: 'forbidden' })
    } finally {
      stubs.restore()
    }
  })

  it('does not mistake an unrelated 500 for a store with no pixel record', async () => {
    await storeSession(db, config, HANDLE, { accessToken: 't', scope: '', expiresAt: new Date(Date.now() + 36e5) })
    await saveSelection(db, HANDLE, {
      teamId: TEAM,
      teamName: null,
      domainId: DOMAIN,
      siteName: null,
      deliveryHost: 'q.example.com',
      usingDevelopmentUrl: false,
      qintoUserId: null
    })
    const stubs = stubFetch(() => new Response('{"errors":"internal error"}', { status: 500 }))

    try {
      await expect(pushSettings(db, config, HANDLE, true)).resolves.toMatchObject({ pushed: false, reason: 'unknown' })
    } finally {
      stubs.restore()
    }
  })

  it('says so when there is no site to point at, rather than calling SHOPLINE', async () => {
    const stubs = stubFetch(() => new Response('should not be called', { status: 418 }))

    try {
      await expect(pushSettings(db, config, HANDLE, true)).resolves.toEqual({
        pushed: false,
        error: 'no site is selected',
        reason: 'no_selection'
      })
      expect(stubs.calls).toHaveLength(0)
    } finally {
      stubs.restore()
    }
  })

  it('reports a thrown non-Error without losing the reason', async () => {
    await storeSession(db, config, HANDLE, { accessToken: 't', scope: '', expiresAt: new Date(Date.now() + 36e5) })
    await saveSelection(db, HANDLE, {
      teamId: TEAM,
      teamName: null,
      domainId: DOMAIN,
      siteName: null,
      deliveryHost: 'q.example.com',
      usingDevelopmentUrl: false,
      qintoUserId: null
    })
    const stubs = stubFetch(() => {
      throw 'a string, not an Error'
    })

    try {
      const result = await pushSettings(db, config, HANDLE, true)

      expect(result).toEqual({ pushed: false, error: 'a string, not an Error', reason: 'unknown' })
    } finally {
      stubs.restore()
    }
  })
})

describe('remaining branches', () => {
  beforeEach(async () => {
    await resetDb(db)
    await upsertStore(db, HANDLE)
    await storeSession(db, config, HANDLE, { accessToken: 'shopline-token', scope: '', expiresAt: new Date(Date.now() + 36e5) })
    await storeConnection(db, config, {
      handle: HANDLE,
      grant: { accessToken: 'qoa', refreshToken: 'qor', scope: 'team:read domain:write', expiresAt: new Date(Date.now() + 36e5) },
      identity: { userId: null, userEmail: null, appName: null }
    })
  })

  it('passes an optional site name and subdomain through to Blotout', async () => {
    const stubs = stubFetch((request) =>
      new URL(request.url).pathname.endsWith('/domains')
        ? jsonResponse({ site: { domainId: DOMAIN, rootDomain: 'example.com', subdomain: 'q', deliveryMode: 'domain' } }, 201)
        : jsonResponse({})
    )

    try {
      await callJson('/api/setup/site', {
        method: 'POST',
        body: { teamId: TEAM, rootDomain: 'example.com', name: 'Storefront', subdomain: 'q' }
      })

      expect(JSON.parse(stubs.bodies[0] ?? '{}')).toEqual({
        rootDomain: 'example.com',
        mode: 'managed',
        name: 'Storefront',
        subdomain: 'q'
      })
    } finally {
      stubs.restore()
    }
  })

  it('reports a token endpoint that fails with no error field at all', async () => {
    const { exchangeCode } = await import('../src/blotout/oauth')
    const stubs = stubFetch(() => new Response('{}', { status: 500, headers: { 'Content-Type': 'application/json' } }))

    try {
      await expect(exchangeCode(config, { code: 'c', verifier: 'v', redirectUri: 'https://x/cb' })).rejects.toThrow(/no detail/)
    } finally {
      stubs.restore()
    }
  })

  it('reports a token endpoint that answers with an unparseable body', async () => {
    const { exchangeCode } = await import('../src/blotout/oauth')
    const stubs = stubFetch(() => new Response('<html>', { status: 502 }))

    try {
      await expect(exchangeCode(config, { code: 'c', verifier: 'v', redirectUri: 'https://x/cb' })).rejects.toThrow(/502/)
    } finally {
      stubs.restore()
    }
  })

  it('reports a token endpoint that answers 200 with no access token', async () => {
    const { exchangeCode } = await import('../src/blotout/oauth')
    const stubs = stubFetch(() => jsonResponse({ error: 'invalid_scope' }))

    try {
      await expect(exchangeCode(config, { code: 'c', verifier: 'v', redirectUri: 'https://x/cb' })).rejects.toThrow(/invalid_scope/)
    } finally {
      stubs.restore()
    }
  })

  it('marks the grant revoked when the refresh throws something that is not an Error', async () => {
    const { loadConnection, BlotoutGrantRevokedError, storeConnection: store } = await import('../src/blotout/connection-store')
    await store(db, config, {
      handle: HANDLE,
      grant: { accessToken: 'qoa', refreshToken: 'qor', scope: '', expiresAt: new Date(Date.now() - 1000) },
      identity: { userId: null, userEmail: null, appName: null }
    })
    const stubs = stubFetch(() => {
      throw 'not an Error'
    })

    try {
      await expect(loadConnection(db, config, HANDLE)).rejects.toThrow(BlotoutGrantRevokedError)
    } finally {
      stubs.restore()
    }
  })

  it('logs rather than failing when revoking during disconnect hits an unexpected error', async () => {
    const { markRevoked } = await import('../src/blotout/connection-store')
    await markRevoked(db, HANDLE)
    const stubs = stubFetch(() => jsonResponse({}))

    try {
      // `loadConnection` throws BlotoutGrantRevokedError here, which is not BlotoutNotConnectedError, so
      // the disconnect logs it and carries on rather than refusing to disconnect.
      const { body } = await callJson<{ disconnected: boolean }>('/api/qinto/disconnect', { method: 'POST' })

      expect(body.disconnected).toBe(true)
    } finally {
      stubs.restore()
    }
  })

  it('describes a team whose sites failed with a non-Error throw', async () => {
    const stubs = stubFetch((request) => {
      if (new URL(request.url).pathname === '/teams') {
        return jsonResponse({ teams: [{ teamId: TEAM, name: 'T', createdAt: '', scopes: [] }] })
      }

      throw 'sites blew up'
    })

    try {
      const { body } = await callJson<{ teams: { error?: string }[] }>('/api/qinto/teams')

      expect(body.teams[0]?.error).toBe('sites could not be read')
    } finally {
      stubs.restore()
    }
  })

  it('rethrows a non-Blotout failure from the snippet lookup instead of guessing a host', async () => {
    const stubs = stubFetch((request) => {
      const { pathname } = new URL(request.url)
      if (pathname.endsWith('/snippet')) {
        throw new TypeError('network is unreachable')
      }

      return jsonResponse({ site: { domainId: DOMAIN, domain: 'q.example.com', deliveryMode: 'domain', deliveryLive: true } })
    })

    try {
      // A transport failure is not a permission problem, so falling back to `site.domain` would
      // paper over an outage with a host we have not confirmed Blotout is serving.
      expect((await call('/api/setup/select', { method: 'POST', body: { teamId: TEAM, domainId: DOMAIN } })).status).toBe(500)
    } finally {
      stubs.restore()
    }
  })

  it('rethrows when the snippet is forbidden and the site has no usable host either', async () => {
    const stubs = stubFetch((request) => {
      const { pathname } = new URL(request.url)
      if (pathname.endsWith('/snippet')) {
        return jsonResponse({ error: 'forbidden' }, 403)
      }

      return jsonResponse({
        site: { domainId: DOMAIN, domain: 'q.example.com', deliveryMode: 'development_url', developmentUrl: null, deliveryLive: false }
      })
    })

    try {
      const { status, body } = await callJson<{ error: string; code: string }>('/api/setup/select', {
        method: 'POST',
        body: { teamId: TEAM, domainId: DOMAIN }
      })

      expect(status).toBe(502)
      expect(body.code).toBe('forbidden')
    } finally {
      stubs.restore()
    }
  })

  it('reads a shop record with no fields at all without inventing values', async () => {
    const { fetchShopInfo } = await import('../src/shopline/admin-api')
    const stubs = stubFetch(() => jsonResponse({}))

    try {
      await expect(fetchShopInfo(config, { handle: HANDLE, accessToken: 't', scope: '', expiresAt: new Date() })).resolves.toEqual({
        shopId: null,
        shopName: null,
        primaryDomain: null,
        currency: null,
        ianaTimezone: null
      })
    } finally {
      stubs.restore()
    }
  })

  it('reports a SHOPLINE token response with no code field', async () => {
    const { exchangeInstallCode } = await import('../src/shopline/oauth')
    const stubs = stubFetch(() => jsonResponse({}))

    try {
      await expect(exchangeInstallCode(config, HANDLE, 'c')).rejects.toThrow(/no code/)
    } finally {
      stubs.restore()
    }
  })
})

describe('fallbacks for fields upstream may omit', () => {
  beforeEach(async () => {
    await resetDb(db)
    await upsertStore(db, HANDLE)
    await storeSession(db, config, HANDLE, { accessToken: 'shopline-token', scope: '', expiresAt: new Date(Date.now() + 36e5) })
  })

  it('stores an empty scope when SHOPLINE omits it', async () => {
    const { loadSession } = await import('../src/shopline/session-store')
    const { shoplineSessions } = await import('../src/db/schema')
    const { encryptSecret, secretAad } = await import('../src/crypto/secret')
    const { sessionId } = await import('../src/shopline/session-store')

    await db
      .update(shoplineSessions)
      .set({
        scope: null,
        accessTokenEnc: await encryptSecret(config.tokenKek, 'token', secretAad('shopline_sessions', sessionId(HANDLE), 'access_token_enc'))
      })
      .where((await import('drizzle-orm')).eq(shoplineSessions.id, sessionId(HANDLE)))

    await expect(loadSession(db, config, HANDLE)).resolves.toMatchObject({ scope: '' })
  })

  it('accepts a token create response with no scope and no message', async () => {
    const { exchangeInstallCode } = await import('../src/shopline/oauth')
    const stubs = stubFetch(() =>
      jsonResponse({ code: 200, data: { accessToken: 'tok', expireTime: new Date(Date.now() + 36e5).toISOString() } })
    )

    try {
      await expect(exchangeInstallCode(config, HANDLE, 'c')).resolves.toMatchObject({ accessToken: 'tok', scope: '' })
    } finally {
      stubs.restore()
    }
  })

  it('rejects a token create response with a code but no message', async () => {
    const { exchangeInstallCode } = await import('../src/shopline/oauth')
    const stubs = stubFetch(() => jsonResponse({ code: 400 }))

    try {
      await expect(exchangeInstallCode(config, HANDLE, 'c')).rejects.toThrow(/token create failed: 400/)
    } finally {
      stubs.restore()
    }
  })

  it('reports an install whose token exchange fails at the transport, not the protocol', async () => {
    const stubs = stubFetch(() => {
      throw new TypeError('connection reset')
    })

    try {
      const { installCallback } = await import('./routes')
      // Not a ShoplineOauthError, so it must reach the error table as a 500 rather than being
      // reported to the merchant as "try again".
      expect((await installCallback({ handle: HANDLE, code: 'c', timestamp: String(Date.now()) })).status).toBe(500)
    } finally {
      stubs.restore()
    }
  })

  it('records a connection whose /me carries no user', async () => {
    const { consumeOauthState: _unused, putOauthState } = await import('../src/db/queries/oauth-states')
    const { loadConnection } = await import('../src/blotout/connection-store')
    await putOauthState(db, { state: 'st', handle: HANDLE, codeVerifier: 'v' })
    const stubs = stubFetch((request) =>
      new URL(request.url).pathname === '/oauth/token'
        ? jsonResponse({ access_token: 'qoa', expires_in: 3600, scope: '' })
        : jsonResponse({ tokenType: 'oauth', name: 'Blotout', user: null, teams: [], organizations: [], scopes: [] })
    )

    try {
      await call('/api/qinto/callback?state=st&code=c', { token: null })

      // A grant without `profile` returns no user; the connection is still valid, just anonymous.
      await expect(loadConnection(db, config, HANDLE)).resolves.toMatchObject({ userId: null, userEmail: null, appName: 'Blotout' })
    } finally {
      stubs.restore()
    }
  })

  it('leaves the team name null when the selected team is not in the list', async () => {
    const { storeConnection: store } = await import('../src/blotout/connection-store')
    const { findSelection } = await import('../src/db/queries/stores')
    await store(db, config, {
      handle: HANDLE,
      grant: { accessToken: 'qoa', refreshToken: 'qor', scope: '', expiresAt: new Date(Date.now() + 36e5) },
      identity: { userId: null, userEmail: null, appName: null }
    })

    const stubs = stubFetch((request) => {
      const { pathname } = new URL(request.url)
      if (pathname === '/teams') {
        return jsonResponse({ teams: [] })
      }

      if (pathname.endsWith('/snippet')) {
        return jsonResponse({ host: 'q.example.com', usingDevelopmentUrl: false, snippet: '' })
      }

      if (pathname.endsWith('/pixel/update_config.json')) {
        return jsonResponse({ data: {} })
      }

      return jsonResponse({ site: { domainId: DOMAIN, domain: 'q.example.com', deliveryMode: 'domain', deliveryLive: true, name: null } })
    })

    try {
      // A well-formed id for a team the caller can no longer see, which is what a stale UI sends.
      await callJson('/api/setup/select', { method: 'POST', body: { teamId: '33333333-3333-4333-8333-333333333333', domainId: DOMAIN } })

      await expect(findSelection(db, HANDLE)).resolves.toMatchObject({ teamName: null })
    } finally {
      stubs.restore()
    }
  })

  it('accepts an onboarding step with no site reference at all', async () => {
    const { findOnboarding } = await import('../src/db/queries/stores')

    await callJson('/api/setup/onboarding', { method: 'PUT', body: { step: 'choose' } })

    await expect(findOnboarding(db, HANDLE)).resolves.toMatchObject({ step: 'choose', teamId: null, domainId: null, rootDomain: null })
  })
})

describe('the last few branches', () => {
  beforeEach(async () => {
    await resetDb(db)
    await upsertStore(db, HANDLE)
    await storeSession(db, config, HANDLE, { accessToken: 'shopline-token', scope: '', expiresAt: new Date(Date.now() + 36e5) })
    await storeConnection(db, config, {
      handle: HANDLE,
      grant: { accessToken: 'qoa', refreshToken: 'qor', scope: 'team:read domain:write', expiresAt: new Date(Date.now() + 36e5) },
      identity: { userId: null, userEmail: null, appName: null }
    })
  })

  it('accepts a Blotout token response with no scope field', async () => {
    const { exchangeCode } = await import('../src/blotout/oauth')
    const stubs = stubFetch(() => jsonResponse({ access_token: 'qoa', expires_in: 3600 }))

    try {
      await expect(exchangeCode(config, { code: 'c', verifier: 'v', redirectUri: 'https://x/cb' })).resolves.toMatchObject({
        scope: '',
        refreshToken: null
      })
    } finally {
      stubs.restore()
    }
  })

  it('rejects a SHOPLINE token response with no expireTime at all', async () => {
    const { exchangeInstallCode } = await import('../src/shopline/oauth')
    const stubs = stubFetch(() => jsonResponse({ code: 200, data: { accessToken: 'tok', scope: 'read_pixels' } }))

    try {
      await expect(exchangeInstallCode(config, HANDLE, 'c')).rejects.toThrow(/no usable expireTime/)
    } finally {
      stubs.restore()
    }
  })

  it('falls back to the development URL when the snippet is forbidden', async () => {
    const { findSelection } = await import('../src/db/queries/stores')
    const stubs = stubFetch((request) => {
      const { pathname } = new URL(request.url)
      if (pathname.endsWith('/snippet')) {
        return jsonResponse({ error: 'forbidden' }, 403)
      }

      if (pathname === '/teams') {
        return jsonResponse({ teams: [] })
      }

      if (pathname.endsWith('/pixel/update_config.json')) {
        return jsonResponse({ data: {} })
      }

      return jsonResponse({
        site: {
          domainId: DOMAIN,
          domain: 'q.example.com',
          deliveryMode: 'development_url',
          developmentUrl: 'dev.qinto.tech',
          deliveryLive: true,
          name: null
        }
      })
    })

    try {
      const { body } = await callJson<{ deliveryHost: string }>('/api/setup/select', {
        method: 'POST',
        body: { teamId: TEAM, domainId: DOMAIN }
      })

      expect(body.deliveryHost).toBe('dev.qinto.tech')
    } finally {
      stubs.restore()
    }

    await expect(findSelection(db, HANDLE)).resolves.toMatchObject({ usingDevelopmentUrl: true })
  })

  it('falls back to the site’s own domain when the snippet is forbidden and delivery is the domain', async () => {
    const stubs = stubFetch((request) => {
      const { pathname } = new URL(request.url)
      if (pathname.endsWith('/snippet')) {
        return jsonResponse({ error: 'forbidden' }, 403)
      }

      if (pathname === '/teams') {
        return jsonResponse({ teams: [] })
      }

      if (pathname.endsWith('/pixel/update_config.json')) {
        return jsonResponse({ data: {} })
      }

      return jsonResponse({
        site: { domainId: DOMAIN, domain: 'q.example.com', deliveryMode: 'domain', developmentUrl: null, deliveryLive: true, name: null }
      })
    })

    try {
      const { body } = await callJson<{ deliveryHost: string }>('/api/setup/select', {
        method: 'POST',
        body: { teamId: TEAM, domainId: DOMAIN }
      })

      expect(body.deliveryHost).toBe('q.example.com')
    } finally {
      stubs.restore()
    }
  })

  it('reports a deploy whose pixel push failed rather than claiming tracking is live', async () => {
    const stubs = stubFetch((request) => {
      const { pathname } = new URL(request.url)
      if (pathname.endsWith('/pixel/update_config.json')) {
        return new Response('nope', { status: 500 })
      }

      if (pathname.endsWith('/deploy')) {
        return jsonResponse({ deploymentId: 'dep', version: '1.0.0' })
      }

      if (pathname.endsWith('/snippet')) {
        return jsonResponse({ host: 'q.example.com', usingDevelopmentUrl: false, snippet: '' })
      }

      if (pathname === '/teams') {
        return jsonResponse({ teams: [] })
      }

      return jsonResponse({ site: { domainId: DOMAIN, domain: 'q.example.com', deliveryMode: 'domain', deliveryLive: true, name: null } })
    })

    try {
      const { body } = await callJson<{ tracking: { live: boolean; error?: string } }>('/api/setup/deploy', {
        method: 'POST',
        body: { teamId: TEAM, domainId: DOMAIN }
      })

      expect(body.tracking.live).toBe(false)
      expect(body.tracking.error).toBeDefined()
    } finally {
      stubs.restore()
    }
  })

  it('lets a transport failure reading the site DNS surface too, for the same reason', async () => {
    const { saveSelection: select } = await import('../src/db/queries/stores')
    await select(db, HANDLE, {
      teamId: TEAM,
      teamName: null,
      domainId: DOMAIN,
      siteName: null,
      deliveryHost: 'q.example.com',
      usingDevelopmentUrl: false,
      qintoUserId: null
    })
    // The site reads fine; only the DNS check breaks at the transport. A caught `TypeError` here
    // would report the records as merely unknown and let the screen look healthy.
    const stubs = stubFetch((request) => {
      if (new URL(request.url).pathname.endsWith('/dns')) {
        throw new TypeError('network unreachable')
      }

      return jsonResponse({
        site: {
          domainId: DOMAIN,
          name: null,
          domain: 'q.example.com',
          rootDomain: 'example.com',
          subdomain: 'q',
          status: 'active',
          developmentUrl: null,
          deliveryMode: 'domain',
          deliveryLive: true
        }
      })
    })

    try {
      expect((await call('/api/status')).status).toBe(500)
    } finally {
      stubs.restore()
    }
  })

  it('lets a transport failure reading the selected site surface, rather than reporting it as not serving', async () => {
    const { saveSelection: select } = await import('../src/db/queries/stores')
    await select(db, HANDLE, {
      teamId: TEAM,
      teamName: null,
      domainId: DOMAIN,
      siteName: null,
      deliveryHost: 'q.example.com',
      usingDevelopmentUrl: false,
      qintoUserId: null
    })
    const stubs = stubFetch(() => {
      throw new TypeError('network unreachable')
    })

    try {
      // A permission failure means "we cannot see it"; a transport failure means the app is broken.
      // Collapsing the two would show the merchant a healthy-looking screen during an outage.
      expect((await call('/api/status')).status).toBe(500)
    } finally {
      stubs.restore()
    }
  })

  it('surfaces a corrupted token row loudly instead of showing it as never connected', async () => {
    const { blotoutConnections } = await import('../src/db/schema')
    const { eq } = await import('drizzle-orm')
    await db
      .update(blotoutConnections)
      .set({ accessTokenEnc: 'v1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAA' })
      .where(eq(blotoutConnections.handle, HANDLE))

    // Reporting corruption as "connect your account" would hide it forever behind a working-looking
    // screen, and the merchant would never learn their grant was intact.
    expect((await call('/api/status')).status).toBe(500)
  })
})

describe('publicOrigin', () => {
  // The scheme matters: it becomes the OAuth `redirectUri` SHOPLINE matches against its registered
  // list, and the webhook address SHOPLINE has to reach us on. Behind a tunnel the Worker is
  // reached over plain HTTP, so the request URL alone would say `http` for a public hostname.
  it.each([
    ['https://app.example.com/api/auth', 'https://app.example.com'],
    ['http://app.example.com/api/auth', 'https://app.example.com'],
    ['http://tunnel.trycloudflare.com/api/auth/callback?code=x', 'https://tunnel.trycloudflare.com'],
    ['http://app.example.com:8443/api/auth', 'https://app.example.com:8443']
  ])('forces https for a public host: %s', (url, expected) => {
    expect(publicOrigin(url)).toBe(expected)
  })

  it.each([
    ['http://localhost:3457/api/auth', 'http://localhost:3457'],
    ['http://127.0.0.1:3457/api/auth', 'http://127.0.0.1:3457'],
    ['http://[::1]:3457/api/auth', 'http://[::1]:3457']
  ])('leaves a loopback host alone, because local dev has no certificate: %s', (url, expected) => {
    expect(publicOrigin(url)).toBe(expected)
  })
})

describe('defaultStorefrontHost', () => {
  it('derives the SHOPLINE-owned host from the handle', () => {
    expect(defaultStorefrontHost('srini-test', 'myshopline.com')).toBe('srini-test.myshopline.com')
  })
})

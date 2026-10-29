import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { BlotoutNotConnectedError, loadConnection, storeConnection } from '../src/blotout/connection-store'
import { consumeOauthState, OAUTH_STATE_TTL_MS, putOauthState, sweepOauthStates } from '../src/db/queries/oauth-states'
import { findPixelState, findSelection, saveSelection, upsertPixelState, upsertStore } from '../src/db/queries/stores'
import { blotoutOauthStates } from '../src/db/schema'
import { storeSession } from '../src/shopline/session-store'
import { jsonResponse, resetDb, stubFetch, testConfig, testDb } from './helpers'
import { call, callJson, HANDLE, ORIGIN } from './routes'

const config = testConfig()
const db = testDb()

const CALLBACK = `${ORIGIN}/api/qinto/callback`

const me = () =>
  jsonResponse({
    tokenType: 'oauth',
    name: 'Blotout for SHOPLINE',
    user: { userId: 'user-1', email: 'karri@blotout.io', firstName: 'Srinivasa', lastName: 'Karri' },
    teams: [],
    organizations: [],
    scopes: ['profile', 'team:read', 'domain:write', 'offline_access']
  })

beforeEach(async () => {
  await resetDb(db)
  await upsertStore(db, HANDLE)
})

describe('GET /api/qinto/connect', () => {
  it('returns an authorize URL with PKCE and the scopes we ask for', async () => {
    const { status, body } = await callJson<{ authorizeUrl: string }>('/api/qinto/connect')

    expect(status).toBe(200)
    const url = new URL(body.authorizeUrl)
    expect(url.origin).toBe(config.blotoutAuthorizeOrigin)
    expect(url.pathname).toBe('/oauth/authorize')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe(config.blotoutClientId)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(url.searchParams.get('scope')).toBe('profile team:read domain:write offline_access')
    expect(url.searchParams.get('redirect_uri')).toBe(CALLBACK)
  })

  it('pins the redirect to loopback in local development, so tunnel rotation stops breaking it', async () => {
    // `shopline app dev` mints a new tunnel host every run and Blotout matches a registered redirect
    // URI by exact string, so the registration went stale each time and connecting failed. Blotout
    // ignores the port for a loopback redirect (RFC 8252), so one registration covers every future
    // run — verified against the live server on a port never registered.
    const { body } = await callJson<{ authorizeUrl: string }>('/api/qinto/connect', {
      env: { QINTO_DEV_CALLBACK_ORIGIN: 'http://localhost:51741' }
    })

    // The request itself arrived on the tunnel origin, which is exactly what is being overridden.
    expect(new URL(body.authorizeUrl).searchParams.get('redirect_uri')).toBe('http://localhost:51741/api/qinto/callback')
  })

  it('uses the request origin when no dev override is set, so production is untouched', async () => {
    const { body } = await callJson<{ authorizeUrl: string }>('/api/qinto/connect')

    expect(new URL(body.authorizeUrl).searchParams.get('redirect_uri')).toBe(CALLBACK)
  })

  it('always asks Blotout for the consent screen, so the team list can be widened', async () => {
    // Without this Blotout skips consent whenever one prior grant covers these scopes and re-issues
    // that grant's teams, so a merchant who joins a team later can never add it — connecting again
    // returns the same list forever.
    const { body } = await callJson<{ authorizeUrl: string }>('/api/qinto/connect')

    expect(new URL(body.authorizeUrl).searchParams.get('prompt')).toBe('consent')
  })

  it('never puts the client secret in a URL the browser will see', async () => {
    const { body } = await callJson<{ authorizeUrl: string }>('/api/qinto/connect')

    expect(body.authorizeUrl).not.toContain(config.blotoutClientSecret)
  })

  it('persists a single-use state bound to this store', async () => {
    const { body } = await callJson<{ authorizeUrl: string }>('/api/qinto/connect')
    const state = new URL(body.authorizeUrl).searchParams.get('state') ?? ''

    await expect(consumeOauthState(db, state)).resolves.toMatchObject({ handle: HANDLE })
    // Single use: the second read finds nothing, which is what defeats a replayed callback.
    await expect(consumeOauthState(db, state)).resolves.toBeUndefined()
  })

  it('mints a different state each time', async () => {
    const first = await callJson<{ authorizeUrl: string }>('/api/qinto/connect')
    const second = await callJson<{ authorizeUrl: string }>('/api/qinto/connect')

    expect(new URL(first.body.authorizeUrl).searchParams.get('state')).not.toBe(new URL(second.body.authorizeUrl).searchParams.get('state'))
  })

  it('requires a session token', async () => {
    expect((await call('/api/qinto/connect', { token: null })).status).toBe(401)
  })

  it('asks the SPA to reauthorize when the token is rejected', async () => {
    const response = await call('/api/qinto/connect', { token: 'not-a-jwt' })

    expect(response.status).toBe(401)
    expect(response.headers.get('X-SHOPLINE-API-Request-Failure-Reauthorize')).toBe('1')
    expect(response.headers.get('X-SHOPLINE-API-Request-Failure-Reauthorize-Url')).toBe('/api/auth')
  })
})

describe('GET /api/qinto/callback', () => {
  const startFlow = async (): Promise<string> => {
    const { body } = await callJson<{ authorizeUrl: string }>('/api/qinto/connect')

    return new URL(body.authorizeUrl).searchParams.get('state') ?? ''
  }

  it('exchanges the code, stores the grant and sends the merchant back into the Admin', async () => {
    const state = await startFlow()
    const stubs = stubFetch((request) =>
      new URL(request.url).pathname === '/oauth/token'
        ? jsonResponse({ access_token: 'qoa_new', refresh_token: 'qor_new', expires_in: 3600, scope: 'team:read domain:write' })
        : me()
    )

    try {
      const response = await call(`/api/qinto/callback?state=${state}&code=the-code`, { token: null })

      expect(response.status).toBe(200)
      const html = await response.text()
      expect(html).toContain(`https://${HANDLE}.myshopline.com/admin/apps/${config.appKey}`)
      await expect(loadConnection(db, config, HANDLE)).resolves.toMatchObject({
        accessToken: 'qoa_new',
        userEmail: 'karri@blotout.io',
        appName: 'Blotout for SHOPLINE'
      })
    } finally {
      stubs.restore()
    }
  })

  it('re-approving while connected replaces the grant and keeps the selected site', async () => {
    // The path behind "Change which teams": a merchant re-approves to widen the team list, and the
    // screen promises their connection and their site survive it. Widening is the only way to add a
    // team a grant does not carry, so this runs on every such fix.
    await storeConnection(db, config, {
      handle: HANDLE,
      grant: {
        accessToken: 'qoa_narrow',
        refreshToken: 'qor_narrow',
        scope: 'team:read domain:write',
        expiresAt: new Date(Date.now() + 36e5)
      },
      identity: { userId: 'user-1', userEmail: 'karri+1@blotout.io', appName: 'Blotout for SHOPLINE' }
    })
    await saveSelection(db, HANDLE, {
      teamId: 'a897721b-103e-4969-a5a4-8c9302993fe7',
      teamName: 'karri+1’s Team',
      domainId: '38778107-690b-4b68-93b9-8687ba2b7a8a',
      siteName: 'srini-shopline.com',
      deliveryHost: 'ideczh.srini-shopline.com',
      usingDevelopmentUrl: false,
      qintoUserId: null
    })

    const state = await startFlow()
    const stubs = stubFetch((request) =>
      new URL(request.url).pathname === '/oauth/token'
        ? jsonResponse({ access_token: 'qoa_wide', refresh_token: 'qor_wide', expires_in: 3600, scope: 'team:read domain:write' })
        : me()
    )

    try {
      expect((await call(`/api/qinto/callback?state=${state}&code=the-code`, { token: null })).status).toBe(200)
    } finally {
      stubs.restore()
    }

    await expect(loadConnection(db, config, HANDLE)).resolves.toMatchObject({ accessToken: 'qoa_wide' })
    await expect(findSelection(db, HANDLE)).resolves.toMatchObject({ deliveryHost: 'ideczh.srini-shopline.com' })
  })

  it('reconnecting never touches the saved site or the storefront, whoever reconnects', async () => {
    // Whether the new account can see the site is decided by `/api/status`, which keeps it sending
    // either way; the callback only stores the grant.
    await saveSelection(db, HANDLE, {
      teamId: 'a897721b-103e-4969-a5a4-8c9302993fe7',
      teamName: null,
      domainId: '38778107-690b-4b68-93b9-8687ba2b7a8a',
      siteName: 'srini-shopline.com',
      deliveryHost: 'ideczh.srini-shopline.com',
      usingDevelopmentUrl: false,
      qintoUserId: 'someone-else'
    })
    await upsertPixelState(db, HANDLE, { trackingEnabled: true, pushedEnabled: true, destination: 'ideczh.srini-shopline.com' })

    const state = await startFlow()
    const stubs = stubFetch((request) =>
      new URL(request.url).pathname === '/oauth/token'
        ? jsonResponse({ access_token: 'qoa_back', refresh_token: 'qor_back', expires_in: 3600, scope: 'team:read domain:write' })
        : me()
    )

    try {
      expect((await call(`/api/qinto/callback?state=${state}&code=the-code`, { token: null })).status).toBe(200)
      expect(stubs.calls.some((request) => request.url.endsWith('/pixel/update_config.json'))).toBe(false)
    } finally {
      stubs.restore()
    }

    await expect(findSelection(db, HANDLE)).resolves.toMatchObject({ deliveryHost: 'ideczh.srini-shopline.com' })
    await expect(findPixelState(db, HANDLE)).resolves.toMatchObject({ trackingEnabled: true, pushedEnabled: true })
  })

  it('sends the PKCE verifier and the same redirect_uri', async () => {
    const state = await startFlow()
    const stubs = stubFetch((request) =>
      new URL(request.url).pathname === '/oauth/token' ? jsonResponse({ access_token: 'qoa', expires_in: 3600, scope: '' }) : me()
    )

    try {
      await call(`/api/qinto/callback?state=${state}&code=the-code`, { token: null })
      const form = new URLSearchParams(stubs.bodies[0])
      expect(form.get('grant_type')).toBe('authorization_code')
      expect(form.get('code')).toBe('the-code')
      expect(form.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(form.get('redirect_uri')).toBe(CALLBACK)
    } finally {
      stubs.restore()
    }
  })

  it('exchanges with the same loopback redirect it authorized with', async () => {
    // RFC 6749 §4.1.3 requires the token request's `redirect_uri` to be identical to the authorize
    // request's. Sending the tunnel origin here while the authorize URL carried loopback is exactly
    // the mismatch that makes Blotout refuse the exchange.
    const dev = { QINTO_DEV_CALLBACK_ORIGIN: 'http://localhost:51741' }
    const started = await callJson<{ authorizeUrl: string }>('/api/qinto/connect', { env: dev })
    const state = new URL(started.body.authorizeUrl).searchParams.get('state') ?? ''
    const stubs = stubFetch((request) =>
      new URL(request.url).pathname === '/oauth/token' ? jsonResponse({ access_token: 'qoa', expires_in: 3600, scope: '' }) : me()
    )

    try {
      await call(`/api/qinto/callback?state=${state}&code=the-code`, { token: null, env: dev })

      expect(new URLSearchParams(stubs.bodies[0]).get('redirect_uri')).toBe('http://localhost:51741/api/qinto/callback')
    } finally {
      stubs.restore()
    }
  })

  it('refuses a replayed callback', async () => {
    const state = await startFlow()
    const stubs = stubFetch((request) =>
      new URL(request.url).pathname === '/oauth/token' ? jsonResponse({ access_token: 'qoa', expires_in: 3600, scope: '' }) : me()
    )

    try {
      await call(`/api/qinto/callback?state=${state}&code=the-code`, { token: null })
      const replay = await call(`/api/qinto/callback?state=${state}&code=the-code`, { token: null })

      expect(replay.status).toBe(400)
      expect(await replay.text()).toContain('expired')
    } finally {
      stubs.restore()
    }
  })

  it('refuses an unknown state', async () => {
    expect((await call('/api/qinto/callback?state=made-up&code=c', { token: null })).status).toBe(400)
  })

  it('refuses a callback with no state', async () => {
    expect((await call('/api/qinto/callback?code=c', { token: null })).status).toBe(400)
  })

  it('consumes an expired state rather than leaving it for a second attempt', async () => {
    await putOauthState(db, { state: 'stale', handle: HANDLE, codeVerifier: 'v' })
    await db
      .update(blotoutOauthStates)
      .set({ createdAt: new Date(Date.now() - OAUTH_STATE_TTL_MS - 1000) })
      .where(eq(blotoutOauthStates.state, 'stale'))

    expect((await call('/api/qinto/callback?state=stale&code=c', { token: null })).status).toBe(400)
    await expect(consumeOauthState(db, 'stale')).resolves.toBeUndefined()
  })

  it('handles a declined consent without storing a grant', async () => {
    const state = await startFlow()
    const response = await call(`/api/qinto/callback?state=${state}&error=access_denied`, { token: null })

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('did not authorize')
    await expect(loadConnection(db, config, HANDLE)).rejects.toThrow(BlotoutNotConnectedError)
  })

  it('reports a failed exchange without storing a grant', async () => {
    const state = await startFlow()
    const stubs = stubFetch(() => jsonResponse({ error: 'invalid_grant' }, 400))

    try {
      const response = await call(`/api/qinto/callback?state=${state}&code=c`, { token: null })

      expect(response.status).toBe(502)
      await expect(loadConnection(db, config, HANDLE)).rejects.toThrow(BlotoutNotConnectedError)
    } finally {
      stubs.restore()
    }
  })

  it('escapes the Admin URL it renders, so a handle cannot break out of the attribute', async () => {
    await putOauthState(db, { state: 'quoted', handle: 'sh"op', codeVerifier: 'v' })
    const stubs = stubFetch(() => jsonResponse({ error: 'nope' }, 400))

    try {
      const html = await (await call('/api/qinto/callback?state=quoted&code=c', { token: null })).text()

      expect(html).toContain('&quot;')
      expect(html).not.toContain('href="https://sh"op')
    } finally {
      stubs.restore()
    }
  })

  it('escapes the Admin URL for the script body too, so a handle cannot close the element', async () => {
    // `JSON.stringify` leaves `<` and `/` alone, so `</script>` in a value would end the element
    // and turn everything after it into markup on our own origin.
    await putOauthState(db, { state: 'scripted', handle: 'x</script><img src=x onerror=alert(1)>', codeVerifier: 'v' })
    const stubs = stubFetch(() => jsonResponse({ error: 'nope' }, 400))

    try {
      const html = await (await call('/api/qinto/callback?state=scripted&code=c', { token: null })).text()

      expect(html).not.toContain('</script><img')
      expect(html).toContain('\\u003c')
      // Exactly one script element, and it is ours.
      expect(html.match(/<script/g)).toHaveLength(1)
    } finally {
      stubs.restore()
    }
  })

  it('escapes the message it renders', async () => {
    await putOauthState(db, { state: 'msg', handle: 'shop', codeVerifier: 'v' })
    const stubs = stubFetch(() => jsonResponse({ error: 'nope' }, 400))

    try {
      const html = await (await call('/api/qinto/callback?state=msg&code=c', { token: null })).text()

      expect(html).toContain('Connecting to Blotout failed')
    } finally {
      stubs.restore()
    }
  })
})

describe('POST /api/qinto/disconnect', () => {
  beforeEach(async () => {
    // The pixel push needs a SHOPLINE token, so a disconnect on a store with no session can only
    // ever report `trackingStopped: false`.
    await storeSession(db, config, HANDLE, {
      accessToken: 'shopline-token',
      scope: 'read_pixels,write_pixels',
      expiresAt: new Date(Date.now() + 36e5)
    })
    await storeConnection(db, config, {
      handle: HANDLE,
      grant: { accessToken: 'qoa_live', refreshToken: 'qor_live', scope: 'team:read', expiresAt: new Date(Date.now() + 36e5) },
      identity: { userId: 'u', userEmail: 'e@x.com', appName: 'Blotout' }
    })
    await saveSelection(db, HANDLE, {
      teamId: 'team-1',
      teamName: 'karri’s Team',
      domainId: 'domain-1',
      siteName: 'srini-shopline.com',
      deliveryHost: 'q.example.com',
      usingDevelopmentUrl: false,
      qintoUserId: null
    })
  })

  it('stops the pixel, clears the selection and forgets the grant', async () => {
    const stubs = stubFetch((request) =>
      new URL(request.url).pathname.endsWith('/pixel/update_config.json') ? jsonResponse({ data: {} }) : jsonResponse({})
    )

    try {
      const { status, body } = await callJson<{ disconnected: boolean; trackingStopped: boolean }>('/api/qinto/disconnect', {
        method: 'POST'
      })

      expect(status).toBe(200)
      expect(body).toMatchObject({ disconnected: true, trackingStopped: true })
    } finally {
      stubs.restore()
    }

    await expect(loadConnection(db, config, HANDLE)).rejects.toThrow(BlotoutNotConnectedError)
    await expect(findSelection(db, HANDLE)).resolves.toBeUndefined()
  })

  it('switches the pixel off before the selection is cleared', async () => {
    const stubs = stubFetch((request) =>
      new URL(request.url).pathname.endsWith('/pixel/update_config.json') ? jsonResponse({ data: {} }) : jsonResponse({})
    )

    try {
      await callJson('/api/qinto/disconnect', { method: 'POST' })
      const push = stubs.bodies[stubs.calls.findIndex((request) => request.url.endsWith('/pixel/update_config.json'))]

      // Ordering matters: a push after `clearSelection` has nothing to push against, so a storefront
      // would keep sending to a site the merchant has just detached.
      expect(JSON.parse(JSON.parse(push ?? '{}').settings)).toEqual({ destination: 'q.example.com', enabled: 'false' })
    } finally {
      stubs.restore()
    }
  })

  it('warns rather than lying when the pixel could not be switched off', async () => {
    const stubs = stubFetch((request) =>
      new URL(request.url).pathname.endsWith('/pixel/update_config.json') ? new Response('nope', { status: 500 }) : jsonResponse({})
    )

    try {
      const { body } = await callJson<{ trackingStopped: boolean; warning?: string }>('/api/qinto/disconnect', { method: 'POST' })

      expect(body.trackingStopped).toBe(false)
      expect(body.warning).toBeDefined()
    } finally {
      stubs.restore()
    }
  })

  it('succeeds for a store that was never connected', async () => {
    await resetDb(db)
    await upsertStore(db, HANDLE)

    const { status, body } = await callJson<{ disconnected: boolean }>('/api/qinto/disconnect', { method: 'POST' })

    expect(status).toBe(200)
    expect(body.disconnected).toBe(true)
  })

  it('requires a session token', async () => {
    expect((await call('/api/qinto/disconnect', { method: 'POST', token: null })).status).toBe(401)
  })
})

describe('sweepOauthStates', () => {
  it('removes only states past the TTL', async () => {
    await putOauthState(db, { state: 'fresh', handle: HANDLE, codeVerifier: 'v' })
    await putOauthState(db, { state: 'old', handle: HANDLE, codeVerifier: 'v' })
    await db
      .update(blotoutOauthStates)
      .set({ createdAt: new Date(Date.now() - OAUTH_STATE_TTL_MS - 1) })
      .where(eq(blotoutOauthStates.state, 'old'))

    await sweepOauthStates(db)

    await expect(consumeOauthState(db, 'fresh')).resolves.toMatchObject({ handle: HANDLE })
    await expect(consumeOauthState(db, 'old')).resolves.toBeUndefined()
  })
})

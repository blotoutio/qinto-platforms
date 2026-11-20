import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { verifyMessage } from '../src/common/site-verify'
import { hmacSha256Hex } from '../src/crypto/hmac'
import { OAUTH_STATE_TTL_MS, putOauthState } from '../src/db/queries/oauth-states'
import { findRegistration, readSiteSecret } from '../src/db/queries/registrations'
import { findSelection, saveSelection } from '../src/db/queries/selections'
import { oauthStates, qintoConnections } from '../src/db/schema'
import { connectionState } from '../src/services/connection-store'
import type { SeededRegistration } from './helpers'
import {
  jsonResponse,
  RETURN_URL,
  rawColumn,
  resetDb,
  SHOP_ID,
  seedConnection,
  seedRegistration,
  stubFetch,
  testConfig,
  testDb
} from './helpers'
import { call, ORIGIN, signedJson } from './routes'

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

const register = (body: unknown, env: Partial<Env> = {}) => {
  return call('/register', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), env })
}

describe('POST /register', () => {
  it('mints a secret once and stores it only encrypted', async () => {
    const response = await register({ shopId: SHOP_ID, returnUrl: RETURN_URL })
    const body = (await response.json()) as { registrationId: string; secret: string }

    expect(response.status).toBe(201)
    expect(body.secret).toMatch(/^[0-9a-f]{64}$/)
    const stored = await rawColumn('registrations', 'site_secret_enc', 'id', body.registrationId)
    expect(stored).toMatch(/^v1\./)
    expect(stored).not.toContain(body.secret)
    const row = await findRegistration(db, body.registrationId)
    expect(row?.verifiedAt).toBeNull()
    expect(await readSiteSecret(config, row as NonNullable<typeof row>)).toBe(body.secret)
  })

  it('refuses a return URL on another host, so the broker is no open redirect', async () => {
    const response = await register({ shopId: SHOP_ID, returnUrl: 'https://evil.example.com/wp-admin/admin-post.php' })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'bad_request' })
  })

  it('refuses a non-https site, an IP, a port, a bare host and a body that is not JSON', async () => {
    expect((await register({ shopId: 'http://shop.example.com', returnUrl: RETURN_URL })).status).toBe(400)
    expect((await register('{oops')).status).toBe(400)
    for (const shopId of ['https://127.0.0.1', 'https://localhost', 'https://shop.example.com:8443', 'https://intranet']) {
      expect((await register({ shopId, returnUrl: `${shopId}/wp-admin/admin-post.php` })).status).toBe(400)
    }
  })

  it('is rate limited by client IP', async () => {
    const keys: string[] = []
    const limiter: RateLimit = {
      limit: async ({ key }) => {
        keys.push(key)

        return { success: false }
      }
    }
    const response = await call('/register', {
      method: 'POST',
      body: JSON.stringify({ shopId: SHOP_ID, returnUrl: RETURN_URL }),
      headers: { 'cf-connecting-ip': '203.0.113.9' },
      env: { REGISTER_LIMITER: limiter }
    })

    expect(response.status).toBe(429)
    expect(keys).toEqual(['203.0.113.9'])
    await register({ shopId: SHOP_ID, returnUrl: RETURN_URL }, { REGISTER_LIMITER: limiter })
    expect(keys[1]).toBe('unknown')
  })
})

describe('POST /connect and the start page', () => {
  const answerOwnership = (secret: string) => {
    return stubFetch(async (request) => {
      const challenge = new URL(request.url).searchParams.get('challenge') ?? ''

      return new Response(await hmacSha256Hex(secret, verifyMessage(challenge)))
    })
  }

  const startLogin = async (registration: SeededRegistration, wpNonce = 'abc123') => {
    const stub = answerOwnership(registration.secret)
    restore = stub.restore
    const result = await signedJson<{ startUrl: string }>(registration, '/connect', { method: 'POST', body: { wpNonce } })
    stub.restore()
    restore = undefined

    return { ...result, ownershipCalls: stub.calls.length }
  }

  const authorizeFrom = async (startUrl: string) => {
    const url = new URL(startUrl)
    const response = await call(`${url.pathname}${url.search}`)
    const html = await response.text()
    const href = /href="([^"]+)"/.exec(html)?.[1]?.replaceAll('&amp;', '&') ?? ''

    return { response, html, authorize: new URL(href) }
  }

  it('proves ownership, then hands back a start page on the broker', async () => {
    const registration = await seedRegistration(db, { verified: false })

    const { status, body, ownershipCalls } = await startLogin(registration)

    expect(status).toBe(200)
    expect(ownershipCalls).toBe(1)
    expect((await findRegistration(db, registration.id))?.verifiedAt).not.toBeNull()
    expect(body.startUrl).toMatch(new RegExp(`^${ORIGIN}/oauth/start\\?state=`))
  })

  it('proves ownership again on every login, so a domain that changed hands must prove it anew', async () => {
    const registration = await seedRegistration(db)

    expect((await startLogin(registration)).ownershipCalls).toBe(1)
  })

  it('names the site before Qinto, and links to a PKCE authorize URL with our scopes', async () => {
    const registration = await seedRegistration(db)
    const { body } = await startLogin(registration)

    const { response, html, authorize } = await authorizeFrom(body.startUrl)

    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'")
    expect(html).toContain('Connect shop.example.com to Qinto')
    expect(authorize.origin).toBe(config.qintoAuthorizeOrigin)
    expect(authorize.searchParams.get('scope')).toBe('profile team:read domain:write feature:manage_domain_apps:write offline_access')
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorize.searchParams.get('prompt')).toBe('consent')
    expect(authorize.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/oauth/callback`)
    expect(html).not.toContain(config.qintoClientSecret)
  })

  it('gives every login its own verifier', async () => {
    const registration = await seedRegistration(db)
    const first = await authorizeFrom((await startLogin(registration, 'a')).body.startUrl)
    const second = await authorizeFrom((await startLogin(registration, 'b')).body.startUrl)

    expect(first.authorize.searchParams.get('code_challenge')).not.toBe(second.authorize.searchParams.get('code_challenge'))
  })

  it('refuses an unknown or expired start link', async () => {
    expect((await call('/oauth/start?state=nope')).status).toBe(400)
    expect((await call('/oauth/start')).status).toBe(400)
  })

  it('refuses a site that cannot prove it holds the secret', async () => {
    const registration = await seedRegistration(db, { verified: false })
    restore = answerOwnership('9'.repeat(64)).restore

    const { status, body } = await signedJson(registration, '/connect', { method: 'POST', body: { wpNonce: 'abc' } })

    expect(status).toBe(403)
    expect(body).toEqual({ error: 'site_verification_failed' })
  })

  it('refuses an unsigned call and a malformed nonce', async () => {
    const registration = await seedRegistration(db)

    expect((await call('/connect', { method: 'POST', body: '{}' })).status).toBe(401)
    expect((await signedJson(registration, '/connect', { method: 'POST', body: { wpNonce: '<script>' } })).status).toBe(400)
  })
})

describe('GET /oauth/callback', () => {
  const STATE = 'state-1'

  const startLogin = async (registration: SeededRegistration) => {
    await putOauthState(db, config.tokenKek, { state: STATE, registrationId: registration.id, codeVerifier: 'verifier-1', wpNonce: 'wpn' })
  }

  const qintoAccepts = () => {
    return stubFetch((request) => {
      if (new URL(request.url).pathname === '/oauth/token') {
        return jsonResponse({ access_token: 'qoa_new', refresh_token: 'qor_new', expires_in: 3600, scope: 'profile' })
      }

      return jsonResponse({ user: { userId: 'user-9', email: 'admin@shop.example.com' } })
    })
  }

  const location = (response: Response) => new URL(response.headers.get('Location') ?? '')

  it('exchanges the code with this login’s verifier, stores the grant and returns to the pinned URL', async () => {
    const registration = await seedRegistration(db)
    await startLogin(registration)
    const stub = qintoAccepts()
    restore = stub.restore

    const response = await call(`/oauth/callback?state=${STATE}&code=c-1`)

    expect(response.status).toBe(302)
    const back = location(response)
    expect(`${back.origin}${back.pathname}`).toBe('https://shop.example.com/wp-admin/admin-post.php')
    expect(back.searchParams.get('action')).toBe('blotout_callback')
    expect(back.searchParams.get('result')).toBe('connected')
    expect(back.searchParams.get('nonce')).toBe('wpn')
    expect(back.toString()).not.toContain('qoa_new')
    expect(new URLSearchParams(stub.bodies[0]).get('code_verifier')).toBe('verifier-1')
    expect(stub.calls[0]?.headers.get('Authorization')).toBe(`Basic ${btoa('qc_test:qcs_test')}`)
    expect((await connectionState(db, registration.id)).userEmail).toBe('admin@shop.example.com')
    expect(await rawColumn('qinto_connections', 'access_token_enc', 'registration_id', registration.id)).not.toContain('qoa_new')
  })

  it('stores the verifier encrypted and bound to its own state', async () => {
    const registration = await seedRegistration(db)
    await startLogin(registration)
    const stored = String(await rawColumn('oauth_states', 'code_verifier', 'state', STATE))
    await db
      .insert(oauthStates)
      .values({ state: 'moved', registrationId: registration.id, codeVerifier: stored, wpNonce: 'n', createdAt: new Date() })

    expect(stored).not.toContain('verifier-1')
    expect((await call('/oauth/callback?state=moved&code=c')).status).toBe(400)
  })

  it('revokes the grant it replaces, and drops a site picked by a different Qinto user', async () => {
    const registration = await seedRegistration(db)
    await seedConnection(db, registration.id)
    await saveSelection(db, registration.id, {
      teamId: 't',
      domainId: 'd',
      siteName: null,
      deliveryHost: 'h.example.com',
      usingDevelopmentUrl: false,
      appInstalledAt: new Date()
    })
    await startLogin(registration)
    const stub = qintoAccepts()
    restore = stub.restore

    await call(`/oauth/callback?state=${STATE}&code=c-1`)

    const revoked = stub.calls.flatMap((request, index) =>
      new URL(request.url).pathname === '/oauth/revoke' ? [new URLSearchParams(stub.bodies[index]).get('token')] : []
    )
    expect(revoked.sort()).toEqual(['qoa_access', 'qor_refresh'])
    expect(await findSelection(db, registration.id)).toBeUndefined()
  })

  it('keeps the site when the same Qinto user reconnects', async () => {
    const registration = await seedRegistration(db)
    await seedConnection(db, registration.id)
    await db.update(qintoConnections).set({ qintoUserId: 'user-9' })
    await saveSelection(db, registration.id, {
      teamId: 't',
      domainId: 'd',
      siteName: null,
      deliveryHost: 'h.example.com',
      usingDevelopmentUrl: false,
      appInstalledAt: new Date()
    })
    await startLogin(registration)
    restore = qintoAccepts().restore

    await call(`/oauth/callback?state=${STATE}&code=c-1`)

    expect(await findSelection(db, registration.id)).toBeDefined()
  })

  it('consumes the state, so a replayed callback finds nothing', async () => {
    const registration = await seedRegistration(db)
    await startLogin(registration)
    restore = qintoAccepts().restore

    await call(`/oauth/callback?state=${STATE}&code=c-1`)

    expect((await call(`/oauth/callback?state=${STATE}&code=c-1`)).status).toBe(400)
  })

  it('returns "denied" when the admin declines', async () => {
    const registration = await seedRegistration(db)
    await startLogin(registration)

    const response = await call(`/oauth/callback?state=${STATE}&error=access_denied`)

    expect(location(response).searchParams.get('result')).toBe('denied')
  })

  it('returns "failed" when Qinto refuses the code', async () => {
    const registration = await seedRegistration(db)
    await startLogin(registration)
    restore = stubFetch(() => jsonResponse({ error: 'invalid_grant' }, 400)).restore

    const response = await call(`/oauth/callback?state=${STATE}&code=bad`)

    expect(location(response).searchParams.get('result')).toBe('failed')
  })

  it('refuses a missing, unknown or expired state', async () => {
    const registration = await seedRegistration(db)
    await db.insert(oauthStates).values({
      state: 'old',
      registrationId: registration.id,
      codeVerifier: 'v',
      wpNonce: 'n',
      createdAt: new Date(Date.now() - OAUTH_STATE_TTL_MS - 1000)
    })

    expect((await call('/oauth/callback')).status).toBe(400)
    expect((await call('/oauth/callback?state=unknown&code=c')).status).toBe(400)
    expect((await call('/oauth/callback?state=old&code=c')).status).toBe(400)
  })

  it('stores no identity when Qinto has no user on the token', async () => {
    const registration = await seedRegistration(db)
    await startLogin(registration)
    restore = stubFetch((request) =>
      new URL(request.url).pathname === '/oauth/token'
        ? jsonResponse({ access_token: 'qoa', expires_in: 60 })
        : jsonResponse({ user: null })
    ).restore

    await call(`/oauth/callback?state=${STATE}&code=c`)

    expect(await rawColumn('qinto_connections', 'qinto_user_email', 'registration_id', registration.id)).toBeNull()
  })
})

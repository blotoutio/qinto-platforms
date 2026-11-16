import { env } from 'cloudflare:workers'

import type { AppConfig } from '../src/config'
import { encryptSecret, secretAad } from '../src/crypto/secret'
import type { Db } from '../src/db/client'
import { openDb } from '../src/db/client'
import { createRegistration, markVerified } from '../src/db/queries/registrations'
import { oauthStates, qintoConnections, registrations, siteSelections, usedNonces } from '../src/db/schema'

export const testConfig = (overrides: Partial<AppConfig> = {}): AppConfig => ({
  qintoApiOrigin: env.QINTO_API_ORIGIN,
  qintoAuthorizeOrigin: env.QINTO_AUTHORIZE_ORIGIN,
  qintoClientId: env.QINTO_CLIENT_ID,
  qintoClientSecret: env.QINTO_CLIENT_SECRET,
  tokenKek: env.TOKEN_KEK,
  ...overrides
})

export const testDb = (): Db => openDb(env.DB)

export const resetDb = async (db: Db): Promise<void> => {
  await db.delete(siteSelections)
  await db.delete(qintoConnections)
  await db.delete(oauthStates)
  await db.delete(registrations)
  await db.delete(usedNonces)
}

/** Reads a column back as D1 stored it, bypassing Drizzle and our helpers. */
export const rawColumn = async (table: string, column: string, whereColumn: string, value: string): Promise<unknown> => {
  const row = await env.DB.prepare(`select ${column} as v from ${table} where ${whereColumn} = ?`).bind(value).first<{ v: unknown }>()

  return row?.v ?? null
}

export const SHOP_ID = 'https://shop.example.com'
export const RETURN_URL = 'https://shop.example.com/wp-admin/admin-post.php?action=blotout_callback'

export type SeededRegistration = { id: string; secret: string; shopId: string; returnUrl: string }

export const seedRegistration = async (db: Db, options: { verified?: boolean; shopId?: string } = {}): Promise<SeededRegistration> => {
  const shopId = options.shopId ?? SHOP_ID
  const seeded = {
    id: crypto.randomUUID(),
    secret: 'a'.repeat(64),
    shopId,
    returnUrl: `${shopId}/wp-admin/admin-post.php?action=blotout_callback`
  }
  await createRegistration(db, testConfig(), seeded)
  if (options.verified ?? true) {
    await markVerified(db, seeded.id)
  }

  return seeded
}

export type SeedConnectionOptions = { accessToken?: string; refreshToken?: string | null; expiresAt?: Date; revoked?: boolean }

export const seedConnection = async (db: Db, registrationId: string, options: SeedConnectionOptions = {}): Promise<void> => {
  const kek = env.TOKEN_KEK
  const refreshToken = options.refreshToken === undefined ? 'qor_refresh' : options.refreshToken
  await db.insert(qintoConnections).values({
    registrationId,
    qintoUserId: 'user-1',
    qintoUserEmail: 'admin@example.com',
    accessTokenEnc: await encryptSecret(
      kek,
      options.accessToken ?? 'qoa_access',
      secretAad('qinto_connections', registrationId, 'access_token_enc')
    ),
    accessTokenExpiresAt: options.expiresAt ?? new Date(Date.now() + 3600_000),
    refreshTokenEnc:
      refreshToken === null
        ? null
        : await encryptSecret(kek, refreshToken, secretAad('qinto_connections', registrationId, 'refresh_token_enc')),
    scope: 'profile team:read domain:write feature:manage_domain_apps:write offline_access',
    revokedAt: options.revoked === true ? new Date() : null
  })
}

type FetchStub = { calls: Request[]; bodies: string[]; restore: () => void }

/** Replaces `fetch` for one test, recording what we sent. Qinto is never reachable from the runtime. */
export const stubFetch = (handler: (request: Request) => Response | Promise<Response>): FetchStub => {
  const original = globalThis.fetch
  const calls: Request[] = []
  const bodies: string[] = []

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input as RequestInfo, init)
    calls.push(request.clone())
    bodies.push(new TextDecoder().decode(await request.clone().arrayBuffer()))

    return handler(request)
  }) as typeof fetch

  return {
    calls,
    bodies,
    restore: () => {
      globalThis.fetch = original
    }
  }
}

export const jsonResponse = (body: unknown, status = 200): Response => {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/**
 * A fake Qinto keyed by `METHOD /path`. An unrouted call answers 404 `not_found`, so a test that
 * forgets a route fails loudly instead of passing on a default.
 */
export const fakeQinto = (routes: Record<string, () => Response>): FetchStub => {
  return stubFetch((request) => {
    const url = new URL(request.url)
    const route = routes[`${request.method} ${url.pathname}`]

    return route === undefined ? jsonResponse({ error: 'not_found' }, 404) : route()
  })
}

export const TEAM_ID = '11111111-1111-4111-8111-111111111111'
export const DOMAIN_ID = '22222222-2222-4222-8222-222222222222'
export const SITE_PATH = `/teams/${TEAM_ID}/domains/${DOMAIN_ID}`

export const qintoSite = (overrides: Record<string, unknown> = {}) => ({
  domainId: DOMAIN_ID,
  name: 'Shop',
  domain: 'q.shop.example.com',
  rootDomain: 'shop.example.com',
  subdomain: 'q',
  status: 'active',
  developmentUrl: 'shop-abc.qinto.site',
  deliveryMode: 'domain',
  deliveryLive: true,
  ...overrides
})

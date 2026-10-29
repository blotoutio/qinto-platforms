import { env } from 'cloudflare:workers'

import type { AppConfig } from '../src/config'
import type { Db } from '../src/db/client'
import { openDb } from '../src/db/client'
import { blotoutConnections, blotoutOauthStates, onboarding, pixelState, shoplineSessions, siteSelections, stores } from '../src/db/schema'

export const testConfig = (overrides: Partial<AppConfig> = {}): AppConfig => ({
  appKey: env.SHOPLINE_APP_KEY,
  appSecret: env.SHOPLINE_APP_SECRET,
  apiHost: env.SHOPLINE_API_HOST,
  blotoutApiOrigin: env.QINTO_API_ORIGIN,
  blotoutAuthorizeOrigin: env.QINTO_AUTHORIZE_ORIGIN,
  blotoutClientId: env.QINTO_CLIENT_ID,
  blotoutClientSecret: env.QINTO_CLIENT_SECRET,
  tokenKek: env.TOKEN_KEK,
  ...overrides
})

export const testDb = (): Db => openDb(env.DB)

/**
 * Empties every table.
 *
 * Explicit rather than relying on the cascades, because a test that asserts a cascade must start
 * from a state the cascade did not create.
 */
export const resetDb = async (db: Db): Promise<void> => {
  await db.delete(onboarding)
  await db.delete(pixelState)
  await db.delete(siteSelections)
  await db.delete(blotoutConnections)
  await db.delete(blotoutOauthStates)
  await db.delete(shoplineSessions)
  await db.delete(stores)
}

/** Reads a column back as D1 stored it, bypassing Drizzle's decoding and our own helpers. */
export const rawColumn = async (table: string, column: string, whereColumn: string, value: string): Promise<unknown> => {
  const row = await env.DB.prepare(`select ${column} as v from ${table} where ${whereColumn} = ?`).bind(value).first<{ v: unknown }>()

  return row?.v ?? null
}

type FetchStub = { calls: Request[]; bodies: string[]; restore: () => void }

/**
 * Replaces `fetch` for the duration of a test.
 *
 * The Worker's outbound calls are the only thing these suites cannot exercise for real: SHOPLINE
 * and Blotout are not reachable from the test runtime, and a live call would make the suite depend on
 * someone else's uptime. Every stub records the request so the assertion is about what we *sent*,
 * not only about what we did with the answer.
 */
export const stubFetch = (handler: (request: Request) => Response | Promise<Response>): FetchStub => {
  const original = globalThis.fetch
  const calls: Request[] = []
  const bodies: string[] = []

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input as RequestInfo, init)
    calls.push(request.clone())
    // Decoded here rather than by the assertion: workerd warns when `.text()` is called on a body
    // whose Content-Type is not textual, and every OAuth body is form-encoded.
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

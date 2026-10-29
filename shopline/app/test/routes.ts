import { env } from 'cloudflare:workers'

import app from '../src/index'
import { hmacSha256Hex } from '../src/shopline/crypto'

/**
 * Drives the real Hono app.
 *
 * The middleware chain, the CSP header and the error table are exactly what a merchant's browser
 * hits, so the route suites go through `app.fetch` rather than calling handlers directly.
 */
export const ORIGIN = 'https://tunnel.example.com'

export const HANDLE = 'srini-test'

const base64Url = (value: string): string => btoa(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')

/** A session token the app will accept, signed the way SHOPLINE signs one. */
export const sessionToken = async (overrides: Record<string, unknown> = {}): Promise<string> => {
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = base64Url(JSON.stringify({ handle: HANDLE, sub: 'staff-1', exp: Math.floor(Date.now() / 1000) + 600, ...overrides }))
  const hex = await hmacSha256Hex(btoa(env.SHOPLINE_APP_SECRET), `${header}.${payload}`)
  const bytes = (hex.match(/../g) ?? []).map((pair) => Number.parseInt(pair, 16))

  return `${header}.${payload}.${base64Url(String.fromCharCode(...bytes))}`
}

export type CallOptions = {
  method?: string
  body?: unknown
  token?: string | null
  headers?: Record<string, string>
  /** Overrides bindings for this one request, for a binding only local development sets. */
  env?: Partial<Env>
}

/** One authenticated API call. Pass `token: null` to test the unauthenticated path. */
export const call = async (path: string, options: CallOptions = {}): Promise<Response> => {
  const token = options.token === null ? undefined : (options.token ?? (await sessionToken()))

  return app.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...options.headers
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
    }),
    options.env === undefined ? env : ({ ...env, ...options.env } as typeof env)
  )
}

export const callJson = async <T>(path: string, options: CallOptions = {}): Promise<{ status: number; body: T }> => {
  const response = await call(path, options)

  return { status: response.status, body: (await response.json()) as T }
}

/** A webhook request signed with the app secret, the way SHOPLINE signs one. */
export const webhook = async (topic: string, body: unknown, overrides: { hmac?: string } = {}): Promise<Response> => {
  const raw = JSON.stringify(body)

  return app.fetch(
    new Request(`${ORIGIN}/api/webhooks`, {
      method: 'POST',
      headers: {
        'X-Shopline-Topic': topic,
        'X-Shopline-Hmac-Sha256': overrides.hmac ?? (await hmacSha256Hex(env.SHOPLINE_APP_SECRET, raw)),
        'X-Shopline-Shop-Domain': `${HANDLE}.myshopline.com`,
        'Content-Type': 'application/json'
      },
      body: raw
    }),
    env
  )
}

/** An install callback with a valid `sign` over the whole query. */
export const installCallback = async (
  query: Record<string, string>,
  path = '/api/auth/callback',
  headers: Record<string, string> = {}
): Promise<Response> => {
  const { signedQueryString } = await import('../src/shopline/crypto')
  const sign = await hmacSha256Hex(env.SHOPLINE_APP_SECRET, signedQueryString(query))
  const search = new URLSearchParams({ ...query, sign }).toString()

  return app.fetch(new Request(`${ORIGIN}${path}?${search}`, { headers }), env)
}

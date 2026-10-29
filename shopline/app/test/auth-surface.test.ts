import { describe, expect, it } from 'vitest'

import { call, sessionToken } from './routes'

/**
 * Exactly four endpoints may be reached without a session token, and each has its own proof of
 * origin instead:
 *
 * - `GET /api/auth` — the install entry point. It has nothing to protect; it only redirects.
 * - `GET /api/auth/callback` — SHOPLINE's `sign` HMAC over the whole query.
 * - `GET /api/qinto/callback` — a single-use `state` row, because it arrives top-level with no
 *   App Bridge and therefore no session token.
 * - `POST /api/webhooks` — `X-Shopline-Hmac-Sha256` over the raw body.
 *
 * Plus `/api/health`, which returns a constant.
 *
 * This suite exists because `/api/status` once shipped without its guard: it read
 * `c.get('handle')`, got nothing, and failed on a query rather than leaking — but the next such
 * omission might not be so lucky. Adding a route means adding it here.
 */
const GUARDED = [
  ['GET', '/api/status'],
  ['GET', '/api/qinto/connect'],
  ['POST', '/api/qinto/disconnect'],
  ['GET', '/api/qinto/teams'],
  ['GET', '/api/qinto/domain-suggestions'],
  ['POST', '/api/setup/select'],
  ['POST', '/api/setup/site'],
  ['GET', '/api/setup/dns'],
  ['POST', '/api/setup/dns/check'],
  ['POST', '/api/setup/deploy'],
  ['PUT', '/api/setup/onboarding'],
  ['PUT', '/api/settings/tracking'],
  ['POST', '/api/settings/retry-push'],
  ['POST', '/api/settings/change-site']
] as const

describe('every store-scoped route requires a session token', () => {
  it.each(GUARDED)('%s %s', async (method, path) => {
    const response = await call(path, { method, token: null, ...(method === 'GET' ? {} : { body: {} }) })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'unauthenticated' })
  })

  it.each(GUARDED)('%s %s rejects a forged token', async (method, path) => {
    const response = await call(path, { method, token: 'forged.token.here', ...(method === 'GET' ? {} : { body: {} }) })

    expect(response.status).toBe(401)
  })
})

describe('the handle from a session token is still validated', () => {
  it.each([
    ['a dot, which would point the origin elsewhere', 'evil.com'],
    ['a slash, which would escape the path', 'shop/../other'],
    ['an uppercase letter, which SHOPLINE never issues', 'SriniTest'],
    ['markup, which would reach a CSP header and an HTML page', 'x</script>'],
    ['an empty-ish handle with a leading hyphen', '-shop']
  ])('rejects a validly signed token carrying %s', async (_label, handle) => {
    // Only SHOPLINE can mint a token that reaches this check, so this is defence in depth — but the
    // handle is interpolated into an origin, a redirect and a CSP header, and a signature is not a
    // reason to skip validating a value.
    const response = await call('/api/status', { token: await sessionToken({ handle }) })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'unauthenticated' })
  })

  it('accepts the handles SHOPLINE does issue', async () => {
    const response = await call('/api/status', { token: await sessionToken({ handle: 'srini-test' }) })

    expect(response.status).toBe(200)
  })
})

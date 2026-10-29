import { createMiddleware } from 'hono/factory'

import { isValidHandle, readConfig } from '../config'
import { openDb } from '../db/client'
import { SessionTokenError, verifySessionToken } from '../shopline/crypto'
import type { AppEnv } from './context'

/** Configuration and the database handle, for every route including the unauthenticated ones. */
export const withContext = createMiddleware<AppEnv>(async (c, next) => {
  c.set('config', readConfig(c.env))
  c.set('db', openDb(c.env.DB))

  return next()
})

/**
 * Requires a valid App Bridge session token.
 *
 * This is the only thing that establishes which store is calling. Nothing downstream may take a
 * handle from a query parameter or a body — that would let any caller act as any store.
 */
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('Authorization')
  if (header === undefined || !header.startsWith('Bearer ')) {
    return c.json({ error: 'unauthenticated' }, 401)
  }

  try {
    const claims = await verifySessionToken(c.get('config').appSecret, header.slice('Bearer '.length).trim())
    // Only SHOPLINE can mint a token that gets this far, but the handle is interpolated into an
    // origin and a CSP header downstream, so it is checked here rather than trusted for being signed.
    if (!isValidHandle(claims.handle)) {
      return c.json({ error: 'unauthenticated' }, 401)
    }

    c.set('handle', claims.handle)
    c.set('staffSubject', claims.sub)
  } catch (error) {
    // `verifySessionToken` throws nothing else, so this is unreachable today. It stays because a
    // future WebCrypto or parsing failure must surface as a 500 rather than as a silent 401 that
    // sends the merchant round the install loop forever.
    /* istanbul ignore if -- @preserve: unreachable; see above */
    if (!(error instanceof SessionTokenError)) {
      throw error
    }

    // The SPA turns this header into a top-level reauthorization redirect.
    c.header('X-SHOPLINE-API-Request-Failure-Reauthorize', '1')
    c.header('X-SHOPLINE-API-Request-Failure-Reauthorize-Url', '/api/auth')

    return c.json({ error: 'unauthenticated' }, 401)
  }

  return next()
})

/**
 * Lets the SHOPLINE Admin embed the app, and nobody else.
 *
 * `frame-ancestors` has to name the store's own admin origin, which is why it is derived from the
 * handle rather than fixed. Without a usable handle there is nothing to allow, so framing is denied.
 *
 * The handle is **validated**, not merely read. This runs on every request including the
 * unauthenticated ones, so the query parameter is attacker-controlled — and `?handle=*%20evil`
 * would emit `frame-ancestors https://* evil.myshopline.com`, where `https://*` is a legal
 * host-source matching every HTTPS origin. That turns the one header standing between this app and
 * being framed by anyone into a header that permits exactly that.
 */
export const embedHeaders = createMiddleware<AppEnv>(async (c, next) => {
  await next()

  const handle = c.req.query('handle')
  const apiHost = c.get('config').apiHost
  const ancestors = isValidHandle(handle) ? `https://${handle}.${apiHost} https://*.${apiHost}` : "'none'"
  c.header('Content-Security-Policy', `frame-ancestors ${ancestors};`)
  // X-Frame-Options has no origin list, so it would contradict the CSP above. CSP wins in every
  // browser we support; sending both would only make the weaker one authoritative in older ones.
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
})

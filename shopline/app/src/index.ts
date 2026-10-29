import { Hono } from 'hono'

import { BlotoutApiError } from './blotout/client'
import { BlotoutGrantRevokedError, BlotoutNotConnectedError } from './blotout/connection-store'
import { ConfigError, readConfig } from './config'
import { openDb } from './db/client'
import type { AppEnv } from './http/context'
import { embedHeaders, withContext } from './http/middleware'
import { blotoutConnect } from './routes/blotout-connect'
import { blotoutResources } from './routes/blotout-resources'
import { install } from './routes/install'
import { settings } from './routes/settings'
import { setup } from './routes/setup'
import { status } from './routes/status'
import { webhooks } from './routes/webhooks'
import { keepGrantsAlive } from './services/grant-keep-alive'
import { AdminApiError } from './shopline/admin-api'
import { MissingSessionError } from './shopline/session-store'

// The embedded Admin loads `/api/auth/callback/` with a trailing slash; a strict router 404s it.
const app = new Hono<AppEnv>({ strict: false })

app.use('*', withContext)
app.use('*', embedHeaders)

app.route('/', install)
app.route('/', webhooks)
app.route('/', status)
app.route('/', blotoutConnect)
app.route('/', blotoutResources)
app.route('/', setup)
app.route('/', settings)

app.get('/api/health', (c) => c.json({ ok: true }))

/**
 * Everything that is not a route is the SPA.
 *
 * `run_worker_first` means the Worker sees every request, so this is where the fall-through
 * happens. The real asset is tried **first**: rewriting every path to `index.html` would serve the
 * JavaScript bundle as HTML, and the app would never boot. Only a genuine miss becomes the shell,
 * which is what makes a client-side route work on a hard refresh.
 */
app.all('*', async (c) => {
  if (c.req.path.startsWith('/api/')) {
    return c.json({ error: 'not_found' }, 404)
  }

  const asset = await c.env.ASSETS.fetch(c.req.raw)
  if (asset.status !== 404) {
    return asset
  }

  const shell = await c.env.ASSETS.fetch(new Request(new URL('/index.html', c.req.url), { headers: c.req.raw.headers }))

  return new Response(shell.body, { status: shell.status, headers: shell.headers })
})

/**
 * One place that turns a domain error into a status code.
 *
 * Each of these is a state the merchant can be in, not a bug, so each gets a code the SPA can act
 * on rather than a 500 it can only display.
 */
app.onError((error, c) => {
  if (error instanceof ConfigError) {
    console.error('worker is misconfigured', { missing: error.message })

    return c.json({ error: 'misconfigured' }, 500)
  }

  if (error instanceof MissingSessionError) {
    return c.json({ error: 'app_not_installed' }, 401)
  }

  if (error instanceof BlotoutNotConnectedError) {
    return c.json({ error: 'qinto_not_connected' }, 409)
  }

  if (error instanceof BlotoutGrantRevokedError) {
    return c.json({ error: 'qinto_grant_revoked' }, 409)
  }

  if (error instanceof BlotoutApiError) {
    // Blotout's own slug is passed through: `already_exists` and `host_not_ready` need different
    // copy in the UI, and collapsing them here would throw that away.
    return c.json({ error: 'qinto_api', code: error.code, ...(error.detail === undefined ? {} : { detail: error.detail }) }, 502)
  }

  if (error instanceof AdminApiError) {
    console.error('SHOPLINE Admin API failed', { message: error.message, body: error.body })

    return c.json({ error: 'shopline_api', status: error.status }, 502)
  }

  console.error('unhandled error', { path: c.req.path, error: String(error) })

  return c.json({ error: 'internal', ...(c.env.DEBUG_ERRORS === 'true' ? { debug: String(error) } : {}) }, 500)
})

/**
 * The cron that keeps an idle store's Blotout grant from expiring. A missing secret fails the run
 * loudly, the same as it fails a request.
 */
const scheduled: ExportedHandlerScheduledHandler<Env> = (_controller, env, ctx) => {
  ctx.waitUntil(keepGrantsAlive(openDb(env.DB), readConfig(env)))
}

export default { fetch: app.fetch, scheduled } satisfies ExportedHandler<Env>

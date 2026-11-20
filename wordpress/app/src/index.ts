import { Hono } from 'hono'

import type { AppConfig } from './config'
import { ConfigError, readConfig } from './config'
import type { Db } from './db/client'
import { openDb } from './db/client'
import type { AppEnv } from './http/context'
import { withContext } from './http/middleware'
import { BadRequestError } from './http/validate'
import { QintoApiError, QintoContractError } from './qinto/http'
import { qintoDeployUrl } from './qinto/sites'
import { callback } from './routes/callback'
import { connect } from './routes/connect'
import { createSiteRoute } from './routes/create-site'
import { destination } from './routes/destination'
import { disconnect } from './routes/disconnect'
import { dns } from './routes/dns'
import { heartbeat } from './routes/heartbeat'
import { register } from './routes/register'
import { selectSite } from './routes/select-site'
import { sites } from './routes/sites'
import { start } from './routes/start'
import { status } from './routes/status'
import { QintoGrantRevokedError, QintoNotConnectedError, QintoRefreshBusyError, QintoUnavailableError } from './services/connection-store'
import { SiteNotDeployedError } from './services/provision'
import { keepGrantsAlive, reapSilent, sweepExpired } from './services/scheduled'
import { SiteLockedError } from './services/site-scope'

const app = new Hono<AppEnv>()

app.use('*', withContext)

const routes = [register, connect, start, callback, sites, createSiteRoute, dns, selectSite, destination, status, disconnect, heartbeat]
for (const route of routes) {
  app.route('/', route)
}

app.get('/health', (c) => c.json({ ok: true }))

app.notFound((c) => c.json({ error: 'not_found' }, 404))

/** Each error is a state the plugin acts on, so each gets its own code. */
app.onError((error, c) => {
  if (error instanceof BadRequestError) {
    return c.json({ error: 'bad_request', detail: error.message }, 400)
  }

  if (error instanceof QintoNotConnectedError) {
    return c.json({ error: 'qinto_not_connected' }, 409)
  }

  if (error instanceof QintoGrantRevokedError) {
    return c.json({ error: 'qinto_grant_revoked' }, 409)
  }

  if (error instanceof SiteLockedError) {
    return c.json({ error: 'site_locked' }, 409)
  }

  if (error instanceof SiteNotDeployedError) {
    return c.json({ error: 'not_deployed', deployUrl: qintoDeployUrl(c.get('config').qintoAuthorizeOrigin, error.ref) }, 409)
  }

  if (error instanceof QintoRefreshBusyError) {
    c.header('Retry-After', '1')

    return c.json({ error: 'busy' }, 503)
  }

  if (error instanceof QintoUnavailableError) {
    console.warn(error.message)

    return c.json({ error: 'qinto_unavailable' }, 503)
  }

  if (error instanceof QintoApiError) {
    console.warn(error.message)

    // The plugin shows different copy for Qinto's `already_exists` and `forbidden`.
    return c.json({ error: 'qinto_api', code: error.code }, 502)
  }

  if (error instanceof QintoContractError) {
    console.error(error.message)

    return c.json({ error: 'qinto_contract' }, 502)
  }

  if (error instanceof ConfigError) {
    console.error(error.message)

    return c.json({ error: 'misconfigured' }, 500)
  }

  console.error('unhandled error', { path: c.req.path, error: String(error) })

  return c.json({ error: 'internal', ...(c.env.DEBUG_ERRORS === 'true' ? { debug: String(error) } : {}) }, 500)
})

/** Sweep expired rows, rotate idle grants, then forget installs that stopped checking in. */
const runHourly = async (db: Db, config: AppConfig): Promise<void> => {
  await sweepExpired(db)
  await keepGrantsAlive(db, config)
  await reapSilent(db, config)
}

/** Hourly. A missing secret fails the run loudly. */
const scheduled: ExportedHandlerScheduledHandler<Env> = (_controller, env, ctx) => {
  const db = openDb(env.DB)
  const config = readConfig(env)
  ctx.waitUntil(runHourly(db, config))
}

export default { fetch: app.fetch, scheduled } satisfies ExportedHandler<Env>

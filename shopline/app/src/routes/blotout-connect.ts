import { Hono } from 'hono'

import { getMe } from '../blotout/client'
import { BlotoutNotConnectedError, deleteConnection, loadConnection, storeConnection } from '../blotout/connection-store'
import { authorizeUrl, createPkcePair, createState, exchangeCode, revokeToken } from '../blotout/oauth'
import type { AppConfig } from '../config'
import { consumeOauthState, putOauthState, sweepOauthStates } from '../db/queries/oauth-states'
import { clearOnboarding, clearSelection } from '../db/queries/stores'
import type { AppEnv } from '../http/context'
import { requireSession } from '../http/middleware'
import { publicOrigin } from '../http/origin'
import { setTrackingEnabled } from '../services/pixel'

export const blotoutConnect = new Hono<AppEnv>()

export const QINTO_CALLBACK_PATH = '/api/qinto/callback'

/**
 * The redirect URI Blotout sends the merchant back to.
 *
 * Derived from the request so a tunnel hostname and a real one both work — except in local
 * development, where `config.devCallbackOrigin` pins it to loopback. That is not a convenience:
 * `shopline app dev` rotates the tunnel every run, Blotout matches a registered redirect URI by exact
 * string, and one loopback registration covers every port forever. The same value
 * must be sent on the authorize *and* the token request, which is why both call this.
 */
const callbackUri = (config: AppConfig, url: string): string => `${config.devCallbackOrigin ?? publicOrigin(url)}${QINTO_CALLBACK_PATH}`

/**
 * Mints the authorize URL.
 *
 * The URL is returned rather than redirected to: the SPA has to open it at the **top level** via
 * App Bridge, because Blotout's consent screen refuses to render in an iframe.
 */
blotoutConnect.get('/api/qinto/connect', requireSession, async (c) => {
  const db = c.get('db')
  const handle = c.get('handle')

  await sweepOauthStates(db)

  const state = createState()
  const { verifier, challenge } = await createPkcePair()
  await putOauthState(db, { state, handle, codeVerifier: verifier })

  const config = c.get('config')

  return c.json({ authorizeUrl: authorizeUrl(config, { state, challenge, redirectUri: callbackUri(config, c.req.url) }) })
})

/**
 * A small page that closes the loop.
 *
 * The callback arrives top-level, outside the Admin, so there is no App Bridge here and no session
 * token either — which is exactly why the `state` row carries the handle. The page sends the
 * merchant back into the Admin app; a plain redirect would leave them on our origin.
 */
const escapeHtml = (value: string): string => {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

/**
 * Escapes a string for a `<script>` body.
 *
 * `JSON.stringify` alone is not enough: it leaves `<` and `/` alone, so a value containing
 * `</script>` closes the element and everything after it becomes markup. The handle reaching here
 * is checked against `HANDLE_PATTERN`, so this is defence in depth — but it costs one line, and the
 * failure it prevents is script execution on our own origin.
 */
const escapeScript = (value: string): string => {
  return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('/', '\\/')
}

const returnToAdmin = (adminUrl: string, message: string): string => {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Blotout</title>
<style>body{font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:grid;place-items:center;height:100vh;margin:0;color:#1c1917}
a{color:#f25c2b}</style></head>
<body><div><p>${escapeHtml(message)}</p><p><a href="${escapeHtml(adminUrl)}">Return to the app</a></p></div>
<script>window.top.location.href=${escapeScript(adminUrl)}</script></body></html>`
}

blotoutConnect.get(QINTO_CALLBACK_PATH, async (c) => {
  const config = c.get('config')
  const db = c.get('db')
  const state = c.req.query('state')
  const code = c.req.query('code')
  const oauthError = c.req.query('error')

  if (state === undefined) {
    return c.text('missing state', 400)
  }

  const consumed = await consumeOauthState(db, state)
  if (consumed === undefined) {
    return c.text('this connection attempt has expired, please start again', 400)
  }

  const adminUrl = `https://${consumed.handle}.${config.apiHost}/admin/apps/${config.appKey}`

  if (oauthError !== undefined || code === undefined) {
    console.warn('blotout consent declined', { handle: consumed.handle, oauthError })

    return c.html(returnToAdmin(adminUrl, 'Blotout did not authorize the connection.'))
  }

  try {
    const grant = await exchangeCode(config, { code, verifier: consumed.codeVerifier, redirectUri: callbackUri(config, c.req.url) })
    const me = await getMe(config, grant.accessToken)
    await storeConnection(db, config, {
      handle: consumed.handle,
      grant,
      identity: { userId: me.user?.userId ?? null, userEmail: me.user?.email ?? null, appName: me.name }
    })
  } catch (error) {
    // Interpolated rather than passed as an object: `wrangler dev` truncates a logged object, and
    // this is the one message that says why a merchant could not connect.
    console.error(`blotout code exchange failed for ${consumed.handle}: ${String(error)}`)

    return c.html(returnToAdmin(adminUrl, 'Connecting to Blotout failed. Please try again from the app.'), 502)
  }

  return c.html(returnToAdmin(adminUrl, 'Connected to Blotout. Taking you back…'))
})

/**
 * Disconnects the store.
 *
 * The pixel is switched off **first**, while the selection still exists to push against. Doing it
 * afterwards would leave a storefront sending events to a site the merchant has just detached.
 *
 * The site selection and onboarding progress go too: they name a team and a site this store can no
 * longer read, so keeping them would make the next connection start from a stale, unverifiable
 * state. Revocation at Blotout is best-effort — a local disconnect must succeed regardless.
 */
blotoutConnect.post('/api/qinto/disconnect', requireSession, async (c) => {
  const config = c.get('config')
  const db = c.get('db')
  const handle = c.get('handle')

  const stopped = await setTrackingEnabled(db, config, { handle, enabled: false, actor: c.get('staffSubject') })

  try {
    const grant = await loadConnection(db, config, handle)
    await revokeToken(config, grant.accessToken)
  } catch (error) {
    if (!(error instanceof BlotoutNotConnectedError)) {
      console.warn('could not revoke the Blotout token before disconnecting', { handle, error: String(error) })
    }
  }

  await deleteConnection(db, handle)
  await clearSelection(db, handle)
  await clearOnboarding(db, handle)

  // Reported, not swallowed: if the pixel could not be switched off, the storefront may still be
  // sending to a site this store no longer has access to, and the merchant should know.
  return c.json({ disconnected: true, trackingStopped: stopped.pushed, ...(stopped.pushed ? {} : { warning: stopped.error }) })
})

import { Hono } from 'hono'

import { findOauthState } from '../db/queries/oauth-states'
import { findRegistration } from '../db/queries/registrations'
import type { AppEnv } from '../http/context'
import { authorizeUrl, challengeFor } from '../qinto/oauth'
import { callbackUri, LOGIN_EXPIRED, START_PATH } from './connect'

export const start = new Hono<AppEnv>()

const escapeHtml = (value: string): string => {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

const page = (host: string, authorize: string): string => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect to Qinto</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#1c1917}
a.button{display:inline-block;background:#0f766e;color:#fff;padding:.6rem 1.1rem;border-radius:6px;text-decoration:none}</style></head>
<body><h1>Connect ${escapeHtml(host)} to Qinto</h1>
<p>Qinto will ask which teams this WordPress site may use. Continue only if you started this from the WordPress admin of <strong>${escapeHtml(host)}</strong>.</p>
<p><a class="button" href="${escapeHtml(authorize)}">Continue to Qinto</a></p></body></html>`

/** Names the WordPress site before Qinto's consent screen, so a forwarded login link cannot quietly hand over someone's teams. */
start.get(START_PATH, async (c) => {
  const db = c.get('db')
  const config = c.get('config')
  const login = await findOauthState(db, config.tokenKek, c.req.query('state') ?? '')
  const registration = login === undefined ? undefined : await findRegistration(db, login.registrationId)
  if (login === undefined || registration === undefined) {
    return c.text(LOGIN_EXPIRED, 400)
  }

  const authorize = authorizeUrl(config, {
    state: login.state,
    challenge: await challengeFor(login.codeVerifier),
    redirectUri: callbackUri(config, c.req.url)
  })
  c.header('Cache-Control', 'no-store')
  c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'")

  return c.html(page(new URL(registration.shopId).host, authorize))
})

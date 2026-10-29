import { Hono } from 'hono'

import { isValidHandle } from '../config'
import { updateShopFacts, upsertStore } from '../db/queries/stores'
import type { AppEnv } from '../http/context'
import { publicOrigin } from '../http/origin'
import { fetchShopInfo } from '../shopline/admin-api'
import { verifyCallbackSignature } from '../shopline/crypto'
import { authorizeUrl, exchangeInstallCode, ShoplineOauthError } from '../shopline/oauth'
import { storeSession } from '../shopline/session-store'
import { registerWebhooks } from '../shopline/webhook-registration'

export const install = new Hono<AppEnv>()

const callbackUri = (c: { req: { url: string } }): string => `${publicOrigin(c.req.url)}/api/auth/callback`

/**
 * Starts the install.
 *
 * SHOPLINE opens this with `?handle=<store>`. There is no state cookie: the callback is
 * authenticated by SHOPLINE's own `sign` over the whole query, which is stronger than a cookie we
 * mint — and cookies set here would have to be `SameSite=None` to survive the round trip anyway.
 */
install.get('/api/auth', (c) => {
  const handle = c.req.query('handle')
  if (!isValidHandle(handle)) {
    return c.text('missing or malformed handle', 400)
  }

  return c.redirect(authorizeUrl(c.get('config'), handle, callbackUri(c)), 302)
})

/**
 * Finishes the install and hands the merchant to the app inside the Admin.
 *
 * The shop record is fetched with the brand-new token so the first screen already knows the store's
 * primary domain — which the onboarding flow needs and cannot get any other way. A failure there is
 * not fatal: the install is already complete, and the facts are re-read on the next `/api/status`.
 */
install.get('/api/auth/callback', async (c) => {
  const config = c.get('config')
  const query = Object.fromEntries(new URL(c.req.url).searchParams.entries())
  const handle = query['handle']
  const code = query['code']

  if (!isValidHandle(handle) || code === undefined) {
    return c.text('missing handle or code', 400)
  }

  const verification = await verifyCallbackSignature(config.appSecret, query)
  if (!verification.valid) {
    return c.text(verification.reason === 'stale_timestamp' ? 'callback expired, please reinstall' : 'invalid signature', 400)
  }

  let session: Awaited<ReturnType<typeof storeSession>>
  try {
    const db = c.get('db')
    await upsertStore(db, handle)
    session = await storeSession(db, config, handle, await exchangeInstallCode(config, handle, code))
  } catch (error) {
    if (!(error instanceof ShoplineOauthError)) {
      throw error
    }

    console.error('install token exchange failed', { handle, message: error.message })

    return c.text('could not complete the install, please try again', 502)
  }

  // Both are best-effort: the install has already succeeded, and neither the shop facts nor the
  // webhook subscription is worth sending the merchant back to a failure page for. Every install
  // and reinstall runs this again, so a failed fetch is retried there.
  const recordShopFacts = async (): Promise<void> => {
    try {
      await updateShopFacts(c.get('db'), handle, await fetchShopInfo(config, session))
    } catch (error) {
      console.warn('shop info unavailable right after install', { handle, error: String(error) })
    }
  }

  await Promise.all([recordShopFacts(), registerWebhooks(config, session, `${publicOrigin(c.req.url)}/api/webhooks`)])

  // The Admin can load this callback inside the app's own iframe. Redirecting that frame to the
  // Admin URL renders the whole Admin nested inside itself, so a framed callback goes to the app.
  if (c.req.header('Sec-Fetch-Dest') === 'iframe') {
    // `lang` is half of how the SPA knows it is embedded; `appkey` and `handle` are what App Bridge reads.
    const app = new URLSearchParams({ appkey: config.appKey, handle, lang: query['lang'] ?? 'en' })

    return c.redirect(`/?${app}`, 302)
  }

  return c.redirect(`https://${handle}.${config.apiHost}/admin/apps/${config.appKey}`, 302)
})

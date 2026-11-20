import { Hono } from 'hono'

import { consumeOauthState } from '../db/queries/oauth-states'
import { findRegistration } from '../db/queries/registrations'
import { clearSelection } from '../db/queries/selections'
import type { AppEnv } from '../http/context'
import { qintoApi } from '../qinto/http'
import { exchangeCode } from '../qinto/oauth'
import { meResponse } from '../qinto/schemas'
import { revokeTokens, storeConnection, storedGrant } from '../services/connection-store'
import { CALLBACK_PATH, callbackUri, LOGIN_EXPIRED } from './connect'

export const callback = new Hono<AppEnv>()

/** Back to the pinned return URL, never a parameter, with the echoed WP nonce. No token, no id. */
const backTo = (returnUrl: string, wpNonce: string, result: 'connected' | 'denied' | 'failed'): string => {
  const url = new URL(returnUrl)
  url.searchParams.set('nonce', wpNonce)
  url.searchParams.set('result', result)

  return url.toString()
}

/** Qinto sends the admin's browser here. The state is consumed first, so a replayed callback finds nothing. */
callback.get(CALLBACK_PATH, async (c) => {
  const db = c.get('db')
  const config = c.get('config')
  const state = c.req.query('state')
  const login = state === undefined ? undefined : await consumeOauthState(db, config.tokenKek, state)
  const registration = login === undefined ? undefined : await findRegistration(db, login.registrationId)
  if (login === undefined || registration === undefined) {
    return c.text(LOGIN_EXPIRED, 400)
  }

  const code = c.req.query('code')
  if (c.req.query('error') !== undefined || code === undefined) {
    return c.redirect(backTo(registration.returnUrl, login.wpNonce, 'denied'))
  }

  try {
    const grant = await exchangeCode(config, { code, verifier: login.codeVerifier, redirectUri: callbackUri(config, c.req.url) })
    const me = await qintoApi(config, grant.accessToken).get('/me', meResponse)
    const identity = { userId: me.user?.userId ?? null, userEmail: me.user?.email ?? null }
    const previous = await storedGrant(db, config, registration.id)
    await storeConnection(db, config, { registrationId: registration.id, grant, identity })

    // A reconnect revokes the grant it replaced, and drops a site a different Qinto user picked.
    if (previous !== undefined) {
      await revokeTokens(config, previous.tokens)
      if (previous.userId !== identity.userId) {
        await clearSelection(db, registration.id)
      }
    }
  } catch (error) {
    console.error(`qinto code exchange failed for ${registration.id}: ${String(error)}`)

    return c.redirect(backTo(registration.returnUrl, login.wpNonce, 'failed'))
  }

  return c.redirect(backTo(registration.returnUrl, login.wpNonce, 'connected'))
})

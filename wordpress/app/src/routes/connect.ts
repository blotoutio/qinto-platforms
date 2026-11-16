import { Hono } from 'hono'
import { z } from 'zod'

import { verifySiteOwnership } from '../common/site-verify'
import { publicOrigin } from '../common/urls'
import type { AppConfig } from '../config'
import { putOauthState, sweepOauthStates } from '../db/queries/oauth-states'
import { markVerified, readSiteSecret } from '../db/queries/registrations'
import type { AppEnv } from '../http/context'
import { requireSignatureUnverified } from '../http/middleware'
import { readSignedBody } from '../http/validate'
import { createPkceVerifier, createState } from '../qinto/oauth'

export const connect = new Hono<AppEnv>()

export const CALLBACK_PATH = '/oauth/callback'
export const START_PATH = '/oauth/start'

export const LOGIN_EXPIRED = 'This connection attempt has expired. Start again from WordPress.'

/** The broker's origin as the browser sees it; loopback in local development. */
const brokerOrigin = (config: AppConfig, requestUrl: string): string => config.devCallbackOrigin ?? publicOrigin(requestUrl)

/** Must be identical on the authorize and the token request. */
export const callbackUri = (config: AppConfig, requestUrl: string): string => `${brokerOrigin(config, requestUrl)}${CALLBACK_PATH}`

/** Opaque to us; echoed back so the plugin ties the return to its own click. */
const connectBody = z.object({ wpNonce: z.string().regex(/^[A-Za-z0-9]{1,64}$/) })

/** Starts a login. Ownership is proven on every login: a domain that changed hands must prove it again. */
connect.post('/connect', requireSignatureUnverified, async (c) => {
  const db = c.get('db')
  const config = c.get('config')
  const registration = c.get('registration')
  const { wpNonce } = readSignedBody(c, connectBody)

  const secret = await readSiteSecret(config, registration)
  if (!(await verifySiteOwnership(registration.returnUrl, secret))) {
    return c.json({ error: 'site_verification_failed' }, 403)
  }

  if (registration.verifiedAt === null) {
    await markVerified(db, registration.id)
  }

  await sweepOauthStates(db)
  const state = createState()
  await putOauthState(db, config.tokenKek, { state, registrationId: registration.id, codeVerifier: createPkceVerifier(), wpNonce })

  const query = new URLSearchParams({ state }).toString()

  return c.json({ startUrl: `${brokerOrigin(config, c.req.url)}${START_PATH}?${query}` })
})

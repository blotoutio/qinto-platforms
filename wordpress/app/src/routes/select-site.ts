import { Hono } from 'hono'

import { siteOrigin } from '../common/urls'
import type { AppEnv } from '../http/context'
import { qintoApiFor } from '../http/context'
import { requireSignature } from '../http/middleware'
import { readSignedBody, siteRefSchema } from '../http/validate'
import { provisionSite } from '../services/provision'
import { assertInScope } from '../services/site-scope'
import { siteView } from './sites'

export const selectSite = new Hono<AppEnv>()

/** Chooses and provisions the site. The WordPress origin comes from the stored `shopId`, never the request. */
selectSite.post('/select-site', requireSignature, async (c) => {
  const ref = readSignedBody(c, siteRefSchema)
  const registration = c.get('registration')
  await assertInScope(c.get('db'), registration.id, ref)
  const api = await qintoApiFor(c)

  const result = await provisionSite(c.get('db'), api, { registrationId: registration.id, ref, wpOrigin: siteOrigin(registration.shopId) })

  return c.json({ site: siteView(result.site), ...result.delivery, app: result.appAction })
})

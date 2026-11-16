import { Hono } from 'hono'

import type { AppEnv } from '../http/context'
import { qintoApiFor } from '../http/context'
import { requireSignature } from '../http/middleware'
import { readSignedBody, siteRefSchema } from '../http/validate'
import { deploySite } from '../qinto/sites'
import { assertInScope } from '../services/site-scope'

export const deploy = new Hono<AppEnv>()

deploy.post('/deploy', requireSignature, async (c) => {
  const ref = readSignedBody(c, siteRefSchema)
  await assertInScope(c.get('db'), c.get('registration').id, ref)

  return c.json(await deploySite(await qintoApiFor(c), ref))
})

import { Hono } from 'hono'
import { z } from 'zod'

import { isHostname } from '../common/urls'
import type { AppEnv } from '../http/context'
import { qintoApiFor } from '../http/context'
import { requireSignature } from '../http/middleware'
import { qintoId, readSignedBody } from '../http/validate'
import { createSite } from '../qinto/sites'
import { assertInScope } from '../services/site-scope'
import { siteView } from './sites'

export const createSiteRoute = new Hono<AppEnv>()

const createBody = z.object({
  teamId: qintoId,
  rootDomain: z.string().trim().toLowerCase().refine(isHostname, { message: 'rootDomain must be a hostname' }),
  name: z.string().trim().min(1).max(100).optional(),
  subdomain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/)
    .optional()
})

/** A managed site, only before a site is selected. Its DNS records come next, from `GET /dns`. */
createSiteRoute.post('/sites', requireSignature, async (c) => {
  const { teamId, ...input } = readSignedBody(c, createBody)
  await assertInScope(c.get('db'), c.get('registration').id)
  const site = await createSite(await qintoApiFor(c), teamId, input)

  return c.json({ site: siteView(site) }, 201)
})

import { Hono } from 'hono'
import { z } from 'zod'

import { findSelection, updateDestination } from '../db/queries/selections'
import type { AppEnv } from '../http/context'
import { qintoApiFor } from '../http/context'
import { requireSignature } from '../http/middleware'
import { readSignedBody } from '../http/validate'
import { getSite } from '../qinto/sites'

export const destination = new Hono<AppEnv>()

const destinationBody = z.object({ target: z.enum(['domain', 'development_url']) })

/**
 * The "Use Qinto URL" switch. Only the host WordPress prints changes; Qinto's delivery mode is left
 * alone, since one worker answers both hostnames and a deployed site cannot move its mode back.
 */
destination.put('/destination', requireSignature, async (c) => {
  const { target } = readSignedBody(c, destinationBody)
  const db = c.get('db')
  const registrationId = c.get('registration').id
  const selection = await findSelection(db, registrationId)
  if (selection === undefined) {
    return c.json({ error: 'no_site_selected' }, 409)
  }

  const site = await getSite(await qintoApiFor(c), selection)
  const usingDevelopmentUrl = target === 'development_url'
  const host = usingDevelopmentUrl ? site.developmentUrl : site.domain
  if (host === null) {
    return c.json({ error: 'no_qinto_url' }, 409)
  }

  await updateDestination(db, registrationId, { deliveryHost: host, usingDevelopmentUrl })

  return c.json({ host, usingDevelopmentUrl })
})

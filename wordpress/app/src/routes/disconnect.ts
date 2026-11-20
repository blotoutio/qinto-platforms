import { Hono } from 'hono'

import type { AppEnv } from '../http/context'
import { requireSignature } from '../http/middleware'
import { forgetInstall } from '../services/connection-store'

export const disconnect = new Hono<AppEnv>()

/** Revoking the refresh token ends the whole grant at Qinto. The plugin re-registers on its next connect. */
disconnect.post('/disconnect', requireSignature, async (c) => {
  await forgetInstall(c.get('db'), c.get('config'), c.get('registration').id)

  return c.json({ disconnected: true })
})

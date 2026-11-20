import { Hono } from 'hono'

import type { AppEnv } from '../http/context'
import { requireSignature } from '../http/middleware'

export const heartbeat = new Hono<AppEnv>()

/** The plugin's daily check-in; `requireSignature` dates it. */
heartbeat.post('/heartbeat', requireSignature, (c) => c.body(null, 204))

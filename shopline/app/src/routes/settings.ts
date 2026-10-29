import { Hono } from 'hono'

import { clearSelection, findPixelState } from '../db/queries/stores'
import type { AppEnv } from '../http/context'
import { requireSession } from '../http/middleware'
import { pushSettings, setTrackingEnabled } from '../services/pixel'

export const settings = new Hono<AppEnv>()

/**
 * The kill switch.
 *
 * Effective on each visitor's **next page load**: the sandbox reads its settings once when it
 * initializes, so tabs already open keep sending until they navigate. The UI says that rather than
 * promising "instant".
 */
settings.put('/api/settings/tracking', requireSession, async (c) => {
  const body = await c.req.json<{ enabled?: unknown }>()
  if (typeof body.enabled !== 'boolean') {
    return c.json({ error: 'enabled must be true or false' }, 400)
  }

  const result = await setTrackingEnabled(c.get('db'), c.get('config'), {
    handle: c.get('handle'),
    enabled: body.enabled,
    actor: c.get('staffSubject')
  })

  return c.json({
    enabled: body.enabled,
    // False means SHOPLINE did not accept the change, so the storefront may still be doing the
    // opposite of what the merchant just asked for. Never reported as success.
    pushed: result.pushed,
    ...(result.pushed ? {} : { error: result.error, reason: result.reason })
  })
})

/** Retries a settings push that failed, without changing the merchant's intent. */
settings.post('/api/settings/retry-push', requireSession, async (c) => {
  const db = c.get('db')
  const handle = c.get('handle')
  const enabled = (await findPixelState(db, handle))?.trackingEnabled ?? true
  const result = await pushSettings(db, c.get('config'), handle, enabled)

  return c.json({ enabled, pushed: result.pushed, ...(result.pushed ? {} : { error: result.error, reason: result.reason }) })
})

/**
 * Forgets the chosen site so the merchant can pick another.
 *
 * Tracking is switched off first, while the old selection still exists to push against. Otherwise
 * the storefront would keep sending to the previous site until a new one is chosen — and if the
 * merchant walked away mid-change, indefinitely.
 */
settings.post('/api/settings/change-site', requireSession, async (c) => {
  const db = c.get('db')
  const config = c.get('config')
  const handle = c.get('handle')

  const stopped = await setTrackingEnabled(db, config, { handle, enabled: false, actor: c.get('staffSubject') })
  await clearSelection(db, handle)

  return c.json({ cleared: true, trackingStopped: stopped.pushed, ...(stopped.pushed ? {} : { warning: stopped.error }) })
})

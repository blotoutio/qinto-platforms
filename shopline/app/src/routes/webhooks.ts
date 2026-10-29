import { Hono } from 'hono'

import { deleteConnection } from '../blotout/connection-store'
import { isValidHandle } from '../config'
import { findStore, markUninstalled, upsertPixelState } from '../db/queries/stores'
import type { AppEnv } from '../http/context'
import { verifyWebhookSignature } from '../shopline/crypto'
import { deleteSession } from '../shopline/session-store'

export const webhooks = new Hono<AppEnv>()

const HMAC_HEADER = 'X-Shopline-Hmac-Sha256'
const TOPIC_HEADER = 'X-Shopline-Topic'

export const INSTALL_TOPIC = 'apps/installed_uninstalled'

type InstallStatusBody = {
  handle?: string
  /** `INSTALL` or `UNINSTALL`. The topic covers both, so acting without reading it wipes a fresh install. */
  operate?: string
}

/**
 * Handles the uninstall.
 *
 * Order matters. The Blotout grant and the SHOPLINE session go first, then the store is marked
 * uninstalled. `pixel_state` is neutralized before all of that so a reinstall cannot resume tracking
 * against a stale selection before the merchant has confirmed it — we cannot push `enabled=false` to
 * SHOPLINE here, because the token that would take is the one the uninstall just revoked.
 */
const onUninstall = async (db: AppEnv['Variables']['db'], handle: string): Promise<void> => {
  // A store we have no row for has nothing to clean up, and `pixel_state.handle` is a foreign key
  // — writing it blind would throw, and SHOPLINE would redeliver the webhook indefinitely.
  if ((await findStore(db, handle)) === undefined) {
    return
  }

  await upsertPixelState(db, handle, {
    trackingEnabled: false,
    pushedEnabled: null,
    disabledAt: new Date(),
    disabledBy: 'uninstall'
  })
  await deleteConnection(db, handle)
  await deleteSession(db, handle)
  await markUninstalled(db, handle)
}

webhooks.post('/api/webhooks', async (c) => {
  const config = c.get('config')
  const rawBody = await c.req.text()
  const hmac = c.req.header(HMAC_HEADER)
  const topic = c.req.header(TOPIC_HEADER)

  if (hmac === undefined || topic === undefined) {
    return c.json({ error: 'missing_headers' }, 401)
  }

  if (!(await verifyWebhookSignature(config.appSecret, rawBody, hmac))) {
    return c.json({ error: 'invalid_hmac' }, 401)
  }

  const body = JSON.parse(rawBody) as InstallStatusBody
  const db = c.get('db')

  switch (topic) {
    case INSTALL_TOPIC: {
      if (!isValidHandle(body.handle)) {
        return c.json({ error: 'missing_handle' }, 400)
      }

      if (body.operate === 'UNINSTALL') {
        await onUninstall(db, body.handle)
        break
      }

      // INSTALL carries nothing the OAuth callback did not already record from `merchants/shop.json`,
      // and this webhook can arrive before it. Writing here would overwrite good facts with a
      // subset of them.
      break
    }

    // GDPR topics SHOPLINE may call. We store no customer data, so acknowledging is the whole job.
    case 'customers/redact':
    case 'customers/data_request':
    case 'merchants/redact': {
      break
    }

    default: {
      console.warn('unhandled webhook topic', { topic })
      break
    }
  }

  return c.json({ ok: true })
})

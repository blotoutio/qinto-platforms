import type { AppConfig } from '../config'
import { API_VERSION } from '../config'
import { adminApi } from './admin-api'
import type { StoreSession } from './session-store'

/**
 * The only topic we subscribe to.
 *
 * `apps/installed_uninstalled` fires for both operations and carries `operate`, so it is one
 * subscription rather than two. The GDPR topics are configured in the Partner Portal, not here.
 */
export const SUBSCRIBED_TOPICS = ['apps/installed_uninstalled'] as const

/**
 * Subscribes the store's webhooks.
 *
 * Re-subscribing an existing topic is how SHOPLINE expresses "update the address", so this runs on
 * every install and every reinstall without a prior list-and-diff. A failure is logged and
 * swallowed: the install is already valid, and a missing uninstall webhook costs us a stale row,
 * not a broken app.
 */
export const registerWebhooks = async (config: AppConfig, session: StoreSession, callbackUrl: string): Promise<void> => {
  for (const topic of SUBSCRIBED_TOPICS) {
    try {
      await adminApi(config, session, 'webhooks.json', {
        method: 'POST',
        body: { webhook: { topic, address: callbackUrl, api_version: API_VERSION } }
      })
    } catch (error) {
      console.warn('webhook subscription failed', { handle: session.handle, topic, error: String(error) })
    }
  }
}

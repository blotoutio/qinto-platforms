import type { AppConfig } from '../config'
import type { Db } from '../db/client'
import { findSelection, upsertPixelState } from '../db/queries/stores'
import type { PushFailureReason } from '../db/schema'
import { AdminApiError, pushPixelSettings } from '../shopline/admin-api'
import { loadSession } from '../shopline/session-store'

export type PushResult = { pushed: true } | { pushed: false; error: string; reason: PushFailureReason }

/**
 * What kind of failure this is, decided from what SHOPLINE actually said.
 *
 * The body, not the status. `record not found` means the store has no pixel record for this app,
 * which is the case until the pixel extension has a published version — and SHOPLINE returns it
 * as a **500**, indistinguishable by status from a real fault. A screen that cannot tell them apart
 * either offers a retry that can never succeed or hides one that would have worked.
 */
const classifyPushFailure = (error: unknown): PushFailureReason => {
  if (!(error instanceof AdminApiError)) {
    return 'unknown'
  }

  if (error.status === 401 || error.status === 403) {
    return 'forbidden'
  }

  return error.body.includes('record not found') ? 'extension_not_published' : 'unknown'
}

/**
 * Pushes the pixel's settings to SHOPLINE and records what happened.
 *
 * `pushedEnabled` is only written on success. That is the whole point of having two flags: on
 * failure the merchant's intent is stored but the app still reports what SHOPLINE last accepted, so
 * the UI can say "you turned this off, but the push failed and it may still be sending" instead of
 * quietly claiming tracking has stopped.
 */
export const pushSettings = async (db: Db, config: AppConfig, handle: string, enabled: boolean): Promise<PushResult> => {
  const selection = await findSelection(db, handle)
  if (selection === undefined) {
    return { pushed: false, error: 'no site is selected', reason: 'no_selection' }
  }

  try {
    const session = await loadSession(db, config, handle)
    await pushPixelSettings(config, session, { destination: selection.deliveryHost, enabled })
    await upsertPixelState(db, handle, {
      destination: selection.deliveryHost,
      pushedEnabled: enabled,
      settingsPushedAt: new Date(),
      lastPushError: null,
      lastPushReason: null
    })

    return { pushed: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const reason = classifyPushFailure(error)
    await upsertPixelState(db, handle, { lastPushError: message, lastPushReason: reason })
    // The body, not just the status: SHOPLINE puts the reason there, and the status alone cannot
    // tell a missing scope from a rejected payload. Interpolated because `wrangler dev` truncates a
    // logged object. It stays out of the response — see `AdminApiError`.
    const detail = error instanceof AdminApiError ? ` body=${error.body}` : ''
    console.error(`pixel settings push failed for ${handle} (enabled=${enabled}, reason=${reason}): ${message}${detail}`)

    return { pushed: false, error: message, reason }
  }
}

/**
 * Applies the merchant's tracking intent, then tries to make SHOPLINE agree.
 *
 * The intent is recorded first and unconditionally. A merchant who turns tracking off has said so
 * whether or not the push lands, and losing that on a network error would be the worse failure.
 */
export type TrackingIntent = {
  handle: string
  enabled: boolean
  /** The SHOPLINE staff subject from the session token, recorded so the change is traceable. */
  actor: string
}

export const setTrackingEnabled = async (db: Db, config: AppConfig, intent: TrackingIntent): Promise<PushResult> => {
  const { handle, enabled, actor } = intent
  await upsertPixelState(db, handle, {
    trackingEnabled: enabled,
    ...(enabled ? { disabledAt: null, disabledBy: null } : { disabledAt: new Date(), disabledBy: actor })
  })

  return pushSettings(db, config, handle, enabled)
}

/**
 * Whether events are actually reaching Blotout right now.
 *
 * All five have to hold: a site is chosen, Blotout is serving it, its hostname resolves, the merchant
 * has not switched tracking off, and SHOPLINE accepted that. `deliveryLive` and `dnsValid` are read
 * from Blotout rather than stored, so the caller supplies them.
 *
 * `dnsValid` is the one that is easy to leave out and must not be. Blotout reports a site as serving
 * the moment it is deployed, before the merchant has added the CNAME — so without this, the app
 * calls a store live while its delivery host does not resolve and every event dies in the browser.
 * `null` means the question does not apply (a development URL) or could not be read, and neither is
 * grounds for claiming a store is down.
 */
export const trackingIsLive = (input: {
  hasSelection: boolean
  deliveryLive: boolean
  dnsValid: boolean | null
  trackingEnabled: boolean
  pushedEnabled: boolean | null
}): boolean => {
  return input.hasSelection && input.deliveryLive && input.dnsValid !== false && input.trackingEnabled && input.pushedEnabled === true
}

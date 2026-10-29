import type { BlotoutSocket } from './blotout-socket'
import type { BlotoutTraits } from './mapping'
import { identifierFor } from './mapping'

/**
 * Identity, sent once per session rather than once per event.
 *
 * A signed-in visitor carries the same `login_em` and `customer_id` on every event, so identity used
 * to ride all of them — several identical frames per page, on every storefront page.
 *
 * "Once" is per **session**, not per page load: what has already been sent lives in the storefront's
 * `sessionStorage`, the same store and therefore the same lifetime as the session id itself. It is
 * stamped with that session id, so a session that ages out (30 minutes, `session.ts`) re-asserts
 * identity rather than inheriting a stale claim — the session is the unit of attribution, so it is
 * the right thing to tie this to.
 *
 * The cost of the choice, said out loud: a frame lost between here and the edge is not re-sent for
 * the rest of the session. That is the trade accepted in exchange for the frames saved.
 */

type StorageProxy = {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<unknown>
}

const KEY = 'blotout_shopline_identity'

export type SentIdentity = { sessionId: string; traits: BlotoutTraits }

/**
 * What this session has already told Blotout, or null.
 *
 * Read at startup, in parallel with the session, so subscribing is not delayed by a second await.
 * Every failure path returns null: a storefront that blocks storage should still send identity, just
 * more often than it strictly needs to.
 */
export const readSentIdentity = async (storage: StorageProxy): Promise<SentIdentity | null> => {
  const raw = await storage.getItem(KEY).catch(() => null)

  let parsed: unknown
  try {
    parsed = raw === null ? null : JSON.parse(raw)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null
  }

  const candidate = parsed as Record<string, unknown>
  const traits = candidate['traits']
  if (typeof candidate['sessionId'] !== 'string' || typeof traits !== 'object' || traits === null) {
    return null
  }

  return { sessionId: candidate['sessionId'], traits: traits as BlotoutTraits }
}

/** The traits already sent, but only if they belong to the session now running. */
export const knownIdentity = (stored: SentIdentity | null, sessionId: string): BlotoutTraits => {
  return stored !== null && stored.sessionId === sessionId ? stored.traits : {}
}

export type SendIdentity = (traits: BlotoutTraits) => void

/**
 * Sends identity when it has something new to say, and never twice for the same thing.
 *
 * "Something new" is per trait, not per object. The checkout steps and the order carry a richer set
 * (phone, name, address) and must get through; the plain `{email, customerId}` that shares the
 * thank-you page with the order's own identity adds nothing and must not. Comparing whole objects
 * would send that one and overwrite a rich identity with a poor one.
 *
 * Skipped entirely when SHOPLINE supplied no traits — an identify with no traits and no id tells the
 * graph nothing. Traits are still sent without an identifier: they attach to the anonymous profile,
 * which is where they belong until the visitor signs in.
 */
export const identitySender = (options: {
  blotout: BlotoutSocket
  sessionId: string
  known: BlotoutTraits
  storage?: StorageProxy
}): SendIdentity => {
  let sent: BlotoutTraits = { ...options.known }

  return (traits: BlotoutTraits) => {
    const keys = Object.keys(traits)
    if (keys.length === 0 || keys.every((key) => sent[key] === traits[key])) {
      return
    }

    sent = { ...sent, ...traits }
    options.blotout.identify(traits, identifierFor(traits))

    // Fire and forget. A storefront that refuses the write simply sends identity again next page.
    void options.storage?.setItem(KEY, JSON.stringify({ sessionId: options.sessionId, traits: sent })).catch(() => undefined)
  }
}

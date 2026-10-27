"use client"

import type { Properties, Traits } from "./mapping"

/**
 * The only module that talks to the Qinto browser runtime.
 *
 * Qinto's runtime is `q.js`, loaded by the site's own snippet, which exposes `window.qinto`.
 *
 * Two rules hold everywhere here:
 *
 * 1. **Nothing throws at the caller.** A tracking failure must never break a storefront.
 * 2. **Unconfigured is a no-op.** A store whose backend has not been connected to Qinto yet must
 *    run exactly as before.
 */

/**
 * Set once by the loader, from whatever the backend reports.
 *
 * Deliberately not read from `process.env` here: the backend is the source of truth, so a merchant
 * who connects or switches site in the admin does not also have to edit a storefront env file and
 * redeploy. `NEXT_PUBLIC_QINTO_URL` still wins if it is set, for anyone who wants to pin it.
 */
let qintoUrl: string | null = process.env.NEXT_PUBLIC_QINTO_URL || null

export const setQintoUrl = (url: string | null): void => {
  qintoUrl = url
}

export const getQintoUrl = (): string | null => qintoUrl

type QintoRuntime = {
  track: (
    event: string,
    properties?: Properties,
    options?: { eventId?: string }
  ) => Promise<{ eventId: string }>
  identify: (traits: Record<string, unknown>, id?: string) => Promise<unknown>
  getAnonId: () => Promise<string | null>
}

const runtime = (): QintoRuntime | null => {
  if (typeof window === "undefined") {
    return null
  }

  return (window as unknown as { qinto?: QintoRuntime }).qinto ?? null
}

/**
 * Events fired before the runtime exists.
 *
 * The loader is injected only after an async read of `/store/qinto/config`, but capture fires from
 * a mount effect — so on a first page load the two race, and the event usually loses. Without this,
 * the most valuable events in the funnel (ViewContent, InitiateCheckout, Purchase) are silently
 * dropped on exactly the page load that matters most.
 *
 * The snippet's own Proxy queues calls made after it runs; this covers the window *before* that.
 */
type Pending =
  | { kind: "track"; name: string; properties?: Properties }
  | { kind: "identify"; traits: Traits; id?: string }

const pending: Pending[] = []

// Dropping the oldest keeps the most recent behaviour, which is the more useful half if the
// runtime never arrives at all.
const MAX_PENDING = 50

let flushTimer: ReturnType<typeof setInterval> | null = null

const flush = (): void => {
  const q = runtime()
  if (q === null) {
    return
  }

  if (flushTimer !== null) {
    clearInterval(flushTimer)
    flushTimer = null
  }

  while (pending.length > 0) {
    const item = pending.shift() as Pending
    if (item.kind === "track") {
      send(q, item.name, item.properties)
    } else {
      sendIdentify(q, item.traits, item.id)
    }
  }
}

/**
 * Waits for the runtime, then drains the queue.
 *
 * Polling rather than a callback because the loader is injected by a different module and the
 * runtime replaces `window.qinto` wholesale when `q.js` arrives — there is nothing to subscribe to.
 * It gives up after a few seconds so a store with tracking disabled does not poll forever.
 */
const scheduleFlush = (): void => {
  if (flushTimer !== null || runtime() !== null) {
    flush()

    return
  }

  let attempts = 0
  flushTimer = setInterval(() => {
    attempts += 1
    if (runtime() !== null) {
      flush()

      return
    }

    if (attempts > 100) {
      if (flushTimer !== null) {
        clearInterval(flushTimer)
        flushTimer = null
      }
      pending.length = 0
    }
  }, 100)
}

const enqueue = (item: Pending): void => {
  if (pending.length >= MAX_PENDING) {
    pending.shift()
  }

  pending.push(item)
  scheduleFlush()
}

const send = (q: QintoRuntime, name: string, properties?: Properties): void => {
  try {
    q.track(name, properties).catch((error) => report(`track ${name}`, error))
  } catch (error) {
    report(`track ${name} threw`, error)
  }
}

const sendIdentify = (q: QintoRuntime, traits: Traits, id?: string): void => {
  try {
    q.identify(traits, id).catch((error) => report("identify", error))
  } catch (error) {
    report("identify threw", error)
  }
}

const report = (what: string, error: unknown): void => {
  // Said out loud rather than swallowed: a silent tracking failure looks exactly like a store with
  // no traffic, which is the hardest version of this to debug.
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[qinto] ${what}:`, error)
  }
}

/**
 * Sends a standard event.
 *
 * `eventId` is left to the runtime on purpose: `q.js` derives it from `properties.orderId` when
 * that is a non-empty string, so a Purchase deduplicates against the copy the backend sends
 * without this passing anything.
 */
export const track = (name: string, properties?: Properties): void => {
  const q = runtime()
  if (q === null) {
    enqueue({ kind: "track", name, properties })

    return
  }

  send(q, name, properties)
}

/** Attaches identity traits. Skipped when there is nothing to say. */
export const identify = (traits: Traits, id?: string): void => {
  if (Object.keys(traits).length === 0) {
    return
  }

  const q = runtime()
  if (q === null) {
    enqueue({ kind: "identify", traits, id })

    return
  }

  sendIdentify(q, traits, id)
}

/**
 * This visitor's Qinto anonymous id, or null.
 *
 * Exposed for a storefront that wants to stamp it onto the cart so it reaches `order.metadata` as
 * a join key for its own reporting. Nothing in this plugin consumes it: Qinto already learns the
 * link between visitor and order from the browser's own Purchase, which carries both ids.
 */
export const anonId = async (): Promise<string | null> => {
  // Same race as above: checkout mounts before the loader is injected, and returning null here
  // would mean the cart never gets an id at all.
  let q = runtime()
  for (let attempt = 0; q === null && attempt < 100; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    q = runtime()
  }

  if (q === null) {
    return null
  }

  try {
    const id = await q.getAnonId()

    return typeof id === "string" && id !== "" ? id : null
  } catch (error) {
    report("getAnonId", error)

    return null
  }
}

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
  // The runtime also accepts `identify(traits, id)` as shorthand for identify-then-alias. It is
  // deliberately not used: this module sequences the alias itself, so it can wait for the identify
  // to land and skip the link when it did not. See `sendIdentify`.
  identify: (traits: Record<string, unknown>) => Promise<unknown>
  alias: (id: string) => Promise<unknown>
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
 *
 * An identify carries its aliases with it rather than queueing them as separate entries. They
 * must run *after* the identify has resolved, and two independent entries would only guarantee the
 * order the calls were made in, not that the first had finished — nor would they survive the oldest
 * entry being dropped at `MAX_PENDING` without leaving an orphaned alias behind.
 */
type Pending =
  | { kind: "track"; name: string; properties?: Properties }
  | { kind: "identify"; traits: Traits; aliases: string[] }

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
      sendIdentify(q, item.traits, item.aliases)
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

/**
 * Identifies, then links each alias — in that order, and only once the identify has landed.
 *
 * **Why wait.** An alias that reaches Qinto before the traits it belongs with can arrive as a
 * conflict against the profile the identify is about to create, so each step awaits the previous
 * one. The aliases are chained one after another for the same reason.
 *
 * **Why skip on failure.** When the identify rejects, its aliases are dropped rather than sent
 * anyway. An alias is a permanent link between this browser and a person, so sending it without
 * knowing the traits arrived trades a missed link (recoverable on the next verified login or order)
 * for a possibly wrong or conflicting one (not recoverable). A rejected *alias* does not stop the
 * ones after it: each is an independent link, already vouched for by the same verified identity.
 */
const sendIdentify = (q: QintoRuntime, traits: Traits, aliases: string[]): void => {
  try {
    q.identify(traits).then(
      () =>
        aliases.reduce<Promise<void>>(
          (previous, id) => previous.then(() => sendAlias(q, id)),
          Promise.resolve()
        ),
      (error) => report("identify", error)
    )
  } catch (error) {
    report("identify threw", error)
  }
}

/** One alias, never rejecting — failures are reported here so the chain above keeps going. */
const sendAlias = async (q: QintoRuntime, id: string): Promise<void> => {
  try {
    await q.alias(id)
  } catch (error) {
    report("alias", error)
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
 * that is a non-empty string, so a reloaded confirmation page or any duplicate send of the same
 * Purchase carries the same event id and is deduplicated, without this passing anything.
 */
export const track = (name: string, properties?: Properties): void => {
  const q = runtime()
  if (q === null) {
    enqueue({ kind: "track", name, properties })

    return
  }

  send(q, name, properties)
}

/**
 * Attaches identity traits, and optionally links this browser to a person. Skipped when there are
 * no traits — aliases included, since every caller's alias is also one of its traits.
 *
 * Traits alone are cheap and safe to send from anything, including a form field the shopper has
 * not submitted successfully yet. **`alias` is not.** It links the browser to a person profile
 * permanently, so pass it only for an identity something has verified: a customer Medusa resolved
 * from the session, or the email on a placed order. Never for a value read from a form, because the
 * submit may fail and the address may be mistyped or someone else's.
 *
 * Aliases are sent in the order given, each after the identify (and the alias before it) resolves —
 * see `sendIdentify`. Blank and repeated values are dropped.
 */
export const identify = (traits: Traits, options: { alias?: (string | null | undefined)[] } = {}): void => {
  if (Object.keys(traits).length === 0) {
    return
  }

  const aliases = Array.from(
    new Set(
      (options.alias ?? [])
        .filter((id): id is string => typeof id === "string")
        .map((id) => id.trim())
        .filter((id) => id !== "")
    )
  )

  const q = runtime()
  if (q === null) {
    enqueue({ kind: "identify", traits, aliases })

    return
  }

  sendIdentify(q, traits, aliases)
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

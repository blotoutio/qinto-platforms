/**
 * A Blotout client for the SHOPLINE pixel sandbox.
 *
 * `@blotout/blotout-sdk-browser` cannot run here. It throws `BlotoutEnvironmentError` outside a browser
 * environment, claims `window.blotout`, reads `document.cookie` / `document.referrer` /
 * `window.location` / `window.sessionStorage`, and injects a `<script>` tag to load
 * `<destination>/q.js`. The strict sandbox has no DOM at all, so every one of those fails.
 *
 * What it needs instead is small: `wss://<host>/open` and one JSON frame per action, which is the
 * same protocol the SDK speaks underneath.
 */

export type ConsentCategories = {
  necessary?: true
  functional?: boolean
  analytics?: boolean
  marketing?: boolean
  salesOfData?: boolean
}

export type PageContext = { url: string; referrer?: string }

export type SessionContext = { id: string; isNew: boolean; startedAt: number }

type Frame =
  | { t: 'track'; ref: string; event: string; eventId: string; properties?: Record<string, unknown>; context: WireContext }
  | { t: 'identify'; ref: string; id?: string; traits?: Record<string, unknown>; context: WireContext }
  | { t: 'consent'; ref: string; categories?: ConsentCategories; context: WireContext }

type WireContext = { occurredAt: number; page: PageContext; session: SessionContext }

export type BlotoutSocketOptions = {
  /** Host only, no scheme — `q.shop.example.com`. */
  destination: string
  page: PageContext
  session: SessionContext
  /** Called for anything that goes wrong. Never throws into a SHOPLINE event handler. */
  onError?: (message: string) => void
}

export type BlotoutSocket = {
  track: (event: string, properties?: Record<string, unknown>, eventId?: string) => void
  identify: (traits: Record<string, unknown>, id?: string | null) => void
  consent: (categories: ConsentCategories) => void
  /**
   * Repoints the page context at the URL the shopper is now on.
   *
   * `api.init.context` is a snapshot taken when the sandbox started, so on a storefront that
   * rewrites the URL without a reload — SHOPLINE's own variant picker does — every frame after the
   * first would otherwise carry the URL the visitor landed on. The referrer is kept: it is the
   * session's referrer, and a same-page rewrite did not replace it.
   */
  setUrl: (url: string) => void
  close: () => void
}

// Frames sent before the socket opens are queued. A storefront can fire `page_viewed` and
// `product_viewed` within milliseconds of the sandbox starting, well before the handshake finishes.
const MAX_QUEUE = 50

const RECONNECT_BASE_MS = 500
const RECONNECT_MAX_MS = 30_000
const MAX_RECONNECTS = 5

/**
 * Opens the connection and returns a client that never throws at its caller.
 *
 * A tracking failure must not break a storefront. Every path here either queues, drops, or reports
 * through `onError`; nothing propagates into the SHOPLINE event handler that called it.
 */
export const openBlotoutSocket = (options: BlotoutSocketOptions): BlotoutSocket => {
  const url = `wss://${options.destination.replace(/^wss?:\/\//, '').replace(/\/+$/, '')}/open`
  const report = options.onError ?? (() => undefined)

  let socket: WebSocket | null = null
  let queue: string[] = []
  let refCounter = 0
  let attempts = 0
  let closed = false
  let session = options.session
  let page = options.page

  /**
   * Sends as much of the queue as the socket will take, oldest first.
   *
   * Stops at the first failure and leaves the rest queued: a socket that just refused one frame
   * will refuse the next, and pushing on would reorder the batch. Ordering matters — an `identify`
   * that arrives after the `Purchase` it was meant to attribute is worse than a late one.
   */
  const flush = (): void => {
    const live = socket
    if (live === null || live.readyState !== WebSocket.OPEN) {
      return
    }

    while (queue.length > 0) {
      const payload = queue[0] as string
      try {
        live.send(payload)
      } catch (error) {
        report(`send failed: ${String(error)}`)

        return
      }

      queue.shift()
    }
  }

  const connect = (): void => {
    if (closed) {
      return
    }

    try {
      socket = new WebSocket(url)
    } catch (error) {
      report(`could not open ${url}: ${String(error)}`)

      return
    }

    socket.addEventListener('open', () => {
      attempts = 0
      flush()
    })

    socket.addEventListener('message', (event: MessageEvent) => {
      // Errors are the only reply worth acting on: an ack carries no work, and `sharedContext` and
      // `appPush` are for a page that renders app UI, which a pixel does not.
      if (typeof event.data !== 'string') {
        return
      }

      try {
        const frame = JSON.parse(event.data) as { t?: string; message?: string }
        if (frame.t === 'error') {
          report(`server rejected a frame: ${frame.message ?? 'no reason given'}`)
        }
      } catch {
        report('unparseable frame from the server')
      }
    })

    socket.addEventListener('close', () => {
      socket = null
      if (closed) {
        return
      }

      if (attempts >= MAX_RECONNECTS) {
        // Said out loud: without this a dead delivery host looks healthy from the storefront, and
        // every frame from here on is queued and eventually evicted with no signal at all.
        report(`gave up reconnecting to ${url} after ${MAX_RECONNECTS} attempts; ${queue.length} frame(s) undelivered`)

        return
      }

      // Jittered backoff, so a site-wide blip does not bring every open storefront back at once.
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempts, RECONNECT_MAX_MS)
      attempts += 1
      setTimeout(connect, delay / 2 + (delay / 2) * Math.random())
    })

    socket.addEventListener('error', () => {
      report(`websocket error against ${url}`)
    })
  }

  const context = (): WireContext => {
    const wire = { occurredAt: Date.now(), page, session }
    // `isNew` is true exactly once per session, on the first frame that carries it.
    session = { ...session, isNew: false }

    return wire
  }

  /**
   * Queues a frame, then sends whatever the socket will take.
   *
   * Everything goes through the queue, even when the socket is already open. Sending directly would
   * mean a frame that fails has to be pushed back, and a frame pushed back behind newer ones
   * arrives out of order.
   */
  const send = (frame: Frame): void => {
    if (queue.length >= MAX_QUEUE) {
      // Dropping the oldest keeps the most recent behaviour, which is the more useful half when a
      // connection never comes back.
      queue.shift()
      report('queue full, dropped the oldest frame')
    }

    queue.push(JSON.stringify(frame))
    flush()
  }

  const nextRef = (): string => {
    refCounter += 1

    return String(refCounter)
  }

  connect()

  return {
    track: (event, properties, eventId) => {
      send({
        t: 'track',
        ref: nextRef(),
        event,
        // The server requires one. Minting it here rather than server-side keeps a retry of the
        // same purchase deduplicating on the same id.
        eventId: eventId ?? `evt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        ...(properties === undefined || Object.keys(properties).length === 0 ? {} : { properties }),
        context: context()
      })
    },

    identify: (traits, id) => {
      send({
        t: 'identify',
        ref: nextRef(),
        ...(id === null || id === undefined || id === '' ? {} : { id }),
        ...(Object.keys(traits).length === 0 ? {} : { traits }),
        context: context()
      })
    },

    consent: (categories) => {
      send({ t: 'consent', ref: nextRef(), categories, context: context() })
    },

    setUrl: (url) => {
      page = { ...page, url }
    },

    close: () => {
      closed = true
      queue = []
      socket?.close()
      socket = null
    }
  }
}

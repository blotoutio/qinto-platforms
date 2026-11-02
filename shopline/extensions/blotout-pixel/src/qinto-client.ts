import * as qinto from '@blotout/qinto-sdk-browser'

import type { VisitorContext } from './visitor'
import { installWorkerShims } from './worker-shims'

/**
 * The pixel's Qinto client: `@blotout/qinto-sdk-browser`, run inside the SHOPLINE worker.
 *
 * The SDK owns the wire — the `/open` URL with `url`, `referrer`, `uid` and `session`, the frame
 * shape the edge validates, event ids, ordering and reconnects — so a protocol change reaches us as
 * an SDK upgrade instead of as frames the edge starts refusing. What this module adds is only what a
 * worker lacks: the shims (`worker-shims.ts`), the real page (`pageContext`, since the worker's own
 * location is a `blob:` URL) and the visitor from the previous page (`visitor.ts`).
 */

export type ConsentCategories = {
  necessary?: true
  functional?: boolean
  analytics?: boolean
  marketing?: boolean
  salesOfData?: boolean
}

export type PageContext = { url: string; referrer?: string }

export type BlotoutSocket = {
  track: (event: string, properties?: Record<string, unknown>, eventId?: string) => void
  identify: (traits: Record<string, unknown>, id?: string | null) => void
  consent: (categories: ConsentCategories) => void
  /**
   * Repoints the page at the URL the shopper is now on.
   *
   * `api.init.context` is a snapshot taken when the sandbox started, so on a storefront that rewrites
   * the URL without a reload — SHOPLINE's own variant picker does — every event after the first would
   * otherwise name the page the visitor landed on. The referrer is kept: a same-page rewrite did not
   * replace it.
   */
  setUrl: (url: string) => void
  close: () => void
}

type Sdk = Pick<typeof qinto, 'init' | 'track' | 'identify' | 'consent' | 'close'>

type ConnectTarget = Partial<Pick<EventTarget, 'addEventListener'>>

export type QintoClientOptions = {
  /** The Qinto host. A bare host gets `https://`; an explicit `http(s)://` origin is kept. */
  destination: string
  page: PageContext
  /** The visitor the edge reported on an earlier page, when there is one and it is still usable. */
  visitor?: VisitorContext | undefined
  /** Called with each `qinto:connect` detail, reconnects included. Returns the visitor to use next. */
  onConnect?: (detail: unknown) => VisitorContext | undefined
  /** Called for anything that goes wrong. Never throws into a SHOPLINE event handler. */
  onError?: (message: string) => void
  sdk?: Sdk
  /** Where the SDK dispatches `qinto:connect`: the worker's global scope, which the shim makes `window`. */
  events?: ConnectTarget
}

export const toOrigin = (destination: string): string => {
  const trimmed = destination.trim().replace(/\/+$/, '')

  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed.replace(/^wss?:\/\//, '')}`
}

const describe = (error: unknown): string => (error instanceof Error ? `${error.name}: ${error.message}` : String(error))

/**
 * Starts the SDK and returns a client that never throws at its caller.
 *
 * Calls made before the connection opens are buffered by the SDK, in order, so subscribing does not
 * wait for the handshake. A tracking failure must not break a storefront: every promise the SDK
 * returns is caught here and reported through `onError`.
 */
export const openQintoClient = (options: QintoClientOptions): BlotoutSocket => {
  const sdk = options.sdk ?? qinto
  const report = options.onError ?? (() => undefined)
  const failed =
    (what: string) =>
    (error: unknown): void => {
      report(`${what} failed: ${describe(error)}`)
    }

  let page = options.page
  let visitor = options.visitor

  const events = options.events ?? (globalThis as unknown as ConnectTarget)
  // Optional only because a test runner's global scope is not an EventTarget; a worker's always is.
  events.addEventListener?.('qinto:connect', (event) => {
    // A reconnect on this same page must continue the visit the edge just reported, not the one
    // read from storage at startup.
    visitor = options.onConnect?.((event as CustomEvent).detail) ?? visitor
  })

  installWorkerShims()

  sdk
    .init({
      destination: toOrigin(options.destination),
      pageContext: () => ({ ...page, ...(visitor === undefined ? {} : { visitor }) }),
      onError: (error) => {
        report(`connection: ${describe(error)}`)
      }
    })
    .catch(failed('init'))

  return {
    track: (event, properties, eventId) => {
      const payload = properties === undefined || Object.keys(properties).length === 0 ? undefined : properties
      sdk.track(event, payload, eventId === undefined ? undefined : { eventId }).catch(failed(event))
    },

    identify: (traits, id) => {
      sdk.identify(traits, id === null || id === undefined || id === '' ? undefined : id).catch(failed('identify'))
    },

    consent: (categories) => {
      sdk.consent({ categories }).catch(failed('consent'))
    },

    setUrl: (url) => {
      page = { ...page, url }
    },

    close: () => {
      sdk.close().catch(failed('close'))
    }
  }
}

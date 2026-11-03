/**
 * The globals `@blotout/qinto-sdk-browser` needs and a SHOPLINE app pixel does not have.
 *
 * An app pixel runs in a plain Web Worker (SHOPLINE's `wpm` starts it with `new Worker(blob)`), so
 * there is no `window` and no `document`. Measured against SDK 0.1.20 running inside SHOPLINE's own
 * unmodified `wpm`/`wpt` sandbox code:
 *
 * - no `document`: `init()` throws `QintoEnvironmentError` before opening anything;
 * - no `window`: the connect handler throws on `window.dispatchEvent`, after the socket is open;
 * - a `document` with no `cookie`: the capture step throws on `.split`;
 * - no `createElement`: the `q.js` `<script>` injection throws, the SDK logs
 *   `document.createElement is not a function`, and SHOPLINE reports it to `/capture/exception` on
 *   every page.
 *
 * `q.js` only carries the site's browser apps, which cannot run in a worker, so the stub `<script>`
 * reports itself loaded as soon as it is appended: `init()` goes straight on to connect with no apps,
 * which is what a worker gets anyway. Firing `onerror` instead would swap one logged error for another.
 *
 * Tied to the pinned SDK version. An upgrade is re-run in the worker sandbox before it lands, because
 * a release that reaches for one more DOM API fails here and nowhere else.
 */
type Scope = Record<string, unknown>

type StubScript = {
  async?: boolean
  src?: string
  dataset: Record<string, string>
  onload: (() => void) | null
  onerror: (() => void) | null
}

const createElement = (): StubScript => ({ dataset: {}, onload: null, onerror: null })

const head = {
  appendChild: <T>(node: T): T => {
    ;(node as Partial<StubScript>).onload?.()

    return node
  }
}

export const installWorkerShims = (scope: Scope = globalThis as unknown as Scope): void => {
  if (scope['window'] === undefined) {
    scope['window'] = scope
  }

  if (scope['document'] === undefined) {
    scope['document'] = {
      // Pinned visible: the SDK pauses reconnecting while a page is hidden, and a worker gets no
      // visibility events to resume it with.
      visibilityState: 'visible',
      cookie: '',
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      createElement,
      head
    }
  }
}

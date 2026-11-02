/**
 * The two globals `@blotout/qinto-sdk-browser` needs and a SHOPLINE app pixel does not have.
 *
 * An app pixel runs in a plain Web Worker (SHOPLINE's `wpm` starts it with `new Worker(blob)`), so
 * there is no `window` and no `document`. Measured against SDK 0.1.20 running inside SHOPLINE's own
 * unmodified `wpm`/`wpt` sandbox code, these are the only two it cannot do without:
 *
 * - no `document`: `init()` throws `QintoEnvironmentError` before opening anything;
 * - no `window`: the connect handler throws on `window.dispatchEvent`, after the socket is open;
 * - a `document` with no `cookie`: the capture step throws on `.split`.
 *
 * Everything else the SDK touches is already caught by the SDK itself: the `sessionStorage` reads,
 * and the `q.js` `<script>` injection, which fails without `createElement` and leaves the site's
 * browser apps off. They could not run in a worker anyway. The empty cookie only disables app
 * capture, which is driven by the `q.js` config and so never runs here either.
 *
 * Tied to the pinned SDK version. An upgrade is re-run in the worker sandbox before it lands, because
 * a release that reaches for one more DOM API fails here and nowhere else.
 */
type Scope = Record<string, unknown>

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
      removeEventListener: () => undefined
    }
  }
}

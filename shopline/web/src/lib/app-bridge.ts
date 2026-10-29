import Client, { Message, Modal, Redirect, shared } from '@shoplineos/app-bridge'
import type { transport } from '@shoplineos/app-bridge-types'

const search = new URLSearchParams(window.location.search)

/**
 * Whether the app can actually talk to the SHOPLINE Admin.
 *
 * Both halves matter. The Admin appends `lang` to the app URL, and App Bridge refuses to construct
 * outside an iframe — it throws `createApp must be called from within an iframe`. Checking only the
 * query parameter let that throw happen at module load, which killed the bundle before React could
 * render anything, so a merchant who opened the app URL directly saw a blank page.
 */
export const isEmbedded = (): boolean => {
  return search.has('lang') && window.top !== window.self
}

let client: transport | undefined

/**
 * The App Bridge client, created on first use.
 *
 * Lazily, deliberately: a module-level `createApp()` throws outside the Admin iframe and takes the
 * whole app down with it. Callers are all behind `isEmbedded`.
 *
 * `@shoplineos/app-bridge` 0.0.3, not `@shoplinedev/appbridge` — the latter's last release was
 * March 2024 and it has no `shared.authenticatedFetch`. Do not bring it back.
 *
 * The cast is upstream's bug, contained here: `createApp` returns `localOrigin?: string` while
 * every consumer declares `transport` with it required, so under `exactOptionalPropertyTypes` no
 * App Bridge call typechecks. One assertion at the boundary beats relaxing the flag for our code.
 */
export const bridge = (): transport => {
  client ??= Client.createApp({
    appKey: search.get('appkey') ?? (import.meta.env['VITE_APP_KEY'] as string | undefined) ?? '',
    host: shared.getHost()
  }) as unknown as transport

  return client
}

/** The store handle from the Admin's query, used only for display. */
export const storeHandle = (): string | null => search.get('handle')

export const toast = {
  success: (message: string): void => Message.create(bridge()).success(message),
  error: (message: string): void => Message.create(bridge()).error(message),
  info: (message: string): void => Message.create(bridge()).info(message)
}

/**
 * A confirmation the merchant cannot miss.
 *
 * Host chrome comes from App Bridge, never hand-rolled: a modal rendered inside our iframe would be
 * clipped by it and would not dim the Admin behind it.
 */
export const confirmDanger = (input: { title: string; content: string; onOk: () => Promise<void> | void }): void => {
  Modal.create(bridge()).open({ type: 'danger', title: input.title, content: input.content, onOk: input.onOk })
}

/**
 * Leaves the iframe for a top-level URL.
 *
 * Qinto's consent screen sets `frame-ancestors 'none'`, so opening it in place shows the merchant a
 * blank box. This is always a top-level navigation, never an in-app route.
 */
export const openTopLevel = (url: string): void => {
  Redirect.create(bridge()).replaceTo(url)
}

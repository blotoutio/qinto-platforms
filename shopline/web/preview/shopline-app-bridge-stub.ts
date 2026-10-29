/**
 * Stands in for the `@shoplineos/app-bridge` package in the local preview.
 *
 * `lib/api.ts` uses `shared.authenticatedFetch` and `Redirect` directly, so aliasing our own
 * wrapper is not enough — the package itself has to be replaced or every call hangs waiting for an
 * Admin that is not there.
 */
const noop = (): void => undefined

export const shared = {
  getHost: () => 'preview',
  authenticatedFetch: () => window.fetch.bind(window),
  getSessionToken: () => Promise.resolve('preview-token'),
  getAppState: () => Promise.resolve({})
}

export const Message = {
  create: () => ({
    open: (info: { messageInfo: string }) => console.info('[toast]', info.messageInfo),
    success: (message: string) => console.info('[toast success]', message),
    error: (message: string) => console.info('[toast error]', message),
    warn: (message: string) => console.info('[toast warn]', message),
    info: (message: string) => console.info('[toast info]', message)
  })
}

export const Modal = {
  create: () => ({
    open: (info: { title: string; onOk?: () => Promise<void> | void }) => {
      console.info('[confirm]', info.title)
      void info.onOk?.()
    },
    close: noop
  })
}

export const Redirect = {
  create: () => ({
    replaceTo: (url: string) => console.info('[top-level redirect]', url),
    routerTo: (url: string) => console.info('[router]', url)
  })
}

export default { createApp: () => ({ config: {}, localOrigin: 'preview' }) }

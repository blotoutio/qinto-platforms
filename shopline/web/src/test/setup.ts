import { vi } from 'vitest'

/**
 * Replaces App Bridge at the package boundary.
 *
 * The real thing talks to the SHOPLINE Admin over `postMessage`, and there is no Admin here.
 * Mocking the package rather than our own `lib/app-bridge` means the tests exercise our wrapper and
 * our `authenticatedFetch` plumbing for real — only the host is fake.
 *
 * `hostCalls` records what the app asked the host to do: a toast, a confirmation, a top-level
 * redirect. Those are the app's only outputs besides its DOM, so they are what the tests assert.
 */
export const hostCalls = {
  toasts: [] as { level: string; message: string }[],
  modals: [] as { type: string; title: string; content: string; onOk?: () => Promise<void> | void }[],
  redirects: [] as string[],
  reset(): void {
    hostCalls.toasts = []
    hostCalls.modals = []
    hostCalls.redirects = []
  },
  /** Runs the last confirmation's OK handler, as a merchant clicking through would. */
  async confirmLast(): Promise<void> {
    const modal = hostCalls.modals.at(-1)
    if (modal?.onOk === undefined) {
      throw new Error('no confirmation with an OK handler was opened')
    }

    await modal.onOk()
  }
}

const record = (level: string) => (message: string) => {
  hostCalls.toasts.push({ level, message })
}

vi.mock('@shoplineos/app-bridge', () => {
  const messageInstance = {
    open: (info: { messageInfo: string; type: string }) => hostCalls.toasts.push({ level: info.type, message: info.messageInfo }),
    success: record('success'),
    error: record('error'),
    warn: record('warn'),
    info: record('info')
  }

  return {
    default: { createApp: () => ({ config: { appKey: 'test' }, localOrigin: 'https://tunnel.example.com' }) },
    shared: {
      getHost: () => 'c3JpbmktdGVzdA==',
      // Not `authenticatedFetch`, so the SPA's own header assembly is what runs; the token is the
      // one thing the host would supply and the one thing faked.
      authenticatedFetch: () => globalThis.fetch,
      getSessionToken: () => Promise.resolve('session-token'),
      getAppState: () => Promise.resolve({})
    },
    Message: { create: () => messageInstance },
    Modal: {
      create: () => ({
        open: (info: { type: string; title: string; content: string; onOk?: () => Promise<void> | void }) => hostCalls.modals.push(info),
        close: () => undefined
      })
    },
    Redirect: {
      create: () => ({
        replaceTo: (url: string) => hostCalls.redirects.push(url),
        routerTo: (url: string) => hostCalls.redirects.push(url)
      })
    }
  }
})

// The Admin appends `lang`, which is half of how the SPA knows it is embedded.
window.history.replaceState({}, '', '/?handle=srini-test&lang=en&appkey=test')

// The other half: App Bridge only works inside an iframe, so the suite has to look framed or
// `isEmbedded()` is false and every screen renders the "open this from your Admin" message.
Object.defineProperty(window, 'top', { value: { name: 'shopline-admin' }, configurable: true })

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { FakeSocket, withFakeSocket } from './fake-socket'

/**
 * Drives `src/index.ts` — the sandbox entry point.
 *
 * The extension package's `configure` is just `self.configure`, so a fake put on the global before
 * the module is imported *is* the sandbox as far as this code can tell. That makes the kill switch
 * testable, and the kill switch is the one behaviour in this package whose whole guarantee lives in
 * a single `if`.
 */

type SandboxApi = {
  settings: Record<string, unknown>
  analytics: { subscribe: (name: string, callback: (event: unknown) => void) => unknown }
  browser: {
    cookie: { get: (name?: string) => Promise<string> }
    localStorage: { getItem: (key: string) => Promise<string | null> }
    sessionStorage: { getItem: (key: string) => Promise<string | null>; setItem: (key: string, value: string) => Promise<unknown> }
  }
  init: { context: { document: { referrer: string }; window: { location: { href: string } } } }
}

type Reads = { cookies: string[]; localStorage: string[]; sessionStorage: string[] }

const sandbox = (settings: Record<string, unknown>, options: { consent?: string; referrer?: string } = {}) => {
  const reads: Reads = { cookies: [], localStorage: [], sessionStorage: [] }
  const subscribed: string[] = []
  const store: Record<string, string> = {}

  const api: SandboxApi = {
    settings,
    analytics: {
      subscribe: (name) => {
        subscribed.push(name)

        return () => true
      }
    },
    browser: {
      cookie: {
        get: (name) => {
          reads.cookies.push(name ?? '')

          return Promise.resolve(options.consent ?? '')
        }
      },
      localStorage: {
        getItem: (key) => {
          reads.localStorage.push(key)

          return Promise.resolve(null)
        }
      },
      sessionStorage: {
        getItem: (key) => {
          reads.sessionStorage.push(key)

          return Promise.resolve(store[key] ?? null)
        },
        setItem: (key, value) => {
          store[key] = value

          return Promise.resolve(undefined)
        }
      }
    },
    init: {
      context: {
        document: { referrer: options.referrer ?? 'https://www.google.com/' },
        window: { location: { href: 'https://srini-test.myshopline.com/products/dress' } }
      }
    }
  }

  return { api, reads, subscribed }
}

type PixelCallback = (api: SandboxApi) => void | Promise<void>

let pixel: PixelCallback

/**
 * Imports the entry point once, with a fake `configure` in place, and keeps the callback it
 * registered.
 *
 * The module registers and returns; the callback is a pure function of the `api` it is handed, so
 * one import serves every test. Re-importing per test would need the module registry reset and
 * buys nothing.
 */
beforeAll(async () => {
  const register = (fn: PixelCallback) => {
    pixel = fn
  }

  // The package reads `self.configure` and writes `self.SHOPLINE_EXTENSION_BUILD_VERSION`, so the
  // sandbox's `self` has to exist before the import. Node has no `self`.
  ;(globalThis as { self?: unknown }).self = globalThis
  ;(globalThis as { configure?: unknown }).configure = register

  await import('../src/index')

  if (pixel === undefined) {
    throw new Error('src/index.ts did not call configure')
  }
})

const runPixel = (api: SandboxApi): Promise<void> => Promise.resolve(pixel(api))

let restore: () => void
let warnings: unknown[][]

beforeEach(() => {
  restore = withFakeSocket()
  warnings = []
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args)
  })
})

afterEach(() => {
  restore()
  vi.restoreAllMocks()
})

describe('the kill switch', () => {
  it.each([
    ['enabled is the string false', { destination: 'q.example.com', enabled: 'false' }],
    ['enabled is missing', { destination: 'q.example.com' }],
    ['enabled is the boolean true, which the sandbox never sends', { destination: 'q.example.com', enabled: true }],
    ['enabled is an empty string', { destination: 'q.example.com', enabled: '' }],
    ['enabled is anything else', { destination: 'q.example.com', enabled: 'yes' }]
  ])('does nothing at all when %s', async (_label, settings) => {
    const { api, reads, subscribed } = sandbox(settings)

    await runPixel(api)

    // The whole guarantee: no socket, no subscription, no cookie or storage read.
    expect(FakeSocket.instances).toHaveLength(0)
    expect(subscribed).toEqual([])
    expect(reads).toEqual({ cookies: [], localStorage: [], sessionStorage: [] })
  })

  it.each([
    ['the destination is missing', { enabled: 'true' }],
    ['the destination is empty', { destination: '', enabled: 'true' }],
    ['the destination is not a string', { destination: 42, enabled: 'true' }]
  ])('does nothing when %s, rather than opening a socket to nowhere', async (_label, settings) => {
    const { api, reads, subscribed } = sandbox(settings)

    await runPixel(api)

    expect(FakeSocket.instances).toHaveLength(0)
    expect(subscribed).toEqual([])
    expect(reads.cookies).toEqual([])
  })
})

describe('an enabled store', () => {
  const ENABLED = { destination: 'q.srini-shopline.com', enabled: 'true' }

  it('opens one socket to the configured destination', async () => {
    const { api } = sandbox(ENABLED)

    await runPixel(api)

    expect(FakeSocket.instances).toHaveLength(1)
    expect(FakeSocket.last?.url).toBe('wss://q.srini-shopline.com/open')
  })

  it('subscribes to every mapped event and the identity step', async () => {
    const { api, subscribed } = sandbox(ENABLED)

    await runPixel(api)

    expect(subscribed.sort()).toEqual(
      [
        'checkout_completed',
        'checkout_contact_info_submitted',
        'checkout_started',
        'lead',
        'page_viewed',
        'payment_info_submitted',
        'product_added_to_cart',
        'product_removed_from_cart',
        'product_viewed',
        'search_submitted'
      ].sort()
    )
  })

  it('reads the session from the storefront sessionStorage', async () => {
    const { api, reads } = sandbox(ENABLED)

    await runPixel(api)

    expect(reads.sessionStorage).toContain('blotout_shopline_session')
  })

  /** Frames are queued until the handshake finishes, so the socket has to be opened to read them. */
  const framesAfter = async (options: { consent?: string; referrer?: string } = {}) => {
    const { api, subscribed } = sandbox(ENABLED, options)
    await runPixel(api)
    FakeSocket.last?.open()

    return { frames: FakeSocket.last?.frames() ?? [], subscribed }
  }

  it('subscribes before it waits on consent, so the first page view is not lost', async () => {
    const { frames, subscribed } = await framesAfter({ consent: 'accepted' })

    // Both happened. The ordering is what the comment in index.ts is about: a regression would show
    // up as an empty `subscribed` while the consent read was still pending.
    expect(subscribed.length).toBeGreaterThan(0)
    expect(frames.some((frame) => frame['t'] === 'consent')).toBe(true)
  })

  it('sends the consent state it found', async () => {
    const { frames } = await framesAfter({ consent: 'accepted' })

    expect(frames.find((frame) => frame['t'] === 'consent')?.['categories']).toEqual({
      necessary: true,
      functional: true,
      analytics: true,
      marketing: true,
      salesOfData: true
    })
  })

  it('sends no consent frame when the storefront holds no state', async () => {
    const { frames } = await framesAfter()

    // Inventing a state would be worse than sending none: the edge acts on what it is told.
    expect(frames.some((frame) => frame['t'] === 'consent')).toBe(false)
  })

  it('takes the page URL from the sandbox context, not from a DOM it does not have', async () => {
    const { frames } = await framesAfter({ consent: 'accepted' })
    const context = frames.find((frame) => frame['t'] === 'consent')?.['context'] as { page: Record<string, unknown> }

    expect(context.page).toEqual({
      url: 'https://srini-test.myshopline.com/products/dress',
      referrer: 'https://www.google.com/'
    })
  })

  it('omits the referrer when the storefront reports none', async () => {
    const { frames } = await framesAfter({ consent: 'accepted', referrer: '' })
    const context = frames.find((frame) => frame['t'] === 'consent')?.['context'] as { page: Record<string, unknown> }

    expect(context.page).toEqual({ url: 'https://srini-test.myshopline.com/products/dress' })
  })

  it('reports a socket failure to the storefront console rather than throwing', async () => {
    FakeSocket.failConstruction = true
    const { api } = sandbox(ENABLED)

    await expect(runPixel(api)).resolves.toBeUndefined()
    expect(warnings.some((args) => String(args[0]).includes('[blotout]'))).toBe(true)
  })
})

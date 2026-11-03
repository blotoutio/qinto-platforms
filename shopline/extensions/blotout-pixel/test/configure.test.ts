import { close } from '@blotout/qinto-sdk-browser'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ANON_ID, FakeEdgeSocket, VISIT, withFakeEdge } from './fake-edge'

/**
 * Drives `src/index.ts` — the sandbox entry point — with the real Qinto SDK underneath.
 *
 * The extension package's `configure` is just `self.configure`, so a fake put on the global before
 * the module is imported *is* the sandbox as far as this code can tell. Only the socket is fake,
 * which makes these the contract tests: the frames read here are the ones the SDK really builds,
 * checked against the edge's strict schema.
 */

type Store = Record<string, string>

type SandboxApi = {
  settings: Record<string, unknown>
  analytics: { subscribe: (name: string, callback: (event: unknown) => void) => unknown }
  browser: {
    cookie: { get: (name?: string) => Promise<string> }
    localStorage: { getItem: (key: string) => Promise<string | null>; setItem: (key: string, value: string) => Promise<unknown> }
    sessionStorage: { getItem: (key: string) => Promise<string | null>; setItem: (key: string, value: string) => Promise<unknown> }
  }
  init: { context: { document: { referrer: string }; window: { location: { href: string } } } }
}

type Reads = { cookies: string[]; localStorage: string[]; sessionStorage: string[] }

const PAGE_URL = 'https://srini-test.myshopline.com/products/dress'

const sandbox = (
  settings: Record<string, unknown>,
  options: { consent?: string; referrer?: string; local?: Store; session?: Store } = {}
) => {
  const reads: Reads = { cookies: [], localStorage: [], sessionStorage: [] }
  const handlers = new Map<string, (event: unknown) => void>()
  const local = options.local ?? {}
  const session = options.session ?? {}

  const storage = (store: Store, log: string[]) => ({
    getItem: (key: string) => {
      log.push(key)

      return Promise.resolve(store[key] ?? null)
    },
    setItem: (key: string, value: string) => {
      store[key] = value

      return Promise.resolve(undefined)
    }
  })

  const api: SandboxApi = {
    settings,
    analytics: {
      subscribe: (name, callback) => {
        handlers.set(name, callback)

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
      localStorage: storage(local, reads.localStorage),
      sessionStorage: storage(session, reads.sessionStorage)
    },
    init: {
      context: {
        document: { referrer: options.referrer ?? 'https://www.google.com/' },
        window: { location: { href: PAGE_URL } }
      }
    }
  }

  const fire = (name: string, data: unknown): void => {
    handlers.get(name)?.({ clientId: 'sl-client-1', id: 'sl-event-1', timestamp: '1700000000000', name, data })
  }

  return { api, reads, local, session, fire, subscribed: () => [...handlers.keys()] }
}

type PixelCallback = (api: SandboxApi) => void | Promise<void>

let pixel: PixelCallback

/** The worker's global scope: `self`, and the EventTarget methods the SDK dispatches `qinto:connect` on. */
const scope = globalThis as Record<string, unknown>
const workerEvents = new EventTarget()

beforeAll(async () => {
  const register = (fn: PixelCallback) => {
    pixel = fn
  }

  scope['self'] = globalThis
  scope['configure'] = register
  scope['addEventListener'] = workerEvents.addEventListener.bind(workerEvents)
  scope['removeEventListener'] = workerEvents.removeEventListener.bind(workerEvents)
  scope['dispatchEvent'] = workerEvents.dispatchEvent.bind(workerEvents)

  await import('../src/index')

  if (pixel === undefined) {
    throw new Error('src/index.ts did not call configure')
  }
})

/**
 * What a real page load discards and a test has to: the instance on `window.qinto`, and the SDK's
 * page-wide gate that queues one connect behind another (`Symbol.for('qinto.connectGate')`). A page
 * left mid-handshake would otherwise hold the next page's connect forever.
 */
const leavePage = (): void => {
  // Not awaited: on an instance that never connected, close waits on a handshake that never comes.
  void close().catch(() => undefined)
  delete scope['qinto']
  delete (globalThis as Record<symbol, unknown>)[Symbol.for('qinto.connectGate')]
}

/** Lets the SDK's promise chain run: the `q.js` attempt, then the socket. */
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 5; turn += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

/** One page load: the pixel starts, the SDK opens its socket, the edge accepts it. */
const loadPage = async (api: SandboxApi, accept = true): Promise<FakeEdgeSocket | undefined> => {
  await pixel(api)
  await settle()
  const socket = FakeEdgeSocket.last
  if (accept) {
    socket?.accept()
    await settle()
  }

  return socket
}

let restore: () => void
let warnings: unknown[][]
let errors: unknown[][]

beforeEach(() => {
  restore = withFakeEdge()
  warnings = []
  errors = []
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args)
  })
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args)
  })
})

afterEach(() => {
  leavePage()
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

    await pixel(api)
    await settle()

    // The whole guarantee: no socket, no subscription, no cookie or storage read.
    expect(FakeEdgeSocket.instances).toHaveLength(0)
    expect(subscribed()).toEqual([])
    expect(reads).toEqual({ cookies: [], localStorage: [], sessionStorage: [] })
  })

  it.each([
    ['the destination is missing', { enabled: 'true' }],
    ['the destination is empty', { destination: '', enabled: 'true' }],
    ['the destination is not a string', { destination: 42, enabled: 'true' }]
  ])('does nothing when %s, rather than opening a socket to nowhere', async (_label, settings) => {
    const { api, reads, subscribed } = sandbox(settings)

    await pixel(api)
    await settle()

    expect(FakeEdgeSocket.instances).toHaveLength(0)
    expect(subscribed()).toEqual([])
    expect(reads.cookies).toEqual([])
  })
})

describe('a page load in the worker', () => {
  it('connects without logging an error, so SHOPLINE has no exception to capture', async () => {
    const { api } = sandbox({ destination: 'q.example.com', enabled: 'true' })

    const socket = await loadPage(api)

    expect(socket).toBeDefined()
    expect(errors).toEqual([])
  })
})

/**
 * The edge's browser frame schema, key for key (`websocket.ts`, all `z.strictObject`). A key outside
 * these makes the edge refuse the whole frame, which is how every frame the hand-built socket sent
 * with `context` was being dropped.
 */
const EDGE_KEYS: Record<string, string[]> = {
  track: ['t', 'ref', 'event', 'eventId', 'properties', 'observed', 'appResults', 'installs', 'apps'],
  identify: ['t', 'ref', 'id', 'traits', 'observed', 'appResults'],
  consent: ['t', 'ref', 'categories', 'apps', 'observed']
}

const expectEdgeAccepts = (frame: Record<string, unknown>): void => {
  const allowed = EDGE_KEYS[frame['t'] as string] ?? []
  expect(Object.keys(frame).filter((key) => !allowed.includes(key))).toEqual([])

  const observed = frame['observed'] as Record<string, unknown>
  expect(Object.keys(observed).sort()).toEqual(['occurredAt', 'page'])
  expect(Number.isInteger(observed['occurredAt'])).toBe(true)
  expect(Object.keys(observed['page'] as object).every((key) => key === 'url' || key === 'referrer')).toBe(true)
}

describe('an enabled store', () => {
  const ENABLED = { destination: 'q.srini-shopline.com', enabled: 'true' }

  it('opens one socket to the destination, naming the real page rather than the worker', async () => {
    const socket = await loadPage(sandbox(ENABLED).api, false)

    expect(FakeEdgeSocket.instances).toHaveLength(1)
    expect(socket?.url.startsWith('https://q.srini-shopline.com/open?')).toBe(true)
    expect(socket?.query.get('url')).toBe(PAGE_URL)
    expect(socket?.query.get('referrer')).toBe('https://www.google.com/')
  })

  it('omits the referrer when the storefront reports none', async () => {
    const socket = await loadPage(sandbox(ENABLED, { referrer: '' }).api, false)

    expect(socket?.query.has('referrer')).toBe(false)
  })

  it('subscribes to every mapped event and the identity step', async () => {
    const { api, subscribed } = sandbox(ENABLED)

    await loadPage(api)

    expect(subscribed().sort()).toEqual(
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

  it('reads the identity window from sessionStorage and the visitor from localStorage', async () => {
    const { api, reads } = sandbox(ENABLED)

    await loadPage(api)

    expect(reads.sessionStorage).toContain('blotout_shopline_session')
    expect(reads.localStorage).toContain('blotout_shopline_visitor')
  })

  it('sends frames the edge accepts: observed with occurredAt and page, nothing else', async () => {
    const { api, fire } = sandbox(ENABLED, { consent: 'accepted' })
    const socket = await loadPage(api)

    fire('page_viewed', { title: 'Dress', url: PAGE_URL, path: '/products/dress', login_em: 'ada@example.com', customer_id: 'c-1' })
    fire('product_added_to_cart', { currency: 'USD', value: 49.5, list: [{ spuId: 'spu-1', quantity: 1, price: 49.5 }] })
    await settle()

    const frames = socket?.frames() ?? []
    expect(frames.map((frame) => frame['t']).sort()).toEqual(['consent', 'identify', 'track', 'track'])
    frames.forEach(expectEdgeAccepts)
  })

  it('carries the payload and the real page on a track frame', async () => {
    const { api, fire } = sandbox(ENABLED)
    const socket = await loadPage(api)

    fire('product_added_to_cart', { currency: 'USD', value: 49.5, list: [{ spuId: 'spu-1', quantity: 2, price: 24.75 }] })
    await settle()

    expect(socket?.frames()).toEqual([
      expect.objectContaining({
        t: 'track',
        event: 'AddToCart',
        eventId: expect.stringMatching(/^evt_/),
        properties: { currency: 'USD', value: 49.5, contents: [{ id: 'spu-1', quantity: 2, value: 24.75 }] },
        observed: { occurredAt: expect.any(Number), page: { url: PAGE_URL, referrer: 'https://www.google.com/' } }
      })
    ])
  })

  it('sends events fired before the handshake, once it completes', async () => {
    const { api, fire } = sandbox(ENABLED)
    const socket = await loadPage(api, false)

    fire('search_submitted', { keyword: 'dress' })
    await settle()
    expect(socket?.frames()).toEqual([])

    socket?.accept()
    await settle()
    expect(socket?.frames()).toEqual([expect.objectContaining({ t: 'track', event: 'Search', properties: { search: 'dress' } })])
  })

  it('uses the order number as the Purchase event id', async () => {
    const { api, fire } = sandbox(ENABLED)
    const socket = await loadPage(api)

    fire('checkout_completed', { orderSeq: '1001', value: 10, currency: 'USD', list: [] })
    await settle()

    expect(socket?.frames().find((frame) => frame['event'] === 'Purchase')).toMatchObject({
      eventId: '1001',
      properties: { orderId: '1001' }
    })
  })

  it('sends the consent state it found', async () => {
    const socket = await loadPage(sandbox(ENABLED, { consent: 'accepted' }).api)

    expect(socket?.frames().find((frame) => frame['t'] === 'consent')?.['categories']).toEqual({
      necessary: true,
      functional: true,
      analytics: true,
      marketing: true,
      salesOfData: true
    })
  })

  it('subscribes before it waits on consent, so the first page view is not lost', async () => {
    const { api, subscribed } = sandbox(ENABLED, { consent: 'accepted' })
    const socket = await loadPage(api)

    expect(subscribed().length).toBeGreaterThan(0)
    expect(socket?.frames().some((frame) => frame['t'] === 'consent')).toBe(true)
  })

  it('sends no consent frame when the storefront holds no state', async () => {
    const socket = await loadPage(sandbox(ENABLED).api)

    // Inventing a state would be worse than sending none: the edge acts on what it is told.
    expect(socket?.frames().some((frame) => frame['t'] === 'consent')).toBe(false)
  })

  it('reports a socket failure to the storefront console rather than throwing', async () => {
    FakeEdgeSocket.failConstruction = true
    const { api } = sandbox(ENABLED)

    await expect(pixel(api)).resolves.toBeUndefined()
    await settle()
    expect(warnings.some((args) => String(args[0]).includes('[blotout]'))).toBe(true)
  })
})

describe('the visitor, across pages', () => {
  const ENABLED = { destination: 'q.srini-shopline.com', enabled: 'true' }

  it('connects a first-time visitor with no uid, then keeps what the edge reported', async () => {
    const first = sandbox(ENABLED)
    const socket = await loadPage(first.api)

    expect(socket?.query.has('uid')).toBe(false)
    expect(JSON.parse(first.local['blotout_shopline_visitor'] as string)).toMatchObject({
      anonId: ANON_ID,
      session: { id: VISIT.id, startedAt: VISIT.startedAt }
    })
  })

  it('continues the same visitor and visit on the next page, the way a cookie would', async () => {
    const local: Store = {}
    await loadPage(sandbox(ENABLED, { local }).api)
    leavePage()

    const next = await loadPage(sandbox(ENABLED, { local }).api, false)

    expect(next?.query.get('uid')).toBe(ANON_ID)
    expect(next?.query.get('session')).toBe(`${VISIT.id}.${VISIT.startedAt}`)
  })
})

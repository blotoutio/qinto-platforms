import { afterEach, describe, expect, it, vi } from 'vitest'

import type { QintoClientOptions } from '../src/qinto-client'
import { openQintoClient, toOrigin } from '../src/qinto-client'

type InitOptions = Parameters<NonNullable<QintoClientOptions['sdk']>['init']>[0]

/** The SDK, as far as the pixel uses it, recording every call and settling however a test says. */
const fakeSdk = (outcome: { init?: 'reject'; calls?: 'reject' } = {}) => {
  const inits: InitOptions[] = []
  const calls: unknown[][] = []
  const settle = <T>(value: T): Promise<T> =>
    outcome.calls === 'reject' ? Promise.reject(new Error('edge refused')) : Promise.resolve(value)

  return {
    inits,
    calls,
    sdk: {
      init: vi.fn((options: InitOptions) => {
        inits.push(options)

        return outcome.init === 'reject' ? Promise.reject(new TypeError('socket closed')) : Promise.resolve({} as never)
      }),
      track: vi.fn((...args: unknown[]) => {
        calls.push(['track', ...args])

        return settle({ eventId: 'evt' })
      }),
      identify: vi.fn((...args: unknown[]) => {
        calls.push(['identify', ...args])

        return settle(undefined)
      }),
      consent: vi.fn((...args: unknown[]) => {
        calls.push(['consent', ...args])

        return settle(undefined)
      }),
      close: vi.fn(() => {
        calls.push(['close'])

        return settle(undefined)
      })
    }
  }
}

const PAGE = { url: 'https://shop.example.com/products/tee', referrer: 'https://www.google.com/' }

const open = (overrides: Partial<QintoClientOptions> = {}, outcome: Parameters<typeof fakeSdk>[0] = {}) => {
  const fake = fakeSdk(outcome)
  const errors: string[] = []
  const events = new EventTarget()
  const client = openQintoClient({
    destination: 'q.shop.example.com',
    page: PAGE,
    sdk: fake.sdk as unknown as NonNullable<QintoClientOptions['sdk']>,
    events,
    onError: (message) => errors.push(message),
    ...overrides
  })
  const pageContext = () => (fake.inits[0] as InitOptions).pageContext?.()

  return { ...fake, client, errors, events, pageContext }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  delete (globalThis as Record<string, unknown>)['window']
  delete (globalThis as Record<string, unknown>)['document']
})

describe('toOrigin', () => {
  it('gives a bare host the https scheme, since the setting holds a host only', () => {
    expect(toOrigin('q.shop.example.com')).toBe('https://q.shop.example.com')
  })

  it('keeps an explicit http(s) origin, which local testing needs', () => {
    expect(toOrigin('http://127.0.0.1:8787/')).toBe('http://127.0.0.1:8787')
    expect(toOrigin(' https://q.example.com// ')).toBe('https://q.example.com')
  })

  it('turns a websocket URL into the origin the SDK wants', () => {
    expect(toOrigin('wss://q.example.com')).toBe('https://q.example.com')
  })
})

describe('openQintoClient', () => {
  it('installs the worker shims before starting the SDK, which throws without a document', () => {
    let documentAtInit: unknown
    const fake = fakeSdk()
    fake.sdk.init.mockImplementation(() => {
      documentAtInit = (globalThis as Record<string, unknown>)['document']

      return Promise.resolve({} as never)
    })

    openQintoClient({ destination: 'q.example.com', page: PAGE, sdk: fake.sdk as never, events: new EventTarget() })

    expect(documentAtInit).toMatchObject({ cookie: '' })
  })

  it('starts the SDK on the destination origin and names the real page, not the worker', () => {
    const { inits, pageContext } = open()

    expect(inits[0]?.destination).toBe('https://q.shop.example.com')
    expect(pageContext()).toEqual(PAGE)
  })

  it('hands the edge the visitor from the previous page', () => {
    const { pageContext } = open({ visitor: { id: 'anon_1', session: 'vis_1.100' } })

    expect(pageContext()).toEqual({ ...PAGE, visitor: { id: 'anon_1', session: 'vis_1.100' } })
  })

  it('follows a URL the storefront rewrote without a reload, keeping the referrer', () => {
    const { client, pageContext } = open()

    client.setUrl('https://shop.example.com/products/tee?sku=2')

    expect(pageContext()).toEqual({ url: 'https://shop.example.com/products/tee?sku=2', referrer: PAGE.referrer })
  })

  it('switches to the visit the edge reports on connect, so a reconnect continues it', () => {
    const onConnect = vi.fn(() => ({ id: 'anon_2', session: 'vis_2.200' }))
    const { events, pageContext } = open({ visitor: { id: 'anon_1' }, onConnect })

    events.dispatchEvent(new CustomEvent('qinto:connect', { detail: { anonId: 'anon_2' } }))

    expect(onConnect).toHaveBeenCalledWith({ anonId: 'anon_2' })
    expect(pageContext()).toEqual({ ...PAGE, visitor: { id: 'anon_2', session: 'vis_2.200' } })
  })

  it('keeps the visitor it has when a connect reports none', () => {
    const { events, pageContext } = open({ visitor: { id: 'anon_1' }, onConnect: () => undefined })

    events.dispatchEvent(new CustomEvent('qinto:connect', { detail: {} }))

    expect(pageContext()).toMatchObject({ visitor: { id: 'anon_1' } })
  })

  it('ignores a connect when nothing asked to hear about it', () => {
    const { events, pageContext } = open({ visitor: { id: 'anon_1' } })

    events.dispatchEvent(new CustomEvent('qinto:connect', { detail: { anonId: 'anon_9' } }))

    expect(pageContext()).toMatchObject({ visitor: { id: 'anon_1' } })
  })

  it('reports a connection error the SDK raises outside any call', () => {
    const { inits, errors } = open()

    inits[0]?.onError?.(new Error('socket dropped'))

    expect(errors).toEqual(['connection: Error: socket dropped'])
  })

  it('reports a failed start instead of throwing into the storefront', async () => {
    const { errors } = open({}, { init: 'reject' })
    await flush()

    expect(errors).toEqual(['init failed: TypeError: socket closed'])
  })

  it('tracks with the caller’s event id, and lets the SDK mint one otherwise', () => {
    const { client, calls } = open()

    client.track('Purchase', { orderId: '1001' }, '1001')
    client.track('AddToCart', { value: 1 })

    expect(calls).toEqual([
      ['track', 'Purchase', { orderId: '1001' }, { eventId: '1001' }],
      ['track', 'AddToCart', { value: 1 }, undefined]
    ])
  })

  it('sends no properties for an event that has none', () => {
    const { client, calls } = open()

    client.track('PageView', {})
    client.track('PageView')

    expect(calls).toEqual([
      ['track', 'PageView', undefined, undefined],
      ['track', 'PageView', undefined, undefined]
    ])
  })

  it('identifies with an id only when there is a real one', () => {
    const { client, calls } = open()

    client.identify({ email: 'ada@example.com' }, 'ada@example.com')
    client.identify({ phone: '+1' }, null)
    client.identify({ phone: '+1' }, '')
    client.identify({ phone: '+1' })

    expect(calls).toEqual([
      ['identify', { email: 'ada@example.com' }, 'ada@example.com'],
      ['identify', { phone: '+1' }, undefined],
      ['identify', { phone: '+1' }, undefined],
      ['identify', { phone: '+1' }, undefined]
    ])
  })

  it('sends consent as the SDK’s categories input', () => {
    const { client, calls } = open()

    client.consent({ necessary: true, marketing: false })

    expect(calls).toEqual([['consent', { categories: { necessary: true, marketing: false } }]])
  })

  it('reports every refused call by name and never throws', async () => {
    const { client, errors } = open({}, { calls: 'reject' })

    client.track('AddToCart', { value: 1 })
    client.identify({ email: 'a@b.com' })
    client.consent({ necessary: true })
    client.close()
    await flush()

    expect(errors).toEqual([
      'AddToCart failed: Error: edge refused',
      'identify failed: Error: edge refused',
      'consent failed: Error: edge refused',
      'close failed: Error: edge refused'
    ])
  })

  it('describes a non-Error rejection too', async () => {
    const fake = fakeSdk()
    fake.sdk.track.mockImplementation(() => Promise.reject('nope'))
    const errors: string[] = []
    const client = openQintoClient({
      destination: 'q.example.com',
      page: PAGE,
      sdk: fake.sdk as never,
      events: new EventTarget(),
      onError: (m) => errors.push(m)
    })

    client.track('Search')
    await flush()

    expect(errors).toEqual(['Search failed: nope'])
  })

  it('stays quiet without an error handler', async () => {
    const fake = fakeSdk({ init: 'reject' })

    expect(() =>
      openQintoClient({ destination: 'q.example.com', page: PAGE, sdk: fake.sdk as never, events: new EventTarget() })
    ).not.toThrow()
    await flush()
  })

  it('listens on the global scope by default, where the SDK dispatches qinto:connect', () => {
    const fake = fakeSdk()
    const global = globalThis as Record<string, unknown>
    const listen = vi.fn()
    global['addEventListener'] = listen

    openQintoClient({ destination: 'q.example.com', page: PAGE, sdk: fake.sdk as never })

    expect(listen).toHaveBeenCalledWith('qinto:connect', expect.any(Function))
    delete global['addEventListener']
  })

  it('still starts on a global scope that cannot take listeners', () => {
    const fake = fakeSdk()

    openQintoClient({ destination: 'q.example.com', page: PAGE, sdk: fake.sdk as never })

    expect(fake.sdk.init).toHaveBeenCalledOnce()
  })
})

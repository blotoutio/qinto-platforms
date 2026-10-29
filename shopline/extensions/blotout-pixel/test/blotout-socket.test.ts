import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BlotoutSocket } from '../src/blotout-socket'
import { openBlotoutSocket } from '../src/blotout-socket'
import { FakeSocket, withFakeSocket } from './fake-socket'

const PAGE = { url: 'https://srini-test.myshopline.com/products/dress', referrer: 'https://google.com/' }
const SESSION = { id: 'sl_session_1', isNew: true, startedAt: 1_700_000_000_000 }

let restore: () => void
let errors: string[]

const open = (destination = 'q.srini-shopline.com'): BlotoutSocket => {
  errors = []

  return openBlotoutSocket({ destination, page: PAGE, session: SESSION, onError: (message) => errors.push(message) })
}

beforeEach(() => {
  restore = withFakeSocket()
})

afterEach(() => {
  restore()
  vi.useRealTimers()
})

describe('connecting', () => {
  it('opens a secure socket on /open', () => {
    open()

    expect(FakeSocket.last?.url).toBe('wss://q.srini-shopline.com/open')
  })

  it.each([
    ['a scheme', 'wss://q.example.com'],
    ['an http scheme', 'ws://q.example.com'],
    ['a trailing slash', 'q.example.com/'],
    ['several trailing slashes', 'q.example.com///']
  ])('tolerates a destination with %s', (_label, destination) => {
    open(destination)

    expect(FakeSocket.last?.url).toBe('wss://q.example.com/open')
  })

  it('reports a sandbox that refuses to construct a socket, without throwing', () => {
    FakeSocket.failConstruction = true

    expect(() => open()).not.toThrow()
    expect(errors[0]).toContain('could not open')
  })

  it('reports a socket error', () => {
    open()
    FakeSocket.last?.fail()

    expect(errors[0]).toContain('websocket error')
  })
})

describe('queueing before the handshake', () => {
  it('holds frames fired before the socket opens, then sends them in order', () => {
    const blotout = open()
    blotout.track('PageView')
    blotout.track('ViewContent', { currency: 'USD' })

    // A storefront fires page_viewed within milliseconds of the sandbox starting, well before the
    // handshake finishes; dropping those would lose the first event of every visit.
    expect(FakeSocket.last?.sent).toHaveLength(0)

    FakeSocket.last?.open()

    expect(FakeSocket.last?.frames().map((frame) => frame['event'])).toEqual(['PageView', 'ViewContent'])
  })

  it('drops the oldest frame once the queue is full, keeping the most recent behaviour', () => {
    const blotout = open()
    for (let index = 0; index < 55; index += 1) {
      blotout.track('PageView', { index })
    }

    FakeSocket.last?.open()
    const frames = FakeSocket.last?.frames() ?? []

    expect(frames).toHaveLength(50)
    expect((frames[0] as { properties: { index: number } }).properties.index).toBe(5)
    expect(errors.some((message) => message.includes('queue full'))).toBe(true)
  })

  it('sends straight through once open', () => {
    const blotout = open()
    FakeSocket.last?.open()
    blotout.track('AddToCart')

    expect(FakeSocket.last?.sent).toHaveLength(1)
  })

  it('re-queues a frame whose send throws', () => {
    const blotout = open()
    const socket = FakeSocket.last as FakeSocket
    socket.open()
    socket.sendThrows = true
    blotout.track('AddToCart')

    expect(errors[0]).toContain('send failed')
    socket.sendThrows = false
    // Requeued rather than lost, so it goes out with the next successful send.
    blotout.track('Purchase')
    expect(socket.frames().map((frame) => frame['event'])).toEqual(['AddToCart', 'Purchase'])
  })

  it('stops at the first failed send and keeps the rest queued in order', () => {
    const blotout = open()
    const socket = FakeSocket.last as FakeSocket
    blotout.track('A')
    blotout.track('B')
    socket.sendThrows = true
    socket.open()

    // One report, not two: a socket that just refused a frame will refuse the next, and pushing on
    // would only reorder the batch.
    expect(errors.filter((message) => message.includes('send failed'))).toHaveLength(1)

    socket.sendThrows = false
    blotout.track('C')
    expect(socket.frames().map((frame) => frame['event'])).toEqual(['A', 'B', 'C'])
  })
})

describe('frames', () => {
  it('sends a track frame in Blotout’s shape', () => {
    const blotout = open()
    FakeSocket.last?.open()
    blotout.track('Purchase', { orderId: 'ORD-1', value: 99 }, 'ORD-1')

    expect(FakeSocket.last?.frames()[0]).toEqual({
      t: 'track',
      ref: '1',
      event: 'Purchase',
      eventId: 'ORD-1',
      properties: { orderId: 'ORD-1', value: 99 },
      context: { occurredAt: expect.any(Number), page: PAGE, session: SESSION }
    })
  })

  it('carries the new URL on every frame after setUrl, and keeps the referrer', () => {
    const blotout = open()
    FakeSocket.last?.open()
    blotout.setUrl('https://srini-test.myshopline.com/products/dress?sku=2')
    blotout.track('ViewContent')

    // SHOPLINE's variant picker rewrites the URL without reloading, so the context the sandbox was
    // handed at startup goes stale while the pixel keeps running.
    expect(FakeSocket.last?.frames()[0]?.['context']).toEqual({
      occurredAt: expect.any(Number),
      page: { url: 'https://srini-test.myshopline.com/products/dress?sku=2', referrer: PAGE.referrer },
      session: SESSION
    })
  })

  it('mints an eventId when the caller has none', () => {
    const blotout = open()
    FakeSocket.last?.open()
    blotout.track('PageView')

    expect(FakeSocket.last?.frames()[0]?.['eventId']).toMatch(/^evt_\d+_[a-z0-9]+$/)
  })

  it('omits an empty properties object rather than sending one', () => {
    const blotout = open()
    FakeSocket.last?.open()
    blotout.track('PageView', {})

    expect(FakeSocket.last?.frames()[0]).not.toHaveProperty('properties')
  })

  it('sends an identify with traits and an id', () => {
    const blotout = open()
    FakeSocket.last?.open()
    blotout.identify({ email: 'a@b.com' }, 'a@b.com')

    expect(FakeSocket.last?.frames()[0]).toMatchObject({ t: 'identify', id: 'a@b.com', traits: { email: 'a@b.com' } })
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', '']
  ])('omits the id when it is %s, which Blotout refuses', (_label, id) => {
    const blotout = open()
    FakeSocket.last?.open()
    blotout.identify({ city: 'Hyderabad' }, id)

    expect(FakeSocket.last?.frames()[0]).not.toHaveProperty('id')
  })

  it('omits empty traits', () => {
    const blotout = open()
    FakeSocket.last?.open()
    blotout.identify({}, 'a@b.com')

    expect(FakeSocket.last?.frames()[0]).not.toHaveProperty('traits')
  })

  it('sends consent categories', () => {
    const blotout = open()
    FakeSocket.last?.open()
    blotout.consent({ necessary: true, analytics: true, marketing: false })

    expect(FakeSocket.last?.frames()[0]).toMatchObject({
      t: 'consent',
      categories: { necessary: true, analytics: true, marketing: false }
    })
  })

  it('numbers refs so a reply can be matched to its frame', () => {
    const blotout = open()
    FakeSocket.last?.open()
    blotout.track('A')
    blotout.track('B')

    expect(FakeSocket.last?.frames().map((frame) => frame['ref'])).toEqual(['1', '2'])
  })

  it('marks the session new exactly once', () => {
    const blotout = open()
    FakeSocket.last?.open()
    blotout.track('PageView')
    blotout.track('ViewContent')

    const sessions = FakeSocket.last?.frames().map((frame) => (frame['context'] as { session: { isNew: boolean } }).session.isNew)
    expect(sessions).toEqual([true, false])
  })
})

describe('server replies', () => {
  it('reports an error frame, which is the only reply that needs acting on', () => {
    open()
    FakeSocket.last?.open()
    FakeSocket.last?.message(JSON.stringify({ t: 'error', ref: '1', message: 'invalid message' }))

    expect(errors[0]).toContain('invalid message')
  })

  it('reports an error frame with no message', () => {
    open()
    FakeSocket.last?.message(JSON.stringify({ t: 'error' }))

    expect(errors[0]).toContain('no reason given')
  })

  it('ignores an ack, which carries no work', () => {
    open()
    FakeSocket.last?.message(JSON.stringify({ t: 'ack', ref: '1', anonId: 'anon_1' }))

    expect(errors).toEqual([])
  })

  it('ignores sharedContext and appPush, which are for a page that renders app UI', () => {
    open()
    FakeSocket.last?.message(JSON.stringify({ t: 'sharedContext', context: {}, categories: {}, apps: {} }))
    FakeSocket.last?.message(JSON.stringify({ t: 'appPush', app: 'x', topic: 'y', data: {} }))

    expect(errors).toEqual([])
  })

  it('reports an unparseable reply', () => {
    open()
    FakeSocket.last?.message('not json')

    expect(errors[0]).toContain('unparseable')
  })

  it('ignores a binary reply', () => {
    open()
    FakeSocket.last?.message(new ArrayBuffer(4))

    expect(errors).toEqual([])
  })
})

describe('reconnecting', () => {
  it('reconnects with backoff after the server closes', () => {
    vi.useFakeTimers()
    open()
    FakeSocket.last?.open()
    FakeSocket.last?.closeFromServer()

    expect(FakeSocket.instances).toHaveLength(1)
    vi.advanceTimersByTime(1000)
    expect(FakeSocket.instances).toHaveLength(2)
  })

  it('gives up after five attempts rather than hammering a dead endpoint, and says so', () => {
    vi.useFakeTimers()
    const blotout = open()
    blotout.track('PageView')

    for (let attempt = 0; attempt < 8; attempt += 1) {
      FakeSocket.last?.closeFromServer()
      vi.advanceTimersByTime(60_000)
    }

    expect(FakeSocket.instances).toHaveLength(6)
    // Without this the storefront has no signal at all that a dead delivery host is dead, and every
    // frame from here on is queued and silently evicted.
    const gaveUp = errors.find((message) => message.includes('gave up reconnecting'))
    expect(gaveUp).toBeDefined()
    expect(gaveUp).toContain('1 frame(s) undelivered')
  })

  it('does not reconnect after close() was called', () => {
    vi.useFakeTimers()
    const blotout = open()
    FakeSocket.last?.open()
    blotout.close()
    FakeSocket.last?.closeFromServer()
    vi.advanceTimersByTime(60_000)

    expect(FakeSocket.instances).toHaveLength(1)
  })

  it('drops queued frames on close, so a closed client sends nothing later', () => {
    const blotout = open()
    blotout.track('PageView')
    blotout.close()
    const socket = FakeSocket.last as FakeSocket
    socket.open()

    expect(socket.sent).toHaveLength(0)
  })

  it('abandons a reconnect that was already scheduled when close() lands first', () => {
    vi.useFakeTimers()
    const blotout = open()
    FakeSocket.last?.open()
    // The server drops the connection, a reconnect is scheduled, and only then does the merchant's
    // kill switch land. The scheduled attempt must not open a second socket.
    FakeSocket.last?.closeFromServer()
    blotout.close()
    vi.advanceTimersByTime(60_000)

    expect(FakeSocket.instances).toHaveLength(1)
  })

  it('stops constructing sockets once closed', () => {
    vi.useFakeTimers()
    const blotout = open()
    blotout.close()
    vi.advanceTimersByTime(60_000)

    expect(FakeSocket.instances).toHaveLength(1)
  })
})

describe('the default error reporter', () => {
  it('swallows errors when no reporter was supplied', () => {
    const blotout = openBlotoutSocket({ destination: 'q.example.com', page: PAGE, session: SESSION })
    FakeSocket.last?.message('not json')

    expect(() => blotout.track('PageView')).not.toThrow()
  })
})

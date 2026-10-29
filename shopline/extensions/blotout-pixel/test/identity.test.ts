import { describe, expect, it, vi } from 'vitest'

import type { BlotoutSocket } from '../src/blotout-socket'
import { identitySender, knownIdentity, readSentIdentity } from '../src/identity'

const KEY = 'blotout_shopline_identity'

const storageOf = (initial: string | null) => {
  const cell = { value: initial }

  return {
    cell,
    getItem: vi.fn(async (key: string) => (key === KEY ? cell.value : null)),
    setItem: vi.fn(async (key: string, value: string) => {
      if (key === KEY) {
        cell.value = value
      }

      return undefined
    })
  }
}

const socketOf = () => {
  const sent: { traits: Record<string, unknown>; id: string | null | undefined }[] = []

  return {
    sent,
    socket: {
      track: () => undefined,
      identify: (traits: Record<string, unknown>, id?: string | null) => sent.push({ traits, id }),
      consent: () => undefined,
      setUrl: () => undefined,
      close: () => undefined
    } as BlotoutSocket
  }
}

describe('readSentIdentity', () => {
  it('reads back what a previous page stored', async () => {
    const storage = storageOf(JSON.stringify({ sessionId: 'sl_1', traits: { email: 'ada@example.com' } }))

    await expect(readSentIdentity(storage)).resolves.toEqual({ sessionId: 'sl_1', traits: { email: 'ada@example.com' } })
  })

  it.each([
    ['nothing stored', null],
    ['unparseable JSON', '{oops'],
    ['a JSON value that is not an object', '"ada"'],
    ['null', 'null'],
    ['no session id', JSON.stringify({ traits: { email: 'a@b.c' } })],
    ['no traits', JSON.stringify({ sessionId: 'sl_1' })],
    ['null traits', JSON.stringify({ sessionId: 'sl_1', traits: null })]
  ])('returns null for %s, so identity is simply sent again', async (_label, stored) => {
    await expect(readSentIdentity(storageOf(stored))).resolves.toBeNull()
  })

  it('returns null when the storefront refuses the read', async () => {
    // Storage can reject outright — a blocked storefront must still send identity, not stop.
    await expect(
      readSentIdentity({ getItem: () => Promise.reject(new Error('blocked')), setItem: async () => undefined })
    ).resolves.toBeNull()
  })
})

describe('knownIdentity', () => {
  const stored = { sessionId: 'sl_1', traits: { email: 'ada@example.com' } }

  it('carries the traits forward within the same session', () => {
    expect(knownIdentity(stored, 'sl_1')).toEqual({ email: 'ada@example.com' })
  })

  it('drops them for a new session, so identity is re-asserted', () => {
    // The session is the unit of attribution; a session that aged out must not inherit the claim.
    expect(knownIdentity(stored, 'sl_2')).toEqual({})
  })

  it('starts empty when nothing was stored', () => {
    expect(knownIdentity(null, 'sl_1')).toEqual({})
  })
})

describe('identitySender', () => {
  it('sends the first identity and persists it against the session', async () => {
    const storage = storageOf(null)
    const { sent, socket } = socketOf()

    identitySender({ blotout: socket, sessionId: 'sl_1', known: {}, storage })({ email: 'Ada@Example.com' })

    expect(sent).toEqual([{ traits: { email: 'Ada@Example.com' }, id: 'ada@example.com' }])
    await vi.waitFor(() =>
      expect(JSON.parse(storage.cell.value as string)).toEqual({ sessionId: 'sl_1', traits: { email: 'Ada@Example.com' } })
    )
  })

  it('sends nothing when the session already told Blotout the same thing', () => {
    const { sent, socket } = socketOf()
    const send = identitySender({
      blotout: socket,
      sessionId: 'sl_1',
      known: { email: 'ada@example.com', customerId: '1' },
      storage: storageOf(null)
    })

    send({ email: 'ada@example.com', customerId: '1' })

    expect(sent).toEqual([])
  })

  it('sends again when a later event adds a trait', () => {
    const { sent, socket } = socketOf()
    const send = identitySender({ blotout: socket, sessionId: 'sl_1', known: { email: 'ada@example.com' }, storage: storageOf(null) })

    send({ email: 'ada@example.com', phone: '+447700900123' })

    expect(sent).toHaveLength(1)
  })

  it('sends again when a trait changes value', () => {
    const { sent, socket } = socketOf()
    const send = identitySender({ blotout: socket, sessionId: 'sl_1', known: { email: 'ada@example.com' }, storage: storageOf(null) })

    send({ email: 'grace@example.com' })

    expect(sent[0]?.id).toBe('grace@example.com')
  })

  it('sends nothing at all for a visitor SHOPLINE gave no traits for', () => {
    const { sent, socket } = socketOf()

    identitySender({ blotout: socket, sessionId: 'sl_1', known: {}, storage: storageOf(null) })({})

    expect(sent).toEqual([])
  })

  it('accumulates across calls, so the third page repeats nothing', () => {
    const { sent, socket } = socketOf()
    const send = identitySender({ blotout: socket, sessionId: 'sl_1', known: {}, storage: storageOf(null) })

    send({ email: 'ada@example.com' })
    send({ email: 'ada@example.com', phone: '+447700900123' })
    send({ email: 'ada@example.com' })
    send({ phone: '+447700900123' })

    expect(sent).toHaveLength(2)
  })

  it('still sends when there is no storage to remember it with', () => {
    const { sent, socket } = socketOf()

    identitySender({ blotout: socket, sessionId: 'sl_1', known: {} })({ email: 'ada@example.com' })

    expect(sent).toHaveLength(1)
  })

  it('does not throw when the storefront refuses the write', () => {
    const { sent, socket } = socketOf()
    const storage = { getItem: async () => null, setItem: () => Promise.reject(new Error('blocked')) }

    expect(() => identitySender({ blotout: socket, sessionId: 'sl_1', known: {}, storage })({ email: 'ada@example.com' })).not.toThrow()
    expect(sent).toHaveLength(1)
  })
})

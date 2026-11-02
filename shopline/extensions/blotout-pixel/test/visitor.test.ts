import { describe, expect, it } from 'vitest'

import { readVisitor, rememberVisitor, visitorContext } from '../src/visitor'

const KEY = 'blotout_shopline_visitor'
const NOW = 1_700_000_000_000
const MINUTE = 60 * 1000

const fakeStorage = (initial: Record<string, string> = {}, failures: { read?: boolean; write?: boolean } = {}) => {
  const store = { ...initial }

  return {
    store,
    getItem: (key: string) => (failures.read === true ? Promise.reject(new Error('blocked')) : Promise.resolve(store[key] ?? null)),
    setItem: (key: string, value: string) => {
      if (failures.write === true) {
        return Promise.reject(new Error('blocked'))
      }

      store[key] = value

      return Promise.resolve(undefined)
    }
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

const CONNECT = { name: 'qinto', anonId: 'anon_1', session: { id: 'vis_1', isNew: true, startedAt: NOW - 5 * MINUTE }, reconnect: false }

describe('rememberVisitor', () => {
  it('keeps the visitor and visit from a connect, stamped with when it was seen', async () => {
    const storage = fakeStorage()

    expect(rememberVisitor(storage, CONNECT, NOW)).toEqual({
      anonId: 'anon_1',
      session: { id: 'vis_1', startedAt: NOW - 5 * MINUTE },
      seenAt: NOW
    })
    await flush()

    expect(JSON.parse(storage.store[KEY] as string)).toEqual({
      anonId: 'anon_1',
      session: { id: 'vis_1', startedAt: NOW - 5 * MINUTE },
      seenAt: NOW
    })
  })

  it('keeps the visitor when the connect carried no visit', () => {
    expect(rememberVisitor(fakeStorage(), { anonId: 'anon_1' }, NOW)).toEqual({ anonId: 'anon_1', seenAt: NOW })
  })

  it.each([
    ['nothing', undefined],
    ['a non-object', 'anon_1'],
    ['no anon id', { session: CONNECT.session }],
    ['an id that is not an anon id', { anonId: 'gid_1' }]
  ])('stores nothing for %s', async (_label, detail) => {
    const storage = fakeStorage()

    expect(rememberVisitor(storage, detail, NOW)).toBeNull()
    await flush()

    expect(storage.store).toEqual({})
  })

  it.each([
    ['no id', { startedAt: 1 }],
    ['an empty id', { id: '', startedAt: 1 }],
    ['no start time', { id: 'vis_1' }],
    ['a start time that is not a number', { id: 'vis_1', startedAt: Number.NaN }],
    ['a non-object', 'vis_1.1']
  ])('drops a visit with %s but keeps the visitor', (_label, session) => {
    expect(rememberVisitor(fakeStorage(), { anonId: 'anon_1', session }, NOW)).toEqual({ anonId: 'anon_1', seenAt: NOW })
  })

  it('still returns the visitor when storage refuses the write', async () => {
    expect(rememberVisitor(fakeStorage({}, { write: true }), CONNECT, NOW)).toMatchObject({ anonId: 'anon_1' })
    await flush()
  })
})

describe('readVisitor', () => {
  it('reads back what was remembered', async () => {
    const storage = fakeStorage()
    rememberVisitor(storage, CONNECT, NOW)
    await flush()

    expect(await readVisitor(storage)).toEqual({ anonId: 'anon_1', session: { id: 'vis_1', startedAt: NOW - 5 * MINUTE }, seenAt: NOW })
  })

  it.each([
    ['nothing stored', {}],
    ['unparseable JSON', { [KEY]: '{nope' }],
    ['no seen-at stamp', { [KEY]: JSON.stringify({ anonId: 'anon_1' }) }],
    ['JSON null', { [KEY]: 'null' }],
    ['a forged id', { [KEY]: JSON.stringify({ anonId: 'evil', seenAt: NOW }) }]
  ])('returns null for %s', async (_label, initial) => {
    expect(await readVisitor(fakeStorage(initial))).toBeNull()
  })

  it('returns null when storage is blocked', async () => {
    expect(await readVisitor(fakeStorage({}, { read: true }))).toBeNull()
  })
})

describe('visitorContext', () => {
  const stored = { anonId: 'anon_1', session: { id: 'vis_1', startedAt: NOW - 20 * MINUTE }, seenAt: NOW - 10 * MINUTE }

  it('is nothing for a first-time visitor', () => {
    expect(visitorContext(null, NOW)).toBeUndefined()
  })

  it('continues the visitor and the visit while the visit is live', () => {
    expect(visitorContext(stored, NOW)).toEqual({ id: 'anon_1', session: `vis_1.${NOW - 20 * MINUTE}` })
  })

  it('continues the visitor but not a visit idle for 30 minutes, which the edge has ended', () => {
    expect(visitorContext(stored, stored.seenAt + 30 * MINUTE)).toEqual({ id: 'anon_1' })
  })

  it('continues the visitor alone when no visit was reported', () => {
    expect(visitorContext({ anonId: 'anon_1', seenAt: NOW }, NOW)).toEqual({ id: 'anon_1' })
  })
})

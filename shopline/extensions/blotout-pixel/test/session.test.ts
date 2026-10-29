import { describe, expect, it } from 'vitest'

import { resolveSession } from '../src/session'

const KEY = 'blotout_shopline_session'
const NOW = 1_700_000_000_000

/** The sandbox's async sessionStorage proxy, with a switch for each way it can fail. */
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

describe('resolveSession', () => {
  it('mints a session on the first page of a visit', async () => {
    const storage = fakeStorage()

    const session = await resolveSession(storage, NOW)

    expect(session).toMatchObject({ isNew: true, startedAt: NOW })
    expect(session.id).toMatch(/^sl_[a-z0-9]+_[a-z0-9]+$/)
    expect(JSON.parse(storage.store[KEY] ?? '{}')).toMatchObject({ id: session.id, startedAt: NOW })
  })

  it('reuses a session inside the window, so a journey stitches together', async () => {
    const storage = fakeStorage({ [KEY]: JSON.stringify({ id: 'sl_existing', startedAt: NOW - 60_000 }) })

    await expect(resolveSession(storage, NOW)).resolves.toEqual({ id: 'sl_existing', isNew: false, startedAt: NOW - 60_000 })
  })

  it('mints a new one once the window has passed', async () => {
    const storage = fakeStorage({ [KEY]: JSON.stringify({ id: 'sl_stale', startedAt: NOW - 31 * 60 * 1000 }) })

    const session = await resolveSession(storage, NOW)

    expect(session.id).not.toBe('sl_stale')
    expect(session.isNew).toBe(true)
  })

  it('mints a distinct id each time', async () => {
    const first = await resolveSession(fakeStorage(), NOW)
    const second = await resolveSession(fakeStorage(), NOW)

    expect(first.id).not.toBe(second.id)
  })

  it.each([
    ['unparseable', 'not json'],
    ['not an object', '"a string"'],
    ['null', 'null'],
    ['missing an id', JSON.stringify({ startedAt: NOW })],
    ['an empty id', JSON.stringify({ id: '', startedAt: NOW })],
    ['a non-string id', JSON.stringify({ id: 7, startedAt: NOW })],
    ['missing a start time', JSON.stringify({ id: 'sl_x' })],
    ['a non-numeric start time', JSON.stringify({ id: 'sl_x', startedAt: 'yesterday' })]
  ])('replaces a stored value that is %s', async (_label, stored) => {
    const session = await resolveSession(fakeStorage({ [KEY]: stored }), NOW)

    expect(session.isNew).toBe(true)
    expect(session.startedAt).toBe(NOW)
  })

  it('still produces a session when storage cannot be read', async () => {
    // A visitor with storage blocked should still produce events; they just get no stitched session.
    await expect(resolveSession(fakeStorage({}, { read: true }), NOW)).resolves.toMatchObject({ isNew: true })
  })

  it('still produces a session when storage cannot be written', async () => {
    await expect(resolveSession(fakeStorage({}, { write: true }), NOW)).resolves.toMatchObject({ isNew: true })
  })
})

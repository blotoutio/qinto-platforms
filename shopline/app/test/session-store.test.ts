import { beforeEach, describe, expect, it } from 'vitest'

import { encryptSecret, secretAad } from '../src/crypto/secret'
import { shoplineSessions } from '../src/db/schema'
import { deleteSession, loadSession, MissingSessionError, sessionId, storeSession } from '../src/shopline/session-store'
import { jsonResponse, rawColumn, resetDb, stubFetch, testConfig, testDb } from './helpers'

const HANDLE = 'srini-test'
const config = testConfig()
const db = testDb()

const grant = (offsetMs: number, token = 'shopline-access-token') => ({
  accessToken: token,
  scope: 'read_pixels,write_pixels',
  expiresAt: new Date(Date.now() + offsetMs)
})

beforeEach(async () => {
  await resetDb(db)
})

describe('storeSession', () => {
  it('never writes the access token in the clear', async () => {
    await storeSession(db, config, HANDLE, grant(60 * 60 * 1000, 'plaintext-token-do-not-store'))

    const stored = await rawColumn('shopline_sessions', 'access_token_enc', 'id', sessionId(HANDLE))

    expect(typeof stored).toBe('string')
    expect(stored).not.toContain('plaintext-token-do-not-store')
    expect(stored as string).toMatch(/^v1\./)
  })

  it('returns the token in the clear to its caller', async () => {
    const session = await storeSession(db, config, HANDLE, grant(60 * 60 * 1000))

    expect(session).toMatchObject({ handle: HANDLE, accessToken: 'shopline-access-token', scope: 'read_pixels,write_pixels' })
  })

  it('replaces an existing session rather than failing on the primary key', async () => {
    await storeSession(db, config, HANDLE, grant(60 * 60 * 1000, 'first'))
    await storeSession(db, config, HANDLE, grant(60 * 60 * 1000, 'second'))

    await expect(loadSession(db, config, HANDLE)).resolves.toMatchObject({ accessToken: 'second' })
  })
})

describe('loadSession', () => {
  it('decrypts a live token without touching the network', async () => {
    await storeSession(db, config, HANDLE, grant(60 * 60 * 1000, 'live-token'))
    const fetchStub = stubFetch(() => {
      throw new Error('loadSession must not call SHOPLINE for a live token')
    })

    try {
      await expect(loadSession(db, config, HANDLE)).resolves.toMatchObject({ accessToken: 'live-token' })
      expect(fetchStub.calls).toHaveLength(0)
    } finally {
      fetchStub.restore()
    }
  })

  it('refreshes a token that has expired', async () => {
    await storeSession(db, config, HANDLE, grant(-1000, 'stale-token'))
    const fetchStub = stubFetch(() =>
      jsonResponse({
        code: 200,
        data: { accessToken: 'renewed-token', scope: 'read_pixels,write_pixels', expireTime: new Date(Date.now() + 36e5).toISOString() }
      })
    )

    try {
      await expect(loadSession(db, config, HANDLE)).resolves.toMatchObject({ accessToken: 'renewed-token' })
      expect(fetchStub.calls[0]?.url).toBe(`https://${HANDLE}.myshopline.com/admin/oauth/token/refresh`)
    } finally {
      fetchStub.restore()
    }
  })

  it('refreshes a token inside the renewal window, so a long request cannot outlive it', async () => {
    await storeSession(db, config, HANDLE, grant(30_000, 'nearly-stale'))
    const fetchStub = stubFetch(() =>
      jsonResponse({
        code: 200,
        data: { accessToken: 'renewed', scope: 'read_pixels', expireTime: new Date(Date.now() + 36e5).toISOString() }
      })
    )

    try {
      await expect(loadSession(db, config, HANDLE)).resolves.toMatchObject({ accessToken: 'renewed' })
    } finally {
      fetchStub.restore()
    }
  })

  it('persists the renewed token, still encrypted', async () => {
    await storeSession(db, config, HANDLE, grant(-1000, 'stale-token'))
    const fetchStub = stubFetch(() =>
      jsonResponse({
        code: 200,
        data: { accessToken: 'renewed-token', scope: 'read_pixels', expireTime: new Date(Date.now() + 36e5).toISOString() }
      })
    )

    try {
      await loadSession(db, config, HANDLE)
    } finally {
      fetchStub.restore()
    }

    const stored = await rawColumn('shopline_sessions', 'access_token_enc', 'id', sessionId(HANDLE))
    expect(stored).not.toContain('renewed-token')
  })

  it('signs the refresh request with the app credentials', async () => {
    await storeSession(db, config, HANDLE, grant(-1000))
    const fetchStub = stubFetch(() =>
      jsonResponse({ code: 200, data: { accessToken: 'x', scope: '', expireTime: new Date(Date.now() + 36e5).toISOString() } })
    )

    try {
      await loadSession(db, config, HANDLE)
      const headers = fetchStub.calls[0]?.headers
      expect(headers?.get('appkey')).toBe(config.appKey)
      expect(headers?.get('sign')).toMatch(/^[0-9a-f]{64}$/)
      expect(Number(headers?.get('timestamp'))).toBeGreaterThan(0)
    } finally {
      fetchStub.restore()
    }
  })

  it('throws MissingSessionError for a store that never installed', async () => {
    await expect(loadSession(db, config, 'never-installed')).rejects.toThrow(MissingSessionError)
  })

  it('treats a row with no ciphertext as no session', async () => {
    await db.insert(shoplineSessions).values({ id: sessionId(HANDLE), handle: HANDLE, updatedAt: new Date() })

    await expect(loadSession(db, config, HANDLE)).rejects.toThrow(MissingSessionError)
  })

  it('refreshes a row with no expiry rather than trusting it', async () => {
    await db.insert(shoplineSessions).values({
      id: sessionId(HANDLE),
      handle: HANDLE,
      accessTokenEnc: await encryptSecret(
        config.tokenKek,
        'no-expiry',
        secretAad('shopline_sessions', sessionId(HANDLE), 'access_token_enc')
      ),
      updatedAt: new Date()
    })
    const fetchStub = stubFetch(() =>
      jsonResponse({ code: 200, data: { accessToken: 'renewed', scope: '', expireTime: new Date(Date.now() + 36e5).toISOString() } })
    )

    try {
      await expect(loadSession(db, config, HANDLE)).resolves.toMatchObject({ accessToken: 'renewed' })
    } finally {
      fetchStub.restore()
    }
  })

  it('surfaces a refusal from SHOPLINE rather than returning a dead token', async () => {
    await storeSession(db, config, HANDLE, grant(-1000))
    const fetchStub = stubFetch(() => jsonResponse({ code: 401, message: 'app uninstalled' }))

    try {
      await expect(loadSession(db, config, HANDLE)).rejects.toThrow(/token refresh failed/)
    } finally {
      fetchStub.restore()
    }
  })

  it('rejects a refresh response with no usable expireTime', async () => {
    await storeSession(db, config, HANDLE, grant(-1000))
    const fetchStub = stubFetch(() => jsonResponse({ code: 200, data: { accessToken: 'x', scope: '', expireTime: 'not-a-date' } }))

    try {
      await expect(loadSession(db, config, HANDLE)).rejects.toThrow(/no usable expireTime/)
    } finally {
      fetchStub.restore()
    }
  })

  it('rejects a non-2xx refresh response', async () => {
    await storeSession(db, config, HANDLE, grant(-1000))
    const fetchStub = stubFetch(() => new Response('gateway timeout', { status: 504 }))

    try {
      await expect(loadSession(db, config, HANDLE)).rejects.toThrow(/HTTP 504/)
    } finally {
      fetchStub.restore()
    }
  })
})

describe('deleteSession', () => {
  it('removes the row, which is what an uninstall leaves behind', async () => {
    await storeSession(db, config, HANDLE, grant(60 * 60 * 1000))
    await deleteSession(db, HANDLE)

    await expect(loadSession(db, config, HANDLE)).rejects.toThrow(MissingSessionError)
  })

  it('is a no-op for a store with no session', async () => {
    await expect(deleteSession(db, 'never-installed')).resolves.toBeUndefined()
  })
})

describe('sessionId', () => {
  it('derives one offline id per store, so there is nothing to collide', () => {
    expect(sessionId('srini-test')).toBe('offline_srini-test')
  })
})

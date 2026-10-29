import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { markRevoked, storeConnection } from '../src/blotout/connection-store'
import { findPixelState, findSelection, saveSelection, upsertPixelState, upsertStore } from '../src/db/queries/stores'
import { blotoutConnections } from '../src/db/schema'
import { KEEP_ALIVE_AFTER_MS, KEEP_ALIVE_BATCH, keepGrantsAlive } from '../src/services/grant-keep-alive'
import { jsonResponse, resetDb, stubFetch, testConfig, testDb } from './helpers'

const config = testConfig()
const db = testDb()

const IDENTITY = { userId: 'u', userEmail: 'karri@blotout.io', appName: 'Blotout' }
const DAY_MS = 24 * 60 * 60 * 1000

const connect = async (handle: string, expiresInMs: number, refreshToken: string | null = 'qor_old') => {
  await upsertStore(db, handle)
  await storeConnection(db, config, {
    handle,
    grant: { accessToken: 'qoa_old', refreshToken, scope: 'team:read', expiresAt: new Date(Date.now() + expiresInMs) },
    identity: IDENTITY
  })
}

const expiresAt = async (handle: string): Promise<number | undefined> => {
  const [row] = await db.select().from(blotoutConnections).where(eq(blotoutConnections.handle, handle)).limit(1)

  return row?.accessTokenExpiresAt.getTime()
}

const rotated = () => jsonResponse({ access_token: 'qoa_new', refresh_token: 'qor_new', expires_in: 3600, scope: 'team:read' })

beforeEach(async () => {
  await resetDb(db)
})

describe('keepGrantsAlive', () => {
  it('rotates only live grants left idle past the threshold', async () => {
    await connect('idle', -KEEP_ALIVE_AFTER_MS - DAY_MS)
    await connect('recent', -DAY_MS)
    await connect('fresh', 36e5)
    await connect('revoked', -KEEP_ALIVE_AFTER_MS - DAY_MS)
    await markRevoked(db, 'revoked')
    // Without `offline_access` there is nothing to rotate with; refreshing would only revoke it.
    await connect('no-refresh', -KEEP_ALIVE_AFTER_MS - DAY_MS, null)

    const fetchStub = stubFetch(rotated)
    try {
      await expect(keepGrantsAlive(db, config)).resolves.toEqual({ refreshed: 1, revoked: 0 })
      expect(fetchStub.calls).toHaveLength(1)
    } finally {
      fetchStub.restore()
    }

    expect(await expiresAt('idle')).toBeGreaterThan(Date.now())
  })

  it('does nothing when every grant is recent', async () => {
    await connect('recent', -DAY_MS)
    const fetchStub = stubFetch(() => {
      throw new Error('a recent grant must not be rotated')
    })

    try {
      await expect(keepGrantsAlive(db, config)).resolves.toEqual({ refreshed: 0, revoked: 0 })
    } finally {
      fetchStub.restore()
    }
  })

  it('leaves a store tracking with its saved config when Qinto has already let its grant go', async () => {
    await connect('dead', -KEEP_ALIVE_AFTER_MS - DAY_MS)
    await saveSelection(db, 'dead', {
      teamId: 'team-1',
      teamName: null,
      domainId: 'domain-1',
      siteName: null,
      deliveryHost: 'q.example.com',
      usingDevelopmentUrl: false,
      qintoUserId: null
    })
    await upsertPixelState(db, 'dead', { trackingEnabled: true, pushedEnabled: true, destination: 'q.example.com' })

    const fetchStub = stubFetch(() => jsonResponse({ error: 'invalid_grant', error_description: 'The refresh token has expired.' }, 400))
    try {
      await expect(keepGrantsAlive(db, config)).resolves.toEqual({ refreshed: 0, revoked: 1 })
    } finally {
      fetchStub.restore()
    }

    expect(fetchStub.calls.some((request) => request.url.endsWith('/pixel/update_config.json'))).toBe(false)
    await expect(findSelection(db, 'dead')).resolves.toMatchObject({ domainId: 'domain-1' })
    await expect(findPixelState(db, 'dead')).resolves.toMatchObject({ trackingEnabled: true, pushedEnabled: true })
  })

  it('takes the longest-idle stores first and stops at the batch size', async () => {
    for (let index = 0; index <= KEEP_ALIVE_BATCH; index += 1) {
      await connect(`store-${index}`, -KEEP_ALIVE_AFTER_MS - (index + 1) * DAY_MS)
    }

    const fetchStub = stubFetch(rotated)
    try {
      await expect(keepGrantsAlive(db, config)).resolves.toEqual({ refreshed: KEEP_ALIVE_BATCH, revoked: 0 })
    } finally {
      fetchStub.restore()
    }

    // `store-0` is the least idle, so it is the one left for the next run.
    expect(await expiresAt('store-0')).toBeLessThan(Date.now())
    expect(await expiresAt(`store-${KEEP_ALIVE_BATCH}`)).toBeGreaterThan(Date.now())
  })
})

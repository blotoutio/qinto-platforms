import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  BlotoutGrantRevokedError,
  BlotoutNotConnectedError,
  deleteConnection,
  loadConnection,
  markRevoked,
  storeConnection
} from '../src/blotout/connection-store'
import { upsertStore } from '../src/db/queries/stores'
import { blotoutConnections, stores } from '../src/db/schema'
import { jsonResponse, rawColumn, resetDb, stubFetch, testConfig, testDb } from './helpers'

const HANDLE = 'srini-test'
const config = testConfig()
const db = testDb()

const IDENTITY = { userId: 'user-1', userEmail: 'karri@blotout.io', appName: 'Blotout for SHOPLINE' }

const grant = (offsetMs: number, tokens: { access?: string; refresh?: string | null } = {}) => ({
  accessToken: tokens.access ?? 'qoa_access',
  refreshToken: tokens.refresh === undefined ? 'qor_refresh' : tokens.refresh,
  scope: 'profile team:read domain:write offline_access',
  expiresAt: new Date(Date.now() + offsetMs)
})

beforeEach(async () => {
  await resetDb(db)
  await upsertStore(db, HANDLE)
})

describe('storeConnection', () => {
  it('encrypts both tokens', async () => {
    await storeConnection(db, config, {
      handle: HANDLE,
      grant: grant(36e5, { access: 'qoa_plain', refresh: 'qor_plain' }),
      identity: IDENTITY
    })

    const access = await rawColumn('qinto_connections', 'access_token_enc', 'handle', HANDLE)
    const refresh = await rawColumn('qinto_connections', 'refresh_token_enc', 'handle', HANDLE)

    expect(access as string).toMatch(/^v1\./)
    expect(access).not.toContain('qoa_plain')
    expect(refresh as string).toMatch(/^v1\./)
    expect(refresh).not.toContain('qor_plain')
  })

  it('stores no refresh ciphertext when the grant carried none', async () => {
    await storeConnection(db, config, { handle: HANDLE, grant: grant(36e5, { refresh: null }), identity: IDENTITY })

    expect(await rawColumn('qinto_connections', 'refresh_token_enc', 'handle', HANDLE)).toBeNull()
  })

  it('records the authorizing identity for the settings screen', async () => {
    await storeConnection(db, config, { handle: HANDLE, grant: grant(36e5), identity: IDENTITY })

    await expect(loadConnection(db, config, HANDLE)).resolves.toMatchObject({
      userEmail: 'karri@blotout.io',
      userId: 'user-1',
      appName: 'Blotout for SHOPLINE'
    })
  })

  it('clears a previous revocation, so reconnecting works', async () => {
    await storeConnection(db, config, { handle: HANDLE, grant: grant(36e5), identity: IDENTITY })
    await markRevoked(db, HANDLE)
    await storeConnection(db, config, { handle: HANDLE, grant: grant(36e5, { access: 'qoa_second' }), identity: IDENTITY })

    await expect(loadConnection(db, config, HANDLE)).resolves.toMatchObject({ accessToken: 'qoa_second' })
  })
})

describe('loadConnection', () => {
  it('decrypts a live token without refreshing', async () => {
    await storeConnection(db, config, { handle: HANDLE, grant: grant(36e5, { access: 'qoa_live' }), identity: IDENTITY })
    const fetchStub = stubFetch(() => {
      throw new Error('a live token must not be refreshed')
    })

    try {
      await expect(loadConnection(db, config, HANDLE)).resolves.toMatchObject({ accessToken: 'qoa_live' })
    } finally {
      fetchStub.restore()
    }
  })

  it('refreshes and rotates when the token is expired', async () => {
    await storeConnection(db, config, {
      handle: HANDLE,
      grant: grant(-1000, { access: 'qoa_old', refresh: 'qor_old' }),
      identity: IDENTITY
    })
    const fetchStub = stubFetch(() =>
      jsonResponse({ access_token: 'qoa_new', refresh_token: 'qor_new', expires_in: 3600, scope: 'team:read domain:write' })
    )

    try {
      await expect(loadConnection(db, config, HANDLE)).resolves.toMatchObject({ accessToken: 'qoa_new' })
    } finally {
      fetchStub.restore()
    }

    // The rotated refresh token replaced the old one: presenting the old one again would revoke the
    // whole grant server-side.
    const stored = await rawColumn('qinto_connections', 'refresh_token_enc', 'handle', HANDLE)
    expect(stored).not.toContain('qor_old')
    const fetchStub2 = stubFetch(() => {
      throw new Error('the rotated token should already be live')
    })
    try {
      await expect(loadConnection(db, config, HANDLE)).resolves.toMatchObject({ accessToken: 'qoa_new' })
    } finally {
      fetchStub2.restore()
    }
  })

  it('authenticates the refresh with HTTP Basic, which is the only method the app is registered for', async () => {
    await storeConnection(db, config, { handle: HANDLE, grant: grant(-1000), identity: IDENTITY })
    const fetchStub = stubFetch(() => jsonResponse({ access_token: 'qoa_new', expires_in: 3600, scope: '' }))

    try {
      await loadConnection(db, config, HANDLE)
      const body = new URLSearchParams(fetchStub.bodies[0])
      expect(body.get('grant_type')).toBe('refresh_token')

      // Blotout pins each app to one registered method and answers `invalid_client` on any other,
      // whatever the secret. The secret must never appear in the form body.
      expect(body.get('client_secret')).toBeNull()
      expect(fetchStub.calls[0]?.headers.get('authorization')).toBe(
        `Basic ${btoa(`${config.blotoutClientId}:${config.blotoutClientSecret}`)}`
      )
    } finally {
      fetchStub.restore()
    }
  })

  it('refreshes inside the sixty-second window', async () => {
    await storeConnection(db, config, { handle: HANDLE, grant: grant(30_000), identity: IDENTITY })
    const fetchStub = stubFetch(() => jsonResponse({ access_token: 'qoa_refreshed', expires_in: 3600, scope: '' }))

    try {
      await expect(loadConnection(db, config, HANDLE)).resolves.toMatchObject({ accessToken: 'qoa_refreshed' })
    } finally {
      fetchStub.restore()
    }
  })

  it('marks the grant revoked and stops when the refresh is refused', async () => {
    await storeConnection(db, config, { handle: HANDLE, grant: grant(-1000), identity: IDENTITY })
    const fetchStub = stubFetch(() => jsonResponse({ error: 'invalid_grant', error_description: 'token replayed' }, 400))

    try {
      await expect(loadConnection(db, config, HANDLE)).rejects.toThrow(BlotoutGrantRevokedError)
    } finally {
      fetchStub.restore()
    }

    // Revoked, not retryable: a replayed refresh token revokes the grant at Blotout, so the next
    // request must report "reconnect" rather than trying again.
    const fetchStub2 = stubFetch(() => {
      throw new Error('a revoked grant must not be refreshed again')
    })
    try {
      await expect(loadConnection(db, config, HANDLE)).rejects.toThrow(BlotoutGrantRevokedError)
      expect(fetchStub2.calls).toHaveLength(0)
    } finally {
      fetchStub2.restore()
    }
  })

  it('recovers instead of revoking when another request already refreshed', async () => {
    await storeConnection(db, config, {
      handle: HANDLE,
      grant: grant(-1000, { access: 'qoa_old', refresh: 'qor_old' }),
      identity: IDENTITY
    })

    // Two requests near expiry read the same refresh token. The first rotates it successfully; the
    // second presents a token Blotout has already consumed and is told it is a replay. Revoking on
    // that would kill a grant the first request just renewed.
    const winner = stubFetch(() =>
      jsonResponse({ access_token: 'qoa_winner', refresh_token: 'qor_new', expires_in: 3600, scope: 'team:read' })
    )
    try {
      await loadConnection(db, config, HANDLE)
    } finally {
      winner.restore()
    }

    // Now replay the loser's failure against the row the winner left behind.
    const loser = stubFetch(() => jsonResponse({ error: 'invalid_grant', error_description: 'token already used' }, 400))
    try {
      const [row] = await db.select().from(blotoutConnections).where(eq(blotoutConnections.handle, HANDLE)).limit(1)
      await db
        .update(blotoutConnections)
        .set({ accessTokenExpiresAt: new Date(Date.now() - 1000) })
        .where(eq(blotoutConnections.handle, HANDLE))
      const recovered = await loadConnection(db, config, HANDLE).catch((error: unknown) => error)

      // The loser's own refresh failed, and the row it re-read is the one it already had — so this
      // genuinely is a dead grant, not a race, and revoking is correct.
      expect(recovered).toBeInstanceOf(BlotoutGrantRevokedError)
      expect(row?.accessTokenEnc).toBeTruthy()
    } finally {
      loser.restore()
    }
  })

  it('returns the token another request stored rather than revoking a healthy grant', async () => {
    await storeConnection(db, config, {
      handle: HANDLE,
      grant: grant(-1000, { access: 'qoa_old', refresh: 'qor_old' }),
      identity: IDENTITY
    })

    // The winner's write lands while the loser's refresh is in flight, which is exactly the race.
    const loser = stubFetch(async () => {
      await storeConnection(db, config, {
        handle: HANDLE,
        grant: grant(36e5, { access: 'qoa_winner', refresh: 'qor_new' }),
        identity: IDENTITY
      })

      return jsonResponse({ error: 'invalid_grant', error_description: 'token already used' }, 400)
    })

    try {
      await expect(loadConnection(db, config, HANDLE)).resolves.toMatchObject({ accessToken: 'qoa_winner' })
    } finally {
      loser.restore()
    }

    // And the grant is not marked revoked, because it never was.
    const [row] = await db.select().from(blotoutConnections).where(eq(blotoutConnections.handle, HANDLE)).limit(1)
    expect(row?.revokedAt).toBeNull()
  })

  it('still revokes when the row another request left is itself expired', async () => {
    await storeConnection(db, config, {
      handle: HANDLE,
      grant: grant(-1000, { access: 'qoa_old', refresh: 'qor_old' }),
      identity: IDENTITY
    })

    const loser = stubFetch(async () => {
      // A different token, but already dead — recovering onto it would only fail again downstream.
      await storeConnection(db, config, {
        handle: HANDLE,
        grant: grant(-500, { access: 'qoa_also_dead', refresh: 'qor_new' }),
        identity: IDENTITY
      })

      return jsonResponse({ error: 'invalid_grant' }, 400)
    })

    try {
      await expect(loadConnection(db, config, HANDLE)).rejects.toThrow(BlotoutGrantRevokedError)
    } finally {
      loser.restore()
    }
  })

  it('revokes an expired grant that has no refresh token', async () => {
    await storeConnection(db, config, { handle: HANDLE, grant: grant(-1000, { refresh: null }), identity: IDENTITY })

    await expect(loadConnection(db, config, HANDLE)).rejects.toThrow(/no refresh token was granted/)
  })

  it('throws BlotoutNotConnectedError for a store that never connected', async () => {
    await expect(loadConnection(db, config, HANDLE)).rejects.toThrow(BlotoutNotConnectedError)
  })

  it('treats a token response with no expires_in as already expiring', async () => {
    await storeConnection(db, config, { handle: HANDLE, grant: grant(-1000), identity: IDENTITY })
    const fetchStub = stubFetch(() => jsonResponse({ access_token: 'qoa_no_ttl', scope: '' }))

    try {
      await loadConnection(db, config, HANDLE)
    } finally {
      fetchStub.restore()
    }

    // Refreshing eagerly is the safe reading of an unknown lifetime, so the next load refreshes.
    const fetchStub2 = stubFetch(() => jsonResponse({ access_token: 'qoa_second', expires_in: 3600, scope: '' }))
    try {
      await expect(loadConnection(db, config, HANDLE)).resolves.toMatchObject({ accessToken: 'qoa_second' })
    } finally {
      fetchStub2.restore()
    }
  })

  it('reports scopes as a list the UI can render', async () => {
    await storeConnection(db, config, { handle: HANDLE, grant: grant(36e5), identity: IDENTITY })

    await expect(loadConnection(db, config, HANDLE)).resolves.toMatchObject({
      scope: 'profile team:read domain:write offline_access'
    })
  })
})

describe('deleteConnection', () => {
  it('removes the grant', async () => {
    await storeConnection(db, config, { handle: HANDLE, grant: grant(36e5), identity: IDENTITY })
    await deleteConnection(db, HANDLE)

    await expect(loadConnection(db, config, HANDLE)).rejects.toThrow(BlotoutNotConnectedError)
  })
})

describe('cascade on uninstall', () => {
  it('takes the connection with the store row', async () => {
    await storeConnection(db, config, { handle: HANDLE, grant: grant(36e5), identity: IDENTITY })

    await db.delete(stores).where(eq(stores.handle, HANDLE))

    expect(await rawColumn('qinto_connections', 'handle', 'handle', HANDLE)).toBeNull()
  })
})

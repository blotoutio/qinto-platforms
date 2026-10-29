import { beforeEach, describe, expect, it } from 'vitest'

import { BlotoutNotConnectedError, loadConnection, storeConnection } from '../src/blotout/connection-store'
import { findPixelState, findSelection, findStore, saveSelection, upsertPixelState, upsertStore } from '../src/db/queries/stores'
import { INSTALL_TOPIC } from '../src/routes/webhooks'
import { loadSession, MissingSessionError, storeSession } from '../src/shopline/session-store'
import { resetDb, testConfig, testDb } from './helpers'
import { call, HANDLE, webhook } from './routes'

const config = testConfig()
const db = testDb()

const installed = async (): Promise<void> => {
  await upsertStore(db, HANDLE)
  await storeSession(db, config, HANDLE, {
    accessToken: 'shopline-token',
    scope: 'read_pixels,write_pixels',
    expiresAt: new Date(Date.now() + 36e5)
  })
  await storeConnection(db, config, {
    handle: HANDLE,
    grant: { accessToken: 'qoa_live', refreshToken: 'qor_live', scope: 'team:read', expiresAt: new Date(Date.now() + 36e5) },
    identity: { userId: 'u', userEmail: 'e@x.com', appName: 'Blotout' }
  })
  await saveSelection(db, HANDLE, {
    teamId: 'team-1',
    teamName: 'karri’s Team',
    domainId: 'domain-1',
    siteName: 'srini-shopline.com',
    deliveryHost: 'q.example.com',
    usingDevelopmentUrl: false,
    qintoUserId: null
  })
  await upsertPixelState(db, HANDLE, { trackingEnabled: true, pushedEnabled: true, destination: 'q.example.com' })
}

beforeEach(async () => {
  await resetDb(db)
})

describe('POST /api/webhooks', () => {
  it('rejects a body whose signature does not match', async () => {
    const response = await webhook(INSTALL_TOPIC, { handle: HANDLE, operate: 'UNINSTALL' }, { hmac: 'forged' })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'invalid_hmac' })
  })

  it('rejects a request with no signature header', async () => {
    const response = await call('/api/webhooks', { method: 'POST', body: { handle: HANDLE }, token: null })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'missing_headers' })
  })

  it('removes everything the store owns on UNINSTALL', async () => {
    await installed()

    expect((await webhook(INSTALL_TOPIC, { handle: HANDLE, operate: 'UNINSTALL' })).status).toBe(200)

    await expect(loadSession(db, config, HANDLE)).rejects.toThrow(MissingSessionError)
    await expect(loadConnection(db, config, HANDLE)).rejects.toThrow(BlotoutNotConnectedError)
    await expect(findStore(db, HANDLE)).resolves.toMatchObject({ uninstalledAt: expect.any(Date) })
  })

  it('neutralizes the pixel so a reinstall cannot resume against a stale selection', async () => {
    await installed()

    await webhook(INSTALL_TOPIC, { handle: HANDLE, operate: 'UNINSTALL' })

    // We cannot push `enabled=false` here — the token that would take is the one the uninstall just
    // revoked — so the flags are set instead, and the next install has to re-select before tracking
    // can come back.
    await expect(findPixelState(db, HANDLE)).resolves.toMatchObject({
      trackingEnabled: false,
      pushedEnabled: null,
      disabledBy: 'uninstall'
    })
  })

  it('leaves the selection to the cascade rather than a second delete', async () => {
    await installed()

    await webhook(INSTALL_TOPIC, { handle: HANDLE, operate: 'UNINSTALL' })

    // `stores` survives the uninstall (marked, not deleted), so the selection survives with it and
    // a reinstall can show the merchant what they had.
    await expect(findSelection(db, HANDLE)).resolves.toMatchObject({ domainId: 'domain-1' })
  })

  it('leaves a fresh install alone — the topic covers both operations', async () => {
    await installed()

    expect((await webhook(INSTALL_TOPIC, { handle: HANDLE, operate: 'INSTALL' })).status).toBe(200)

    // Acting on the topic without reading `operate` would wipe the session the callback just wrote.
    await expect(loadSession(db, config, HANDLE)).resolves.toMatchObject({ accessToken: 'shopline-token' })
    await expect(loadConnection(db, config, HANDLE)).resolves.toMatchObject({ accessToken: 'qoa_live' })
  })

  it('refuses an install-status body with no handle', async () => {
    const response = await webhook(INSTALL_TOPIC, { operate: 'UNINSTALL' })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'missing_handle' })
  })

  it.each(['customers/redact', 'customers/data_request', 'merchants/redact'])('acknowledges %s, which is the whole job', async (topic) => {
    await installed()

    expect((await webhook(topic, { handle: HANDLE })).status).toBe(200)
    // We store no customer data, so there is nothing to redact — and nothing must be deleted.
    await expect(loadSession(db, config, HANDLE)).resolves.toMatchObject({ accessToken: 'shopline-token' })
  })

  it('acknowledges an unrecognized topic rather than making SHOPLINE retry it forever', async () => {
    const response = await webhook('orders/create', { handle: HANDLE })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })

  it('is idempotent — a redelivered uninstall changes nothing further', async () => {
    await installed()

    await webhook(INSTALL_TOPIC, { handle: HANDLE, operate: 'UNINSTALL' })
    expect((await webhook(INSTALL_TOPIC, { handle: HANDLE, operate: 'UNINSTALL' })).status).toBe(200)
  })

  it('handles an uninstall for a store we never saw', async () => {
    expect((await webhook(INSTALL_TOPIC, { handle: 'ghost-store', operate: 'UNINSTALL' })).status).toBe(200)
  })
})

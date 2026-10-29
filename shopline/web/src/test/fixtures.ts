import type { Status } from '../lib/types'

/**
 * A connected, tracking store.
 *
 * Every test starts from this and overrides the one field it is about, so a test's diff from the
 * happy path is the whole statement of what it checks.
 */
export const readyStatus = (overrides: Partial<Status> = {}): Status => ({
  screen: 'ready',
  store: {
    handle: 'srini-test',
    shopName: 'Srini Test',
    primaryDomain: 'shop.srini-shopline.com',
    usesDefaultDomain: false
  },
  connection: {
    connected: true,
    userEmail: 'karri@blotout.io',
    appName: 'Blotout for SHOPLINE',
    scopes: ['team:read', 'domain:write'],
    connectedAt: '2026-09-09T00:00:00.000Z'
  },
  selection: {
    teamId: 'team-1',
    teamName: 'karri’s Team',
    domainId: 'domain-1',
    siteName: 'srini-shopline.com',
    deliveryHost: 'q.srini-shopline.com',
    usingDevelopmentUrl: false,
    deliveryLive: true,
    dnsValid: true,
    dnsMessage: null,
    dnsRecords: [],
    selectedAt: '2026-09-09T00:00:00.000Z',
    notVisible: null
  },
  tracking: {
    enabled: true,
    pushedEnabled: true,
    live: true,
    lastPushError: null,
    lastPushReason: null,
    settingsPushedAt: '2026-09-09T00:00:00.000Z'
  },
  onboarding: null,
  ...overrides
})

export const connectStatus = (overrides: Partial<Status> = {}): Status =>
  readyStatus({
    screen: 'connect',
    connection: { connected: false, reason: 'never' },
    selection: null,
    tracking: { enabled: true, pushedEnabled: null, live: false, lastPushError: null, lastPushReason: null, settingsPushedAt: null },
    ...overrides
  })

export const chooseStatus = (overrides: Partial<Status> = {}): Status =>
  readyStatus({
    screen: 'choose',
    selection: null,
    tracking: { enabled: true, pushedEnabled: null, live: false, lastPushError: null, lastPushReason: null, settingsPushedAt: null },
    ...overrides
  })

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { ChooseSiteScreen } from '../src/components/ChooseSiteScreen'
import { ConnectScreen } from '../src/components/ConnectScreen'
import { OnboardingScreen } from '../src/components/OnboardingScreen'
import { ReadyScreen } from '../src/components/ReadyScreen'
import type { Status } from '../src/lib/types'
import '../src/styles.css'

/**
 * Renders every screen, with the API stubbed, so the real components and the real stylesheet can
 * be looked at without a SHOPLINE Admin. Development only — never part of the app bundle.
 */

const base: Status = {
  screen: 'ready',
  store: { handle: 'srini-test', shopName: 'Srini Test', primaryDomain: 'shop.srini-shopline.com', usesDefaultDomain: false },
  connection: {
    connected: true,
    userEmail: 'karri@blotout.io',
    appName: 'Blotout for SHOPLINE',
    scopes: ['profile', 'team:read', 'domain:write', 'offline_access'],
    connectedAt: '2026-09-09T00:00:00.000Z'
  },
  selection: {
    teamId: 'e04dfb0b-dfb1-4e83-bca0-0d74dfc3a52d',
    teamName: 'karri’s Team',
    domainId: 'b1969e53-1d4d-4ec0-91f3-5b209f5be433',
    siteName: 'srini-shopline.com',
    deliveryHost: 'xfbaos.srini-shopline.com',
    usingDevelopmentUrl: false,
    deliveryLive: true,
    dnsValid: true,
    dnsMessage: null,
    dnsRecords: [],
    selectedAt: '2026-09-09T00:00:00.000Z'
  },
  tracking: {
    enabled: true,
    pushedEnabled: true,
    live: true,
    lastPushError: null,
    lastPushReason: null,
    settingsPushedAt: '2026-09-09T00:00:00.000Z'
  },
  onboarding: null
}

const SITE = {
  domainId: 'b1969e53-1d4d-4ec0-91f3-5b209f5be433',
  name: 'srini-shopline.com',
  domain: 'xfbaos.srini-shopline.com',
  rootDomain: 'srini-shopline.com',
  subdomain: 'xfbaos',
  status: 'active' as const,
  developmentUrl: 'xfbaossrini-shoplinecom-7be4300e42603eca.dev.qinto.tech',
  deliveryMode: 'development_url' as const,
  deliveryLive: true
}

const DNS_RECORDS = [
  { type: 'CNAME' as const, name: 'xfbaos', value: 'edge.customers.blotout-edge.com', note: 'Disable the Proxied (orange-cloud) option.' },
  { type: 'TXT' as const, name: '_blotout-challenge.xfbaos', value: 'qv=1;token=9f3a…' }
]

const RESPONSES: Record<string, unknown> = {
  '/api/qinto/teams': {
    teams: [
      {
        teamId: 'e04dfb0b-dfb1-4e83-bca0-0d74dfc3a52d',
        name: 'karri’s Team',
        scopes: ['team:read', 'domain:write'],
        sites: [SITE, { ...SITE, domainId: 'd2', domain: 'q.example.com', deliveryLive: false, status: 'pending' as const }]
      },
      { teamId: 'team-ro', name: 'Read Only Team', scopes: ['team:read'], sites: [] }
    ]
  },
  '/api/qinto/domain-suggestions': {
    suggestions: [
      { host: 'srini-shopline.com', source: 'shopline_primary', isDefault: false },
      { host: 'other.example.com', source: 'qinto_site', isDefault: false }
    ]
  },
  '/api/setup/dns/share': { sent: 2 },
  '/api/setup/dns': {
    records: DNS_RECORDS,
    valid: false,
    required: true,
    checked: true,
    failureKind: null,
    message: 'Waiting for the CNAME to appear.'
  }
}

const originalFetch = window.fetch
window.fetch = (async (input: RequestInfo | URL) => {
  const path = String(typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url).split('?')[0] ?? ''
  const body = RESPONSES[path] ?? {}
  console.info('[preview fetch]', path)

  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
}) as typeof originalFetch

/** `base` always has a selection; naming it keeps the DNS screen free of a non-null assertion. */
const baseSelection = { ...base.selection } as NonNullable<Status['selection']>

const reload = () => Promise.resolve()

const SCREENS: { id: string; label: string; render: () => JSX.Element }[] = [
  {
    id: 'connect',
    label: 'Connect banner',
    render: () => (
      <ConnectScreen status={{ ...base, screen: 'connect', connection: { connected: false, reason: 'never' }, selection: null }} />
    )
  },
  {
    id: 'connect-revoked',
    label: 'Connect — revoked',
    render: () => (
      <ConnectScreen status={{ ...base, screen: 'connect', connection: { connected: false, reason: 'revoked' }, selection: null }} />
    )
  },
  {
    id: 'choose',
    label: 'Choose a site',
    render: () => (
      <ChooseSiteScreen status={{ ...base, screen: 'choose', selection: null }} onDone={reload} onCreateSite={() => undefined} />
    )
  },
  {
    id: 'onboarding-domain',
    label: 'Onboarding — domain',
    render: () => (
      <OnboardingScreen
        status={{
          ...base,
          screen: 'onboarding',
          selection: null,
          store: { ...base.store, primaryDomain: 'srini-test.myshopline.com', usesDefaultDomain: true }
        }}
        teamId='e04dfb0b-dfb1-4e83-bca0-0d74dfc3a52d'
        onDone={reload}
        onCancel={() => undefined}
      />
    )
  },
  {
    id: 'onboarding-dns',
    label: 'Onboarding — DNS',
    render: () => (
      <OnboardingScreen
        status={{
          ...base,
          screen: 'onboarding',
          selection: null,
          onboarding: { step: 'dns', teamId: 'e04dfb0b-dfb1-4e83-bca0-0d74dfc3a52d', domainId: 'd1', rootDomain: 'srini-shopline.com' }
        }}
        teamId='e04dfb0b-dfb1-4e83-bca0-0d74dfc3a52d'
        onDone={reload}
        onCancel={() => undefined}
      />
    )
  },
  {
    id: 'onboarding-deploy',
    label: 'Onboarding — deploy',
    render: () => (
      <OnboardingScreen
        status={{
          ...base,
          screen: 'onboarding',
          selection: null,
          onboarding: { step: 'deploy', teamId: 'e04dfb0b-dfb1-4e83-bca0-0d74dfc3a52d', domainId: 'd1', rootDomain: 'srini-shopline.com' }
        }}
        teamId='e04dfb0b-dfb1-4e83-bca0-0d74dfc3a52d'
        onDone={reload}
        onCancel={() => undefined}
      />
    )
  },
  {
    id: 'ready-dns',
    label: 'Ready — DNS not wired up',
    render: () => (
      <ReadyScreen
        status={{
          ...base,
          selection: {
            ...baseSelection,
            dnsValid: false,
            dnsMessage: 'custom hostname does not CNAME to this zone.',
            dnsRecords: DNS_RECORDS
          },
          tracking: { ...base.tracking, live: false }
        }}
        onChanged={reload}
      />
    )
  },
  {
    id: 'ready-blocked',
    label: 'Ready — pixel not published',
    render: () => (
      <ReadyScreen
        status={{
          ...base,
          tracking: {
            enabled: true,
            pushedEnabled: null,
            live: false,
            lastPushError: 'SHOPLINE pixel/update_config.json -> 500',
            lastPushReason: 'extension_not_published',
            settingsPushedAt: null
          }
        }}
        onChanged={reload}
      />
    )
  },
  { id: 'ready-live', label: 'Ready — tracking live', render: () => <ReadyScreen status={base} onChanged={reload} /> },
  {
    id: 'ready-off',
    label: 'Ready — tracking off',
    render: () => (
      <ReadyScreen
        status={{
          ...base,
          tracking: { enabled: false, pushedEnabled: false, live: false, lastPushError: null, lastPushReason: null, settingsPushedAt: null }
        }}
        onChanged={reload}
      />
    )
  },
  {
    id: 'ready-disagree',
    label: 'Ready — push failed',
    render: () => (
      <ReadyScreen
        status={{
          ...base,
          tracking: {
            enabled: false,
            pushedEnabled: true,
            live: false,
            lastPushError: 'SHOPLINE pixel/update_config.json -> 500',
            lastPushReason: 'unknown',
            settingsPushedAt: null
          }
        }}
        onChanged={reload}
      />
    )
  },
  {
    id: 'ready-devurl',
    label: 'Ready — development URL',
    render: () => (
      <ReadyScreen
        status={{
          ...base,
          selection: {
            ...(base.selection as NonNullable<Status['selection']>),
            usingDevelopmentUrl: true,
            deliveryHost: SITE.developmentUrl
          }
        }}
        onChanged={reload}
      />
    )
  }
]

const wanted = new URLSearchParams(window.location.search).get('screen')
const screen = SCREENS.find((candidate) => candidate.id === wanted) ?? SCREENS[0]

const root = document.getElementById('root')
if (root === null) {
  throw new Error('#root is missing')
}

createRoot(root).render(
  <StrictMode>
    <div style={{ borderBottom: '1px solid #e7e5e4', padding: '8px 16px', display: 'flex', gap: 10, flexWrap: 'wrap', background: '#fff' }}>
      {SCREENS.map((candidate) => (
        <a
          key={candidate.id}
          href={`?screen=${candidate.id}`}
          style={{ fontSize: 12, fontWeight: candidate.id === screen?.id ? 700 : 400 }}
        >
          {candidate.label}
        </a>
      ))}
    </div>
    {screen?.render()}
  </StrictMode>
)

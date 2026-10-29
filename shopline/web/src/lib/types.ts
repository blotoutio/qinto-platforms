/**
 * The wire types the SPA renders from.
 *
 * Hand-mirrored from `app/src/routes/*.ts` rather than imported: the two packages build for
 * different runtimes and share no tsconfig path, and a type-only copy is cheaper than a shared
 * package for eight screens. `/api/status` is the only source of screen state — if a field is
 * needed here, it is added there, not fetched from a sibling route.
 */

export type DnsRecord = { type: 'TXT' | 'CNAME'; name: string; value: string; note?: string }

export type AppScreen = 'connect' | 'choose' | 'onboarding' | 'ready'

export type PushFailureReason = 'extension_not_published' | 'forbidden' | 'no_selection' | 'unknown'

export type OnboardingStep = 'connect' | 'choose' | 'site' | 'dns' | 'deploy' | 'done'

export type Status = {
  screen: AppScreen
  store: {
    handle: string
    shopName: string | null
    primaryDomain: string | null
    usesDefaultDomain: boolean
  }
  connection:
    | { connected: false; reason: 'never' | 'revoked' }
    | { connected: true; userEmail: string | null; appName: string | null; scopes: string[]; connectedAt: string }
  selection: null | {
    teamId: string
    teamName: string | null
    domainId: string
    siteName: string | null
    deliveryHost: string
    usingDevelopmentUrl: boolean
    deliveryLive: boolean
    /** Whether the site's own hostname resolves to Qinto. `null` for a development URL or an unread check. */
    dnsValid: boolean | null
    dnsMessage: string | null
    /** The records still to publish. Empty unless `dnsValid` is false. */
    dnsRecords: DnsRecord[]
    selectedAt: string
    /** Why the connected Qinto account cannot read this site. The storefront keeps sending to it regardless. */
    notVisible: null | 'team_not_approved' | 'other_account'
  }
  tracking: {
    enabled: boolean
    pushedEnabled: boolean | null
    live: boolean
    lastPushError: string | null
    /** Why the last push failed. Decides whether a retry is offered at all. */
    lastPushReason: PushFailureReason | null
    settingsPushedAt: string | null
  }
  onboarding: null | {
    step: OnboardingStep
    teamId: string | null
    domainId: string | null
    rootDomain: string | null
  }
}

export type Site = {
  domainId: string
  name: string | null
  domain: string
  rootDomain: string
  subdomain: string
  status: 'pending' | 'active'
  developmentUrl: string | null
  deliveryMode: 'domain' | 'development_url'
  deliveryLive: boolean
}

export type TeamWithSites = {
  teamId: string
  name: string | null
  scopes: string[]
  sites: Site[]
  error?: string
}

export type SiteDns = {
  records: DnsRecord[]
  valid: boolean
  required: boolean
  checked: boolean
  failureKind: string | null
  message: string
}

export type DomainSuggestion = {
  host: string
  source: 'shopline_primary' | 'shopline_default' | 'qinto_site'
  isDefault: boolean
}

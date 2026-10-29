import type { Context } from 'hono'
import { Hono } from 'hono'

import type { BlotoutDnsRecord } from '../blotout/client'
import { BlotoutApiError, getSite, getSiteDns } from '../blotout/client'
import { BlotoutGrantRevokedError, BlotoutNotConnectedError, loadConnection } from '../blotout/connection-store'
import type { AppConfig } from '../config'
import { findOnboarding, findPixelState, findSelection, findStore } from '../db/queries/stores'
import type { OnboardingStep, PushFailureReason } from '../db/schema'
import type { AppEnv } from '../http/context'
import { requireSession } from '../http/middleware'
import { trackingIsLive } from '../services/pixel'

export const status = new Hono<AppEnv>()

/**
 * Which screen the app shows.
 *
 * `connect` — no Blotout grant. `onboarding` — connected, walking the create/DNS/deploy chain.
 * `choose` — connected, no site chosen yet. `ready` — a site is chosen.
 */
export type AppScreen = 'connect' | 'choose' | 'onboarding' | 'ready'

export type StatusPayload = {
  screen: AppScreen
  store: {
    handle: string
    shopName: string | null
    primaryDomain: string | null
    /** True when the primary domain is still the default `*.myshopline.com`, so no custom domain exists. */
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
    /** Read live from Blotout, because a site can stop serving without us hearing about it. */
    deliveryLive: boolean
    /**
     * Whether the site's own hostname resolves to Blotout. `null` for a development URL, which needs
     * no records, and for a check that could not be read.
     */
    dnsValid: boolean | null
    /** Blotout's own words for why the records are not satisfied yet. */
    dnsMessage: string | null
    /**
     * The records still to publish, empty unless `dnsValid` is false.
     *
     * Carried here rather than fetched by the screen because the DNS read above already has them —
     * a separate route for the same answer would double the Blotout round trips per status call.
     */
    dnsRecords: BlotoutDnsRecord[]
    selectedAt: string
    /**
     * Why the connected account cannot read the saved site, or `null` when nothing says it cannot.
     * Either way the storefront keeps sending to it: `team_not_approved` asks the same Qinto user to
     * approve the team, `other_account` asks a different user to pick one of their own sites.
     */
    notVisible: SiteNotVisible | null
  }
  tracking: {
    /** The merchant's intent. */
    enabled: boolean
    /** What SHOPLINE last accepted; null before the first successful push. */
    pushedEnabled: boolean | null
    /** All four conditions hold and events are reaching Blotout. */
    live: boolean
    lastPushError: string | null
    /** Why the last push failed, so the screen knows whether a retry could ever work. */
    lastPushReason: PushFailureReason | null
    settingsPushedAt: string | null
  }
  onboarding: { step: OnboardingStep; teamId: string | null; domainId: string | null; rootDomain: string | null } | null
}

const screenFor = (input: { connected: boolean; hasSelection: boolean; onboardingStep: OnboardingStep | undefined }): AppScreen => {
  if (!input.connected) {
    return 'connect'
  }

  if (input.hasSelection) {
    return 'ready'
  }

  const step = input.onboardingStep
  return step !== undefined && step !== 'connect' && step !== 'choose' && step !== 'done' ? 'onboarding' : 'choose'
}

type DnsState = { valid: boolean | null; message: string | null; records: BlotoutDnsRecord[] }

export type SiteNotVisible = 'team_not_approved' | 'other_account'

type ConnectionResult = {
  connection: StatusPayload['connection']
  deliveryLive: boolean
  dns: DnsState
  notVisible: SiteNotVisible | null
}

/** Blotout's answers for a site this grant cannot see. Anything else is not proof that it cannot. */
const NOT_VISIBLE_STATUSES = new Set([403, 404])

const DNS_UNKNOWN: DnsState = { valid: null, message: null, records: [] }

/**
 * Whether the selected site's own hostname points at Blotout yet.
 *
 * Blotout calls a site `status: active` with `deliveryLive: true` the moment it is deployed — before
 * the merchant has added the CNAME. So a site can report itself live while its delivery host does
 * not resolve at all, and every event would fail in the visitor's browser with nothing anywhere
 * saying why. This was seen for real: a freshly deployed `ideczh.srini-shopline.com` answered
 * nothing, and the app called it live.
 *
 * The DNS endpoint is the only thing that knows, so it is read rather than inferred. It costs one
 * Blotout round trip per status call for a custom-domain store, which is the price of not lying.
 * Development-URL sites need no records and are not asked about. A read that fails leaves the answer
 * unknown rather than inventing a verdict.
 */
const resolveDns = async (
  config: AppConfig,
  token: string,
  selection: NonNullable<Awaited<ReturnType<typeof findSelection>>>
): Promise<DnsState> => {
  if (selection.usingDevelopmentUrl) {
    return DNS_UNKNOWN
  }

  try {
    const dns = await getSiteDns(config, token, selection.teamId, selection.domainId)

    // A verified site still reports its records, and showing a merchant records they have already
    // published reads as work outstanding, so a satisfied check carries none.
    return dns.valid ? { valid: true, message: null, records: [] } : { valid: false, message: dns.message, records: dns.records }
  } catch (error) {
    if (!(error instanceof BlotoutApiError)) {
      throw error
    }

    console.warn('site dns unreadable', { handle: selection.handle, code: error.code })

    return DNS_UNKNOWN
  }
}

/**
 * The Blotout connection, and whether the selected site is actually serving.
 *
 * `deliveryLive` is read live rather than stored, because a site can stop serving without telling
 * us. A site we cannot read is reported as not serving; anything that is not a Blotout API failure
 * propagates, because a transport failure means the app is broken and must not look healthy.
 */
const resolveConnection = async (c: Context<AppEnv>, selection: Awaited<ReturnType<typeof findSelection>>): Promise<ConnectionResult> => {
  const handle = c.get('handle')
  const config = c.get('config')

  let grant: Awaited<ReturnType<typeof loadConnection>>
  try {
    grant = await loadConnection(c.get('db'), config, handle)
  } catch (error) {
    // The saved selection and the pixel are deliberately left alone: the storefront keeps sending
    // with the config it has, and a reconnect lands back on the same site. The callback is where a
    // reconnect by an account that cannot see that site gets caught.
    if (error instanceof BlotoutGrantRevokedError) {
      return { connection: { connected: false, reason: 'revoked' }, deliveryLive: false, dns: DNS_UNKNOWN, notVisible: null }
    }

    if (error instanceof BlotoutNotConnectedError) {
      return { connection: { connected: false, reason: 'never' }, deliveryLive: false, dns: DNS_UNKNOWN, notVisible: null }
    }

    throw error
  }

  const connection = {
    connected: true as const,
    userEmail: grant.userEmail,
    appName: grant.appName,
    scopes: grant.scope.split(' ').filter((scope) => scope !== ''),
    connectedAt: grant.connectedAt.toISOString()
  }

  if (selection === undefined) {
    return { connection, deliveryLive: false, dns: DNS_UNKNOWN, notVisible: null }
  }

  try {
    const site = await getSite(config, grant.accessToken, selection.teamId, selection.domainId)
    const dns = await resolveDns(config, grant.accessToken, selection)

    return { connection, deliveryLive: site.deliveryLive, dns, notVisible: null }
  } catch (error) {
    if (!(error instanceof BlotoutApiError)) {
      throw error
    }

    console.warn('selected site unreadable', { handle, code: error.code })

    if (!NOT_VISIBLE_STATUSES.has(error.status)) {
      return { connection, deliveryLive: false, dns: DNS_UNKNOWN, notVisible: null }
    }

    const sameUser = selection.qintoUserId !== null && selection.qintoUserId === grant.userId

    return { connection, deliveryLive: false, dns: DNS_UNKNOWN, notVisible: sameUser ? 'team_not_approved' : 'other_account' }
  }
}

/**
 * The single source of truth for the UI.
 *
 * Everything the SPA renders comes from here, so "which screen am I on" is decided in exactly one
 * place. Add a field rather than a sibling status route.
 */
status.get('/api/status', requireSession, async (c) => {
  const handle = c.get('handle')
  const config = c.get('config')
  const db = c.get('db')

  const [store, selection, pixel, onboardingRow] = await Promise.all([
    findStore(db, handle),
    findSelection(db, handle),
    findPixelState(db, handle),
    findOnboarding(db, handle)
  ])

  // The shop facts are whatever the install callback managed to record and are never re-fetched
  // here: this is the endpoint the SPA polls, so a retry would put a SHOPLINE round trip on every
  // request. A failed install-time fetch leaves them null until the next install.
  const primaryDomain = store?.primaryDomain ?? null
  const { connection, deliveryLive, dns, notVisible } = await resolveConnection(c, selection)

  const payload: StatusPayload = {
    screen: screenFor({
      connected: connection.connected,
      // Another account's site sends that account to the chooser; the old selection stays live
      // until a new one replaces it.
      hasSelection: selection !== undefined && notVisible !== 'other_account',
      onboardingStep: onboardingRow?.step
    }),
    store: {
      handle,
      shopName: store?.shopName ?? null,
      primaryDomain,
      usesDefaultDomain: primaryDomain === null || primaryDomain.endsWith(`.${config.apiHost}`)
    },
    connection,
    selection:
      selection === undefined
        ? null
        : {
            teamId: selection.teamId,
            teamName: selection.teamName,
            domainId: selection.domainId,
            siteName: selection.siteName,
            deliveryHost: selection.deliveryHost,
            usingDevelopmentUrl: selection.usingDevelopmentUrl,
            deliveryLive,
            dnsValid: dns.valid,
            dnsMessage: dns.message,
            dnsRecords: dns.records,
            selectedAt: selection.selectedAt.toISOString(),
            notVisible
          },
    tracking: {
      enabled: pixel?.trackingEnabled ?? true,
      pushedEnabled: pixel?.pushedEnabled ?? null,
      live: trackingIsLive({
        // Another account's site sends that account to the chooser; the old selection stays live
        // until a new one replaces it.
        hasSelection: selection !== undefined && notVisible !== 'other_account',
        deliveryLive,
        dnsValid: dns.valid,
        trackingEnabled: pixel?.trackingEnabled ?? true,
        pushedEnabled: pixel?.pushedEnabled ?? null
      }),
      lastPushError: pixel?.lastPushError ?? null,
      lastPushReason: pixel?.lastPushReason ?? null,
      settingsPushedAt: pixel?.settingsPushedAt?.toISOString() ?? null
    },
    onboarding:
      onboardingRow === undefined
        ? null
        : {
            step: onboardingRow.step,
            teamId: onboardingRow.teamId,
            domainId: onboardingRow.domainId,
            rootDomain: onboardingRow.rootDomain
          }
  }

  return c.json(payload)
})

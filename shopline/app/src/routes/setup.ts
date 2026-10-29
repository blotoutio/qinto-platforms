import { Hono } from 'hono'

import type { BlotoutSite } from '../blotout/client'
import {
  BlotoutApiError,
  checkSiteDns,
  createSite,
  deploySite,
  getSite,
  getSiteDns,
  getSiteSnippet,
  listTeams,
  shareSiteDns
} from '../blotout/client'
import { loadConnection } from '../blotout/connection-store'
import { isBlotoutId, isUuid } from '../config'
import { clearOnboarding, saveOnboarding, saveSelection } from '../db/queries/stores'
import type { AppEnv } from '../http/context'
import { requireSession } from '../http/middleware'
import { setTrackingEnabled } from '../services/pixel'

export const setup = new Hono<AppEnv>()

const teamNameFor = async (config: AppEnv['Variables']['config'], token: string, teamId: string): Promise<string | null> => {
  const teams = await listTeams(config, token)

  return teams.find((team) => team.teamId === teamId)?.name ?? null
}

/**
 * Where the pixel should send this store's events.
 *
 * Deliberately from the snippet endpoint, not from the site record: `snippet.host` is the host
 * Blotout is actually serving on, which differs from `site.domain` whenever delivery is the
 * development URL. Guessing from `deliveryMode` would duplicate that decision in a second place.
 */
const resolveDeliveryHost = async (
  config: AppEnv['Variables']['config'],
  token: string,
  teamId: string,
  site: BlotoutSite
): Promise<{ host: string; usingDevelopmentUrl: boolean }> => {
  try {
    const snippet = await getSiteSnippet(config, token, teamId, site.domainId)

    return { host: snippet.host, usingDevelopmentUrl: snippet.usingDevelopmentUrl }
  } catch (error) {
    if (!(error instanceof BlotoutApiError)) {
      throw error
    }

    const usingDevelopmentUrl = site.deliveryMode === 'development_url'
    const host = usingDevelopmentUrl ? site.developmentUrl : site.domain
    if (host === null) {
      throw error
    }

    return { host, usingDevelopmentUrl }
  }
}

type SelectBody = { teamId?: string; domainId?: string }

/**
 * Records the merchant's chosen site and turns tracking on.
 *
 * Enabling immediately is the intent from the spec: "once the user completes setup and selects a
 * site, enable the pixel". A site whose delivery is not live is still stored — the merchant chose
 * it — but the response says tracking is not live yet and why.
 */
setup.post('/api/setup/select', requireSession, async (c) => {
  const config = c.get('config')
  const db = c.get('db')
  const handle = c.get('handle')
  const { teamId, domainId } = await c.req.json<SelectBody>()

  if (!isBlotoutId(teamId) || !isBlotoutId(domainId)) {
    return c.json({ error: 'teamId and domainId must be Blotout ids' }, 400)
  }

  const grant = await loadConnection(db, config, handle)
  const site = await getSite(config, grant.accessToken, teamId, domainId)
  const delivery = await resolveDeliveryHost(config, grant.accessToken, teamId, site)

  await saveSelection(db, handle, {
    teamId,
    teamName: await teamNameFor(config, grant.accessToken, teamId),
    domainId,
    siteName: site.name,
    deliveryHost: delivery.host,
    usingDevelopmentUrl: delivery.usingDevelopmentUrl,
    qintoUserId: grant.userId
  })
  await clearOnboarding(db, handle)

  // `setTrackingEnabled`, not a bare push: choosing a site is the merchant's act of setup, so it
  // records the intent as well as pushing it. Pushing `enabled=true` while the stored intent stayed
  // `false` — which is what a previous disconnect or revocation leaves behind — made the app
  // disagree with itself, and the two flags exist to surface SHOPLINE's disagreements, not ours.
  const push = await setTrackingEnabled(db, config, { handle, enabled: true, actor: c.get('staffSubject') })

  return c.json({
    selected: true,
    deliveryHost: delivery.host,
    deliveryLive: site.deliveryLive,
    tracking: { live: site.deliveryLive && push.pushed, ...(push.pushed ? {} : { error: push.error }) }
  })
})

type CreateSiteBody = { teamId?: string; rootDomain?: string; name?: string; subdomain?: string }

/**
 * Step one of the new-user path: create the site.
 *
 * Onboarding progress is written before the call, so a merchant whose creation half-succeeded — the
 * site exists at Blotout but our response was lost — comes back to the DNS step rather than trying to
 * create a duplicate and hitting `already_exists`.
 */
setup.post('/api/setup/site', requireSession, async (c) => {
  const config = c.get('config')
  const db = c.get('db')
  const handle = c.get('handle')
  const body = await c.req.json<CreateSiteBody>()

  if (!isBlotoutId(body.teamId) || body.rootDomain === undefined || body.rootDomain.trim() === '') {
    return c.json({ error: 'a Blotout teamId and a rootDomain are required' }, 400)
  }

  const grant = await loadConnection(db, config, handle)
  await saveOnboarding(db, handle, { step: 'site', teamId: body.teamId, rootDomain: body.rootDomain })

  const site = await createSite(config, grant.accessToken, body.teamId, {
    rootDomain: body.rootDomain.trim(),
    ...(body.name === undefined ? {} : { name: body.name }),
    ...(body.subdomain === undefined ? {} : { subdomain: body.subdomain })
  })

  await saveOnboarding(db, handle, {
    step: 'dns',
    teamId: body.teamId,
    domainId: site.domainId,
    rootDomain: site.rootDomain,
    subdomain: site.subdomain
  })

  return c.json({ site })
})

type SiteRefBody = { teamId?: string | undefined; domainId?: string | undefined }

type ShareDnsBody = SiteRefBody & { emails?: unknown; submissionId?: unknown }

const readSiteRef = (body: SiteRefBody): { teamId: string; domainId: string } | undefined => {
  return isBlotoutId(body.teamId) && isBlotoutId(body.domainId) ? { teamId: body.teamId, domainId: body.domainId } : undefined
}

/** Step two: the records the merchant has to publish, and whether they are in place yet. */
setup.get('/api/setup/dns', requireSession, async (c) => {
  const ref = readSiteRef({ teamId: c.req.query('teamId'), domainId: c.req.query('domainId') })
  if (ref === undefined) {
    return c.json({ error: 'teamId and domainId must be Blotout ids' }, 400)
  }

  const config = c.get('config')
  const grant = await loadConnection(c.get('db'), config, c.get('handle'))

  return c.json(await getSiteDns(config, grant.accessToken, ref.teamId, ref.domainId))
})

/** Blotout's own cap on one send. */
const MAX_RECIPIENTS = 10

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * The recipient list, or `undefined` when it is not one.
 *
 * Checked here rather than left to Blotout so a typo comes back as our own 400 with copy the merchant
 * can act on, instead of a 502 carrying an upstream validation slug.
 */
const readEmails = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_RECIPIENTS) {
    return undefined
  }

  const emails = value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim())

  return emails.length === value.length && emails.every((email) => EMAIL_PATTERN.test(email)) ? emails : undefined
}

/**
 * Emails the site's DNS records to whoever manages the domain.
 *
 * The merchant setting the app up is often not the person who can edit DNS, and this is the whole
 * reason the records can be handed over without leaving the Admin. Blotout sends the mail and owns
 * every judgement about it — current record values, rate limits, and refusing a site that needs no
 * records — so a failure is passed through with Blotout's own slug (`app/src/index.ts`) for the SPA
 * to word.
 */
setup.post('/api/setup/dns/share', requireSession, async (c) => {
  const body = await c.req.json<ShareDnsBody>()
  const ref = readSiteRef(body)
  const emails = readEmails(body.emails)

  if (ref === undefined || emails === undefined || !isUuid(body.submissionId)) {
    return c.json({ error: `a Blotout teamId and domainId, 1-${MAX_RECIPIENTS} email addresses and a submissionId uuid are required` }, 400)
  }

  const config = c.get('config')
  const grant = await loadConnection(c.get('db'), config, c.get('handle'))

  return c.json(await shareSiteDns(config, grant.accessToken, ref, { emails, submissionId: body.submissionId }))
})

/**
 * Asks Blotout to look at the DNS again.
 *
 * The SPA polls this. It advances `onboarding.step` to `deploy` once the check passes, so leaving
 * mid-propagation and coming back later resumes at the right place.
 */
setup.post('/api/setup/dns/check', requireSession, async (c) => {
  const ref = readSiteRef(await c.req.json<SiteRefBody>())
  if (ref === undefined) {
    return c.json({ error: 'teamId and domainId must be Blotout ids' }, 400)
  }

  const config = c.get('config')
  const db = c.get('db')
  const handle = c.get('handle')
  const grant = await loadConnection(db, config, handle)
  const dns = await checkSiteDns(config, grant.accessToken, ref.teamId, ref.domainId)

  if (dns.valid || !dns.required) {
    await saveOnboarding(db, handle, { step: 'deploy', teamId: ref.teamId, domainId: ref.domainId })
  }

  return c.json(dns)
})

/**
 * Step three: publish the site to the edge, then select it.
 *
 * Deploy and select are one call because a deployed site the merchant has not selected is a dead
 * end — they came here to finish setup, not to admire a site.
 */
setup.post('/api/setup/deploy', requireSession, async (c) => {
  const ref = readSiteRef(await c.req.json<SiteRefBody>())
  if (ref === undefined) {
    return c.json({ error: 'teamId and domainId must be Blotout ids' }, 400)
  }

  const config = c.get('config')
  const db = c.get('db')
  const handle = c.get('handle')
  const grant = await loadConnection(db, config, handle)

  const deployment = await deploySite(config, grant.accessToken, ref.teamId, ref.domainId)
  const site = await getSite(config, grant.accessToken, ref.teamId, ref.domainId)
  const delivery = await resolveDeliveryHost(config, grant.accessToken, ref.teamId, site)

  await saveSelection(db, handle, {
    teamId: ref.teamId,
    teamName: await teamNameFor(config, grant.accessToken, ref.teamId),
    domainId: ref.domainId,
    siteName: site.name,
    deliveryHost: delivery.host,
    usingDevelopmentUrl: delivery.usingDevelopmentUrl,
    qintoUserId: grant.userId
  })
  await clearOnboarding(db, handle)

  const push = await setTrackingEnabled(db, config, { handle, enabled: true, actor: c.get('staffSubject') })

  return c.json({
    deployment,
    deliveryHost: delivery.host,
    deliveryLive: site.deliveryLive,
    tracking: { live: site.deliveryLive && push.pushed, ...(push.pushed ? {} : { error: push.error }) }
  })
})

/** Records which step the merchant is on, so a reload does not restart the flow. */
setup.put('/api/setup/onboarding', requireSession, async (c) => {
  const body = await c.req.json<{ step?: string; teamId?: string; domainId?: string; rootDomain?: string }>()
  const allowed = ['connect', 'choose', 'site', 'dns', 'deploy', 'done'] as const
  const step = allowed.find((candidate) => candidate === body.step)

  if (step === undefined) {
    return c.json({ error: `step must be one of ${allowed.join(', ')}` }, 400)
  }

  await saveOnboarding(c.get('db'), c.get('handle'), {
    step,
    teamId: body.teamId ?? null,
    domainId: body.domainId ?? null,
    rootDomain: body.rootDomain ?? null
  })

  return c.json({ step })
})

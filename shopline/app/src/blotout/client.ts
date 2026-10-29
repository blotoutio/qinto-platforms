import type { AppConfig } from '../config'

export class BlotoutApiError extends Error {
  readonly status: number
  /** Blotout's error slug, e.g. `forbidden`, `already_exists`, `host_not_ready`. */
  readonly code: string
  readonly detail: string | undefined

  constructor(path: string, status: number, code: string, detail?: string) {
    super(`Blotout ${path} -> ${status} ${code}`)
    this.name = 'BlotoutApiError'
    this.status = status
    this.code = code
    this.detail = detail
  }
}

/**
 * Calls the Blotout platform API with a bearer access token.
 *
 * Refreshing happens in `connection-store.loadConnection`, before the token gets here — this layer
 * stays a plain transport so a route can see exactly one thing go wrong at a time.
 */
export const blotoutApi = async <T>(
  config: AppConfig,
  accessToken: string,
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> => {
  const response = await fetch(`${config.blotoutApiOrigin}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) })
  })

  if (response.status === 204) {
    return undefined as T
  }

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    const code = typeof body['error'] === 'string' ? body['error'] : 'unknown'
    const detail = typeof body['message'] === 'string' ? body['message'] : undefined
    throw new BlotoutApiError(path, response.status, code, detail)
  }

  return body as T
}

export type BlotoutTeam = {
  teamId: string
  name: string | null
  createdAt: string
  scopes: string[]
}

export type BlotoutSite = {
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

export type BlotoutMe = {
  tokenType: 'oauth' | 'api_token'
  name: string
  user: { userId: string; email: string; firstName: string | null; lastName: string | null } | null
  teams: BlotoutTeam[]
  organizations: { organizationId: string; name: string; role: string }[]
  scopes: string[]
}

export type BlotoutDnsRecord = { type: 'TXT' | 'CNAME'; name: string; value: string; note?: string }

export type BlotoutSiteDns = {
  records: BlotoutDnsRecord[]
  valid: boolean
  required: boolean
  checked: boolean
  failureKind: string | null
  message: string
}

export type BlotoutSnippet = { host: string; usingDevelopmentUrl: boolean; snippet: string }

export const getMe = (config: AppConfig, token: string): Promise<BlotoutMe> => {
  return blotoutApi<BlotoutMe>(config, token, '/me')
}

export const listTeams = async (config: AppConfig, token: string): Promise<BlotoutTeam[]> => {
  return (await blotoutApi<{ teams: BlotoutTeam[] }>(config, token, '/teams')).teams
}

export const listSites = async (config: AppConfig, token: string, teamId: string): Promise<BlotoutSite[]> => {
  return (await blotoutApi<{ sites: BlotoutSite[] }>(config, token, `/teams/${teamId}/domains`)).sites
}

export const getSite = async (config: AppConfig, token: string, teamId: string, domainId: string): Promise<BlotoutSite> => {
  return (await blotoutApi<{ site: BlotoutSite }>(config, token, `/teams/${teamId}/domains/${domainId}`)).site
}

export type CreateSiteInput = { rootDomain: string; name?: string; subdomain?: string }

export const createSite = async (config: AppConfig, token: string, teamId: string, input: CreateSiteInput): Promise<BlotoutSite> => {
  const body = {
    rootDomain: input.rootDomain,
    mode: 'managed' as const,
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.subdomain === undefined ? {} : { subdomain: input.subdomain })
  }

  return (await blotoutApi<{ site: BlotoutSite }>(config, token, `/teams/${teamId}/domains`, { method: 'POST', body })).site
}

export const getSiteDns = (config: AppConfig, token: string, teamId: string, domainId: string): Promise<BlotoutSiteDns> => {
  return blotoutApi<BlotoutSiteDns>(config, token, `/teams/${teamId}/domains/${domainId}/dns`)
}

export const checkSiteDns = (config: AppConfig, token: string, teamId: string, domainId: string): Promise<BlotoutSiteDns> => {
  return blotoutApi<BlotoutSiteDns>(config, token, `/teams/${teamId}/domains/${domainId}/dns/check`, { method: 'POST' })
}

/**
 * Emails the site's outstanding DNS records to whoever manages the domain.
 *
 * Blotout re-reads the records at send time and refuses a site that needs none, so nothing here
 * decides whether there is anything to share. `submissionId` is the caller's idempotency key: the
 * same value inside 24 hours, with the same recipients and records, delivers no second email, which
 * is why it comes from the browser and survives a retry rather than being minted per request.
 */
export const shareSiteDns = (
  config: AppConfig,
  token: string,
  site: { teamId: string; domainId: string },
  input: { emails: string[]; submissionId: string }
): Promise<{ sent: number }> => {
  const path = `/teams/${site.teamId}/domains/${site.domainId}/dns/share`

  return blotoutApi<{ sent: number }>(config, token, path, { method: 'POST', body: input })
}

export const deploySite = (
  config: AppConfig,
  token: string,
  teamId: string,
  domainId: string
): Promise<{ deploymentId: string; version: string }> => {
  return blotoutApi(config, token, `/teams/${teamId}/domains/${domainId}/deploy`, { method: 'POST' })
}

export type DeliveryMode = 'domain' | 'development_url'

/**
 * Chooses whether a site is served from its own domain or from its Blotout URL.
 *
 * The platform enforces the transitions and we do not restate them, because its refusals are the
 * only ones that can be right:
 *
 * - to `development_url`: only while the site is **pending**. A deployed site cannot go back.
 * - to `domain` on a deployed site: only with **verified DNS**, so the switch cannot take it offline.
 * - asking for the mode it already has succeeds, and retries a change that never reached the edge.
 *
 * `live` is whether the edge already serves that mode; false means it is still being applied.
 */
export const setSiteDelivery = (
  config: AppConfig,
  token: string,
  site: { teamId: string; domainId: string },
  mode: DeliveryMode
): Promise<{ mode: DeliveryMode; live: boolean }> => {
  const path = `/teams/${site.teamId}/domains/${site.domainId}/delivery`

  return blotoutApi<{ mode: DeliveryMode; live: boolean }>(config, token, path, { method: 'PUT', body: { mode } })
}

export const getSiteSnippet = (config: AppConfig, token: string, teamId: string, domainId: string): Promise<BlotoutSnippet> => {
  return blotoutApi<BlotoutSnippet>(config, token, `/teams/${teamId}/domains/${domainId}/snippet`)
}

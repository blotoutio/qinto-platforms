import type { SiteOrigins } from '../blotout/client'
import { getSiteOrigins, updateSiteOrigins } from '../blotout/client'
import type { AppConfig } from '../config'

/** Qinto's own cap on a site's allowed origins. */
export const MAX_ALLOWED_ORIGINS = 20

/**
 * `allowed` — every store origin is listed. `missing` — some are not, and there is room to add them.
 * `full` — some are not and adding them would pass Qinto's cap. `check_off` — the site admits every
 * origin, so the list is left alone.
 */
export type OriginsState = 'allowed' | 'missing' | 'full' | 'check_off'

export type OriginsStatus = { state: OriginsState; missing: string[] }

export type OriginsSite = { teamId: string; domainId: string; rootDomain: string }

const toOrigin = (host: string): string | null => {
  try {
    return new URL(`https://${host.trim()}`).origin
  } catch {
    return null
  }
}

/** The storefront origins a visitor's page can carry: SHOPLINE's own host and the primary domain. */
export const storeOrigins = (handle: string, apiHost: string, primaryDomain: string | null): string[] => {
  const hosts = [`${handle}.${apiHost}`, ...(primaryDomain === null ? [] : [primaryDomain])]
  const origins = hosts.map(toOrigin).filter((origin): origin is string => origin !== null)

  return [...new Set(origins)]
}

/** The Qinto edge admits the site's root domain and its subdomains without a list entry. */
const coveredByRoot = (origin: string, rootDomain: string): boolean => {
  const host = new URL(origin).hostname
  const root = rootDomain.toLowerCase()

  return root !== '' && (host === root || host.endsWith(`.${root}`))
}

export const assessOrigins = (current: SiteOrigins, wanted: string[], rootDomain: string): OriginsStatus => {
  if (!current.originCheck) {
    return { state: 'check_off', missing: [] }
  }

  const missing = wanted.filter((origin) => !coveredByRoot(origin, rootDomain) && !current.allowedOrigins.includes(origin))
  if (missing.length === 0) {
    return { state: 'allowed', missing }
  }

  return { state: current.allowedOrigins.length + missing.length > MAX_ALLOWED_ORIGINS ? 'full' : 'missing', missing }
}

export const readOriginsStatus = async (config: AppConfig, token: string, site: OriginsSite, wanted: string[]): Promise<OriginsStatus> => {
  return assessOrigins(await getSiteOrigins(config, token, site), wanted, site.rootDomain)
}

/**
 * Appends the store's origins to the site's list when they are missing and fit.
 *
 * Only ever appends: the merchant's own entries are never removed, so a full list is reported, not
 * made room in.
 */
export const ensureStoreOrigins = async (config: AppConfig, token: string, site: OriginsSite, wanted: string[]): Promise<OriginsStatus> => {
  const current = await getSiteOrigins(config, token, site)
  const status = assessOrigins(current, wanted, site.rootDomain)
  if (status.state !== 'missing') {
    return status
  }

  await updateSiteOrigins(config, token, site, [...current.allowedOrigins, ...status.missing])

  return { state: 'allowed', missing: [] }
}

import type { QintoApi } from './http'
import type { QintoSite, QintoTeam } from './schemas'
import { siteResponse, sitesResponse, snippetResponse, teamsResponse } from './schemas'

export type SiteRef = { teamId: string; domainId: string }

export const sitePath = (site: SiteRef): string => `/teams/${site.teamId}/domains/${site.domainId}`

export const listTeams = async (api: QintoApi): Promise<QintoTeam[]> => {
  return (await api.get('/teams', teamsResponse)).teams
}

export const listSites = async (api: QintoApi, teamId: string): Promise<QintoSite[]> => {
  return (await api.get(`/teams/${teamId}/domains`, sitesResponse)).sites
}

export const getSite = async (api: QintoApi, site: SiteRef): Promise<QintoSite> => {
  return (await api.get(sitePath(site), siteResponse)).site
}

type CreateSiteInput = { rootDomain: string; name?: string | undefined; subdomain?: string | undefined }

/** A managed site: Qinto hosts it and hands back the DNS records to publish. */
export const createSite = async (api: QintoApi, teamId: string, input: CreateSiteInput): Promise<QintoSite> => {
  // JSON drops an undefined `name` or `subdomain`.
  const body = { rootDomain: input.rootDomain, mode: 'managed', name: input.name, subdomain: input.subdomain }

  return (await api.post(`/teams/${teamId}/domains`, siteResponse, body)).site
}

/** The site's settings page in Qinto, whose Deployment card deploys it, where the merchant deploys (and pays); the broker never does. */
export const qintoDeployUrl = (portalOrigin: string, site: SiteRef): string =>
  `${portalOrigin}/team/${encodeURIComponent(site.teamId)}/domain/${encodeURIComponent(site.domainId)}/settings/general`

/** The host Qinto actually serves on; differs from `site.domain` while on the Qinto URL. */
export const getSnippetHost = (api: QintoApi, site: SiteRef) => api.get(`${sitePath(site)}/snippet`, snippetResponse)

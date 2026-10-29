import { Hono } from 'hono'

import type { BlotoutSite } from '../blotout/client'
import { listSites, listTeams } from '../blotout/client'
import { loadConnection } from '../blotout/connection-store'
import { defaultStorefrontHost, isBlotoutId } from '../config'
import { findStore } from '../db/queries/stores'
import type { AppEnv } from '../http/context'
import { requireSession } from '../http/middleware'

export const blotoutResources = new Hono<AppEnv>()

export type TeamWithSites = {
  teamId: string
  name: string | null
  scopes: string[]
  sites: BlotoutSite[]
  /** Set when the team's sites could not be read, so the UI shows the team rather than dropping it. */
  error?: string
}

/**
 * Every team the grant covers, with every site under each.
 *
 * Sites are fetched in parallel and a team whose sites fail is returned with an `error` instead of
 * failing the whole page. A merchant with one broken team should still be able to pick a site in
 * another.
 */
blotoutResources.get('/api/qinto/teams', requireSession, async (c) => {
  const config = c.get('config')
  const grant = await loadConnection(c.get('db'), config, c.get('handle'))
  const teams = await listTeams(config, grant.accessToken)

  const withSites = await Promise.all(
    teams.map(async (team): Promise<TeamWithSites> => {
      const base = { teamId: team.teamId, name: team.name, scopes: team.scopes }
      try {
        return { ...base, sites: await listSites(config, grant.accessToken, team.teamId) }
      } catch (error) {
        return { ...base, sites: [], error: error instanceof Error ? error.message : 'sites could not be read' }
      }
    })
  )

  return c.json({ teams: withSites })
})

export type DomainSuggestion = {
  host: string
  /** `shopline_default` is derived from the handle; `shopline_primary` was read from the Admin API. */
  source: 'shopline_primary' | 'shopline_default' | 'qinto_site'
  /** A SHOPLINE-owned host, which cannot carry first-party delivery. */
  isDefault: boolean
}

/**
 * What to offer on the domain step of onboarding.
 *
 * SHOPLINE has no API that lists a store's domains — `merchants/shop.json` returns exactly one, and
 * GraphQL's `Shop` is the same field. So "show the domains we found" is realized as: the one host
 * SHOPLINE admits to, plus the root domains of sites the team already has in Blotout, plus a
 * free-text entry the SPA always offers. Anything more would be invented.
 */
blotoutResources.get('/api/qinto/domain-suggestions', requireSession, async (c) => {
  const config = c.get('config')
  const db = c.get('db')
  const handle = c.get('handle')
  const teamId = c.req.query('teamId')

  const store = await findStore(db, handle)
  const suggestions: DomainSuggestion[] = []

  // The Admin API's answer when we have it, the derived host otherwise. Both rows are shown
  // disabled when SHOPLINE owns the domain: the point of the row is to explain why a custom domain
  // is needed, and that explanation is worth more than the exactness of the host.
  if (store?.primaryDomain !== null && store?.primaryDomain !== undefined) {
    suggestions.push({
      host: store.primaryDomain,
      source: 'shopline_primary',
      isDefault: store.primaryDomain.endsWith(`.${config.apiHost}`)
    })
  } else {
    suggestions.push({ host: defaultStorefrontHost(handle, config.apiHost), source: 'shopline_default', isDefault: true })
  }

  if (isBlotoutId(teamId)) {
    const grant = await loadConnection(db, config, handle)
    const sites = await listSites(config, grant.accessToken, teamId)
    for (const site of sites) {
      if (!suggestions.some((suggestion) => suggestion.host === site.rootDomain)) {
        suggestions.push({ host: site.rootDomain, source: 'qinto_site', isDefault: false })
      }
    }
  }

  return c.json({ suggestions })
})

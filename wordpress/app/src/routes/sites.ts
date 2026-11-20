import { Hono } from 'hono'
import { z } from 'zod'

import type { AppEnv } from '../http/context'
import { qintoApiFor } from '../http/context'
import { requireSignature } from '../http/middleware'
import { qintoId, readQuery } from '../http/validate'
import type { QintoSite } from '../qinto/schemas'
import { listSites, listTeams } from '../qinto/sites'

export const sites = new Hono<AppEnv>()

/** What WordPress sees of a site. */
export const siteView = (site: QintoSite) => ({
  domainId: site.domainId,
  name: site.name,
  domain: site.domain,
  rootDomain: site.rootDomain,
  status: site.status,
  developmentUrl: site.developmentUrl,
  deliveryLive: site.deliveryLive
})

/** The grant's teams and one team's sites (the first team when no `teamId`). Qinto's ACL decides what is visible. */
sites.get('/sites', requireSignature, async (c) => {
  const { teamId } = readQuery(c, z.object({ teamId: qintoId.optional() }))
  const api = await qintoApiFor(c)

  const teams = await listTeams(api)
  const chosen = teamId ?? teams[0]?.teamId
  const list = chosen === undefined ? [] : await listSites(api, chosen)

  return c.json({ teams, teamId: chosen ?? null, sites: list.map(siteView) })
})

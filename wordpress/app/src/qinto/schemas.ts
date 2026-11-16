import { z } from 'zod'

/** The parts of Qinto's responses we read. Unknown keys are dropped, so a new Qinto field never breaks us. */

const teamSchema = z.object({ teamId: z.string(), name: z.string().nullable() })
export const teamsResponse = z.object({ teams: z.array(teamSchema) })
export type QintoTeam = z.output<typeof teamSchema>

export const meResponse = z.object({
  user: z.object({ userId: z.string(), email: z.string() }).nullable()
})

const siteSchema = z.object({
  domainId: z.string(),
  name: z.string().nullable(),
  domain: z.string(),
  rootDomain: z.string(),
  status: z.enum(['pending', 'active']),
  developmentUrl: z.string().nullable(),
  deliveryMode: z.enum(['domain', 'development_url']),
  deliveryLive: z.boolean()
})
export type QintoSite = z.output<typeof siteSchema>

export const siteResponse = z.object({ site: siteSchema })
export const sitesResponse = z.object({ sites: z.array(siteSchema) })

export const dnsResponse = z.object({
  records: z.array(z.object({ type: z.string(), name: z.string(), value: z.string() })),
  valid: z.boolean(),
  required: z.boolean(),
  message: z.string()
})

export const dnsShareResponse = z.object({ sent: z.number() })

export const deployResponse = z.object({ deploymentId: z.string(), version: z.string() })

export const snippetResponse = z.object({ host: z.string(), usingDevelopmentUrl: z.boolean() })

export const originsResponse = z.object({ originCheck: z.boolean(), allowedOrigins: z.array(z.string()) })

export const appInstallResponse = z.object({
  domainAppId: z.string(),
  action: z.enum(['installed', 'version_changed', 'unchanged'])
})

export const settingsResponse = z.object({ deployed: z.boolean() })

export const siteSettingsResponse = z.object({ settings: z.object({ fallbackCookie: z.string().nullable() }) })

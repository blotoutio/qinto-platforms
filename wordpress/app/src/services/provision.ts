import type { Db } from '../db/client'
import { saveSelection } from '../db/queries/selections'
import { applyConsentSettings, installConsentApp } from '../qinto/apps'
import { getDns } from '../qinto/dns'
import type { QintoApi } from '../qinto/http'
import { allowOrigin } from '../qinto/origins'
import type { SiteRef } from '../qinto/sites'
import { deploySite, getSite, getSnippetHost } from '../qinto/sites'

/**
 * Makes a chosen site serve the banner to this WordPress site.
 *
 * Each Qinto step is idempotent, so a half-failed select is fixed by selecting again. Nothing is
 * stored until all succeed, so WordPress never prints a host that does not serve the consent app yet.
 */
type Site = Awaited<ReturnType<typeof getSite>>

/**
 * The host WordPress should print. Qinto can name the custom domain before its DNS is verified, and a
 * host that does not resolve shows no banner, so an unverified domain falls back to the Qinto URL.
 */
const deliveryHostFor = async (api: QintoApi, ref: SiteRef, site: Site) => {
  const snippet = await getSnippetHost(api, ref)
  if (snippet.usingDevelopmentUrl || site.developmentUrl === null) {
    return snippet
  }
  const dns = await getDns(api, ref)

  return dns.valid ? snippet : { host: site.developmentUrl, usingDevelopmentUrl: true }
}

export const provisionSite = async (db: Db, api: QintoApi, input: { registrationId: string; ref: SiteRef; wpOrigin: string }) => {
  const { ref } = input
  const site = await getSite(api, ref)
  const install = await installConsentApp(api, ref)
  await applyConsentSettings(api, ref)
  await allowOrigin(api, { ...ref, rootDomain: site.rootDomain }, input.wpOrigin)
  // Without a deploy the app is not in the bundle `q.js` serves.
  await deploySite(api, ref)

  const delivery = await deliveryHostFor(api, ref, site)

  await saveSelection(db, input.registrationId, {
    teamId: ref.teamId,
    domainId: ref.domainId,
    siteName: site.name,
    deliveryHost: delivery.host,
    usingDevelopmentUrl: delivery.usingDevelopmentUrl,
    appInstalledAt: new Date()
  })

  return { site, delivery, appAction: install.action }
}

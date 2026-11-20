import type { Context } from 'hono'
import { Hono } from 'hono'

import type { SiteSelection } from '../db/queries/selections'
import { findSelection } from '../db/queries/selections'
import type { AppEnv } from '../http/context'
import { qintoApiFor } from '../http/context'
import { requireSignature } from '../http/middleware'
import { CONSENT_APP_SLUG } from '../qinto/apps'
import { QintoApiError } from '../qinto/http'
import { getSite } from '../qinto/sites'
import { connectionState, QintoGrantRevokedError, QintoUnavailableError } from '../services/connection-store'
import { siteView } from './sites'

export const status = new Hono<AppEnv>()

/** The site as Qinto sees it now, or `null` when Qinto or the grant cannot answer. Status must never fail on those. */
const liveSite = async (c: Context<AppEnv>, selection: SiteSelection) => {
  try {
    return siteView(await getSite(await qintoApiFor(c), selection))
  } catch (error) {
    if (error instanceof QintoApiError || error instanceof QintoGrantRevokedError || error instanceof QintoUnavailableError) {
      return null
    }

    throw error
  }
}

/** The app's panel in the Qinto portal; only it can design and switch on the banner. */
const bannerSettingsUrl = (portalOrigin: string, selection: SiteSelection): string => {
  return `${portalOrigin}/team/${selection.teamId}/domain/${selection.domainId}/apps/${CONSENT_APP_SLUG}/ui`
}

const selectionView = (selection: SiteSelection, portalOrigin: string) => ({
  teamId: selection.teamId,
  domainId: selection.domainId,
  siteName: selection.siteName,
  host: selection.deliveryHost,
  usingDevelopmentUrl: selection.usingDevelopmentUrl,
  bannerSettingsUrl: bannerSettingsUrl(portalOrigin, selection)
})

/** Decides which screen the plugin's settings page shows. */
status.get('/status', requireSignature, async (c) => {
  const registrationId = c.get('registration').id
  const connection = await connectionState(c.get('db'), registrationId)
  const selection = await findSelection(c.get('db'), registrationId)
  const site = selection !== undefined && connection.state === 'connected' ? await liveSite(c, selection) : null
  const portalOrigin = c.get('config').qintoAuthorizeOrigin

  return c.json({ connection, selection: selection === undefined ? null : selectionView(selection, portalOrigin), site })
})

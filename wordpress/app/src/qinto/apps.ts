import type { QintoApi } from './http'
import { appInstallResponse, settingsResponse, siteSettingsResponse } from './schemas'
import type { SiteRef } from './sites'
import { sitePath } from './sites'

export const CONSENT_APP_SLUG = 'blotout-consent'

/** The visitor-id cookie Qinto falls back to when the site has none set. */
const FALLBACK_COOKIE = 'tag_user_id'

/** Idempotent. Qinto answers `acknowledgement_required` without `acknowledgeNecessary`, as the app runs before consent. */
export const installConsentApp = (api: QintoApi, site: SiteRef) => {
  return api.put(`${sitePath(site)}/apps/${CONSENT_APP_SLUG}`, appInstallResponse, { acknowledgeNecessary: true })
}

/** Consent gating on, GPC honoured, and a fallback visitor cookie unless one is already set. */
export const applyConsentSettings = async (api: QintoApi, site: SiteRef) => {
  const { settings } = await api.get(`${sitePath(site)}/settings`, siteSettingsResponse)
  const fallbackCookie = settings.fallbackCookie ? undefined : FALLBACK_COOKIE

  return api.patch(`${sitePath(site)}/settings`, settingsResponse, { consent: { enabled: true }, gpc: true, fallbackCookie })
}

import type { QintoApi } from './http'
import { dnsResponse, dnsShareResponse } from './schemas'
import type { SiteRef } from './sites'
import { sitePath } from './sites'

export const getDns = (api: QintoApi, site: SiteRef) => api.get(`${sitePath(site)}/dns`, dnsResponse)

export const checkDns = (api: QintoApi, site: SiteRef) => api.post(`${sitePath(site)}/dns/check`, dnsResponse)

/** `submissionId` comes from the plugin: Qinto sends no second email for the same one within 24 hours. */
export const shareDns = (api: QintoApi, site: SiteRef, input: { emails: string[]; submissionId: string }) => {
  return api.post(`${sitePath(site)}/dns/share`, dnsShareResponse, input)
}

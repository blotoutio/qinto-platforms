import type { QintoApi } from './http'
import { originsResponse } from './schemas'
import type { SiteRef } from './sites'
import { sitePath } from './sites'

/** True when Qinto's origin check already lets `origin` in: the root domain or one of its subdomains. */
export const coveredByRoot = (origin: string, rootDomain: string): boolean => {
  const host = new URL(origin).hostname

  return host === rootDomain || host.endsWith(`.${rootDomain}`)
}

/** PATCH replaces the whole list, so merge; skip the write (and its redeploy) when already allowed. */
export const allowOrigin = async (api: QintoApi, site: SiteRef & { rootDomain: string }, origin: string): Promise<void> => {
  if (coveredByRoot(origin, site.rootDomain)) {
    return
  }

  const path = `${sitePath(site)}/origins`
  const current = await api.get(path, originsResponse)
  if (current.allowedOrigins.includes(origin)) {
    return
  }

  await api.patch(path, originsResponse, { allowedOrigins: [...current.allowedOrigins, origin] })
}

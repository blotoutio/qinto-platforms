import { LOOPBACK_HOSTNAMES } from '../config'

const ADMIN_POST_PATH = /\/wp-admin\/admin-post\.php$/

/** A hostname, lower case, no port: `shop.example.com`. Interpolated into URLs, so checked strictly. */
const HOSTNAME_PATTERN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

const parse = (value: string): URL | undefined => {
  try {
    return new URL(value)
  } catch {
    return undefined
  }
}

/** The site URL (`home_url`): https, default port, a public hostname, no credentials. The broker fetches it. */
export const isSiteUrl = (value: string): boolean => {
  const url = parse(value)

  return (
    url !== undefined &&
    url.protocol === 'https:' &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    isHostname(url.hostname)
  )
}

/** The site's own https `wp-admin/admin-post.php`, so the broker is never an open redirect. */
export const isReturnUrlFor = (returnUrl: string, shopId: string): boolean => {
  const url = parse(returnUrl)
  const shop = parse(shopId)
  if (url === undefined || shop === undefined) {
    return false
  }

  return url.protocol === 'https:' && url.host === shop.host && ADMIN_POST_PATH.test(url.pathname) && url.username === ''
}

export const isHostname = (value: unknown): value is string => {
  return typeof value === 'string' && HOSTNAME_PATTERN.test(value)
}

/** The origin browsers send for pages on the site, e.g. `https://shop.example.com`. */
export const siteOrigin = (shopId: string): string => new URL(shopId).origin

/** Forced to https except on loopback: behind a proxy the Worker may see http, and Qinto matches the redirect URI exactly. */
export const publicOrigin = (requestUrl: string): string => {
  const url = new URL(requestUrl)

  return LOOPBACK_HOSTNAMES.has(url.hostname) ? url.origin : `https://${url.host}`
}

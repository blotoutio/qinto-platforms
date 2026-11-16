/**
 * The Qinto scopes we ask for, and no more. `domain:write` covers DNS and snippet reads, and Qinto
 * grants `feature:manage_domain_apps:write` (needed to install `blotout-consent`) only alongside it.
 */
export const QINTO_SCOPES = ['profile', 'team:read', 'domain:write', 'feature:manage_domain_apps:write', 'offline_access'] as const

export type AppConfig = {
  qintoApiOrigin: string
  qintoAuthorizeOrigin: string
  qintoClientId: string
  qintoClientSecret: string
  tokenKek: string
  /** Local development only. */
  devCallbackOrigin?: string
}

/** `URL.hostname` keeps the brackets on an IPv6 literal. */
export const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

export class ConfigError extends Error {
  constructor(missing: string[]) {
    super(`missing configuration: ${missing.join(', ')}`)
    this.name = 'ConfigError'
  }
}

/** Loopback only: this decides where an authorization code is delivered. */
const readDevCallbackOrigin = (value: string | undefined): string | undefined => {
  if (value === undefined || value === '') {
    return undefined
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ConfigError([`QINTO_DEV_CALLBACK_ORIGIN is not a URL: ${value}`])
  }

  if (url.protocol !== 'http:' || !LOOPBACK_HOSTNAMES.has(url.hostname)) {
    throw new ConfigError([`QINTO_DEV_CALLBACK_ORIGIN must be an http loopback origin, got ${value}`])
  }

  return url.origin
}

/** No defaults: a fallback would mean encrypting under an empty key. */
export const readConfig = (env: Env): AppConfig => {
  const config = {
    qintoApiOrigin: env.QINTO_API_ORIGIN,
    qintoAuthorizeOrigin: env.QINTO_AUTHORIZE_ORIGIN,
    qintoClientId: env.QINTO_CLIENT_ID,
    qintoClientSecret: env.QINTO_CLIENT_SECRET,
    tokenKek: env.TOKEN_KEK
  }

  const missing = Object.entries(config)
    .filter(([, value]) => typeof value !== 'string' || value === '')
    .map(([key]) => key)
  if (missing.length > 0) {
    throw new ConfigError(missing)
  }

  const devCallbackOrigin = readDevCallbackOrigin(env.QINTO_DEV_CALLBACK_ORIGIN)
  if (devCallbackOrigin === undefined) {
    return config
  }

  return { ...config, devCallbackOrigin }
}

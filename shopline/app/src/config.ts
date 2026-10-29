/** The SHOPLINE Admin API version, in one place (risk R8). */
export const API_VERSION = 'v20270301'

/**
 * What a store handle may look like.
 *
 * Enforced wherever one enters — the install query, the session token, the uninstall webhook — and
 * not just where it is convenient. A handle is interpolated into an origin, a redirect and a CSP
 * header, so a handle carrying `/`, `<` or a dot is the start of a real problem rather than a
 * validation nicety.
 */
export const HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/

export const isValidHandle = (handle: unknown): handle is string => {
  return typeof handle === 'string' && HANDLE_PATTERN.test(handle)
}

/**
 * Blotout addresses teams and sites by UUID.
 *
 * Both arrive in a request body and are interpolated into an API path, so the shape is checked
 * before use: `teamId = 'x/../../something'` would otherwise send a merchant's own bearer token to
 * a path we never meant to call. It also turns a typo into a clean 400 instead of a confusing
 * upstream error.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isUuid = (value: unknown): value is string => {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

/** Blotout team and site ids are UUIDs, so the two checks are the same one under two names. */
export const isBlotoutId = isUuid

/**
 * The SHOPLINE-owned host every store has, derived rather than fetched.
 *
 * `merchants/shop.json` names the primary domain, but it is read once at install and that read can
 * fail, so the domain step cannot depend on it. SHOPLINE defines the handle as the prefix of the
 * store's default domain.
 *
 * This is the host that *cannot* carry first-party delivery, which is the only thing the domain
 * step uses it for. Free-text entry is always offered, because one primary domain is all SHOPLINE
 * ever reports.
 */
export const defaultStorefrontHost = (handle: string, apiHost: string): string => `${handle}.${apiHost}`

/** The scopes we install with. Widening this is a decision, not an edit — see `AGENTS.md`. */
export const SHOPLINE_SCOPES = ['read_pixels', 'write_pixels', 'read_store_information'] as const

/** The Blotout scopes we ask for. `domain:write` outranks `domain:read`, so dns and snippet reads ride on it. */
export const QINTO_SCOPES = ['profile', 'team:read', 'domain:write', 'offline_access'] as const

export type AppConfig = {
  appKey: string
  appSecret: string
  apiHost: string
  blotoutApiOrigin: string
  blotoutAuthorizeOrigin: string
  blotoutClientId: string
  blotoutClientSecret: string
  tokenKek: string
  /** Set only in local development; see `readDevCallbackOrigin`. */
  devCallbackOrigin?: string
}

/** `URL.hostname` keeps the brackets on an IPv6 literal, so the bracketed form is what matches. */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

export class ConfigError extends Error {
  constructor(missing: string[]) {
    super(`missing configuration: ${missing.join(', ')}`)
    this.name = 'ConfigError'
  }
}

/**
 * The loopback origin to use as the Blotout OAuth callback in local development.
 *
 * `shopline app dev` mints a new tunnel hostname on every run, and Blotout matches a registered
 * redirect URI by exact string — so the registration went stale each time and connecting failed
 * with "Authorization failed" until someone re-registered by hand. Blotout follows RFC 8252 for
 * loopback redirects and ignores the **port**, so one registration of
 * `http://localhost:<any port>/api/qinto/callback` covers every future run. The
 * developer's own browser is what follows this redirect, so loopback reaches the Worker.
 *
 * **Loopback only, and it throws otherwise.** This value decides where an authorization code is
 * delivered, so a non-loopback value would be a way to send a merchant's code somewhere else. The
 * check makes it useless for anything but its purpose.
 */
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

/**
 * Reads configuration once per request, failing loudly on anything absent.
 *
 * Every value is required, and none has a default. A silent fallback here would mean signing with
 * an empty secret or encrypting under an empty key.
 */
export const readConfig = (env: Env): AppConfig => {
  const config = {
    appKey: env.SHOPLINE_APP_KEY,
    appSecret: env.SHOPLINE_APP_SECRET,
    apiHost: env.SHOPLINE_API_HOST,
    blotoutApiOrigin: env.QINTO_API_ORIGIN,
    blotoutAuthorizeOrigin: env.QINTO_AUTHORIZE_ORIGIN,
    blotoutClientId: env.QINTO_CLIENT_ID,
    blotoutClientSecret: env.QINTO_CLIENT_SECRET,
    tokenKek: env.TOKEN_KEK
  }

  const missing = Object.entries(config)
    .filter(([, value]) => typeof value !== 'string' || value === '')
    .map(([key]) => key)
  if (missing.length > 0) {
    throw new ConfigError(missing)
  }

  const devCallbackOrigin = readDevCallbackOrigin(env.QINTO_DEV_CALLBACK_ORIGIN)

  return devCallbackOrigin === undefined ? config : { ...config, devCallbackOrigin }
}

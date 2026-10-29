import type { AppConfig } from '../config'
import { QINTO_SCOPES } from '../config'

export type BlotoutGrant = {
  accessToken: string
  refreshToken: string | null
  scope: string
  expiresAt: Date
}

export class BlotoutOauthError extends Error {
  /** The RFC 6749 error code, when the server sent one. */
  readonly code: string | undefined

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'BlotoutOauthError'
    this.code = code
  }
}

const base64Url = (bytes: Uint8Array): string => {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

export type PkcePair = { verifier: string; challenge: string }

/** A PKCE verifier and its S256 challenge. Blotout requires PKCE on every authorization code. */
export const createPkcePair = async (): Promise<PkcePair> => {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier) as BufferSource)

  return { verifier, challenge: base64Url(new Uint8Array(digest)) }
}

export const createState = (): string => base64Url(crypto.getRandomValues(new Uint8Array(24)))

/**
 * Where the merchant approves the Blotout grant.
 *
 * This has to open at the top level: the consent screen sets `frame-ancestors 'none'`, so rendering
 * it inside the SHOPLINE Admin iframe shows the merchant a blank box.
 *
 * `prompt=consent` is not optional here. Without it Blotout skips the
 * screen whenever one prior grant already covers these scopes and silently re-issues *that grant's
 * team selection* — so a merchant who has since joined a team, or who unticked one the first time,
 * can never widen it: connecting again returns the same teams forever. On a first connect there is
 * no prior grant, so this changes nothing; on every later one it is the difference between showing
 * the merchant the team list and quietly reusing a stale answer.
 */
export const authorizeUrl = (config: AppConfig, params: { state: string; challenge: string; redirectUri: string }): string => {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: config.blotoutClientId,
    redirect_uri: params.redirectUri,
    scope: QINTO_SCOPES.join(' '),
    state: params.state,
    code_challenge: params.challenge,
    code_challenge_method: 'S256',
    prompt: 'consent'
  })

  return `${config.blotoutAuthorizeOrigin}/oauth/authorize?${query.toString()}`
}

type TokenResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

/**
 * The `Authorization` header for a confidential client.
 *
 * **HTTP Basic, and only Basic.** Blotout's RFC 8414 metadata lists `client_secret_basic`,
 * `client_secret_post` and `none` as *server* capabilities, but each registered app is pinned to
 * exactly one: `authenticateOauthClient` compares the method used against the app's
 * `tokenEndpointAuthMethod` and answers `invalid_client` on a mismatch, whatever the secret. Apps
 * registered through the portal get `client_secret_basic`, so sending the secret in the form body
 * fails with `invalid_client` — which reads like a wrong secret and is not.
 *
 * Both halves are form-urlencoded before base64 per RFC 6749 §2.3.1.
 */
const basicAuth = (config: AppConfig): string => {
  const credentials = `${encodeURIComponent(config.blotoutClientId)}:${encodeURIComponent(config.blotoutClientSecret)}`

  return `Basic ${btoa(credentials)}`
}

const postToken = async (config: AppConfig, form: Record<string, string>): Promise<BlotoutGrant> => {
  const response = await fetch(`${config.blotoutApiOrigin}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuth(config) },
    body: new URLSearchParams(form).toString()
  })

  const body = (await response.json().catch(() => ({}))) as TokenResponse
  if (!response.ok || body.access_token === undefined) {
    throw new BlotoutOauthError(
      `token endpoint returned ${response.status}: ${body.error_description ?? body.error ?? 'no detail'}`,
      body.error
    )
  }

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    scope: body.scope ?? '',
    // Treated as absent rather than assumed long-lived: an unknown lifetime should refresh eagerly.
    expiresAt: new Date(Date.now() + (body.expires_in ?? 0) * 1000)
  }
}

export const exchangeCode = (config: AppConfig, params: { code: string; verifier: string; redirectUri: string }): Promise<BlotoutGrant> => {
  return postToken(config, {
    grant_type: 'authorization_code',
    code: params.code,
    code_verifier: params.verifier,
    redirect_uri: params.redirectUri
  })
}

export const refreshGrant = (config: AppConfig, refreshToken: string): Promise<BlotoutGrant> => {
  return postToken(config, { grant_type: 'refresh_token', refresh_token: refreshToken })
}

/**
 * Revokes a token, best-effort.
 *
 * Disconnecting must succeed locally even if Blotout is unreachable, so a failure here is swallowed:
 * the alternative is a store stuck in a connected state it has asked to leave.
 */
export const revokeToken = async (config: AppConfig, token: string): Promise<void> => {
  await fetch(`${config.blotoutApiOrigin}/oauth/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuth(config) },
    body: new URLSearchParams({ token }).toString()
  }).catch(() => undefined)
}

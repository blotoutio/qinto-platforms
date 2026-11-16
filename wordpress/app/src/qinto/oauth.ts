import type { AppConfig } from '../config'
import { QINTO_SCOPES } from '../config'
import { toBase64Url } from '../crypto/hmac'

export type QintoGrant = {
  accessToken: string
  refreshToken: string | null
  scope: string
  expiresAt: Date
}

export class QintoOauthError extends Error {
  /** The RFC 6749 error code, when the server sent one. */
  readonly code: string | undefined

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'QintoOauthError'
    this.code = code
  }
}

const randomBase64Url = (bytes: number): string => toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)))

export const createPkceVerifier = (): string => randomBase64Url(32)

export const createState = (): string => randomBase64Url(24)

export const challengeFor = async (verifier: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier) as BufferSource)

  return toBase64Url(new Uint8Array(digest))
}

/** `prompt=consent` always shows the team list; without it Qinto reuses the last grant's teams. */
export const authorizeUrl = (config: AppConfig, params: { state: string; challenge: string; redirectUri: string }): string => {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: config.qintoClientId,
    redirect_uri: params.redirectUri,
    scope: QINTO_SCOPES.join(' '),
    state: params.state,
    code_challenge: params.challenge,
    code_challenge_method: 'S256',
    prompt: 'consent'
  })

  return `${config.qintoAuthorizeOrigin}/oauth/authorize?${query.toString()}`
}

type TokenResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

/** Basic only: Qinto pins each client to one auth method and answers `invalid_client` otherwise. */
const basicAuth = (config: AppConfig): string => {
  return `Basic ${btoa(`${encodeURIComponent(config.qintoClientId)}:${encodeURIComponent(config.qintoClientSecret)}`)}`
}

const postForm = (config: AppConfig, path: string, form: Record<string, string>): Promise<Response> => {
  return fetch(`${config.qintoApiOrigin}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuth(config) },
    body: new URLSearchParams(form).toString()
  })
}

const requestToken = async (config: AppConfig, form: Record<string, string>): Promise<QintoGrant> => {
  const response = await postForm(config, '/oauth/token', form)
  const body = (await response.json().catch(() => ({}))) as TokenResponse
  if (!response.ok || body.access_token === undefined) {
    const detail = body.error_description ?? body.error ?? 'no detail'
    throw new QintoOauthError(`token endpoint returned ${response.status}: ${detail}`, body.error)
  }

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    scope: body.scope ?? '',
    // No `expires_in` means expired now, so it refreshes rather than being trusted.
    expiresAt: new Date(Date.now() + (body.expires_in ?? 0) * 1000)
  }
}

export const exchangeCode = (config: AppConfig, params: { code: string; verifier: string; redirectUri: string }): Promise<QintoGrant> => {
  return requestToken(config, {
    grant_type: 'authorization_code',
    code: params.code,
    code_verifier: params.verifier,
    redirect_uri: params.redirectUri
  })
}

export const refreshGrant = (config: AppConfig, refreshToken: string): Promise<QintoGrant> => {
  return requestToken(config, { grant_type: 'refresh_token', refresh_token: refreshToken })
}

/** Best effort: a disconnect must succeed locally even when Qinto is unreachable. */
export const revokeToken = async (config: AppConfig, token: string): Promise<void> => {
  await postForm(config, '/oauth/revoke', { token }).catch(() => undefined)
}

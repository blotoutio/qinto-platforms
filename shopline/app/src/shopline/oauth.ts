import type { AppConfig } from '../config'
import { SHOPLINE_SCOPES } from '../config'
import { hmacSha256Hex } from './crypto'

export type ShoplineGrant = {
  accessToken: string
  scope: string
  expiresAt: Date
}

export class ShoplineOauthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShoplineOauthError'
  }
}

const storeOrigin = (config: AppConfig, handle: string): string => {
  return `https://${handle}.${config.apiHost}`
}

/**
 * Where the merchant approves the install.
 *
 * The path is a fragment route (`/admin/oauth-web/#/oauth/authorize`), so the query has to sit
 * before the `#` or the SHOPLINE Admin SPA never sees it.
 */
export const authorizeUrl = (config: AppConfig, handle: string, redirectUri: string): string => {
  const query = new URLSearchParams({
    appKey: config.appKey,
    responseType: 'code',
    scope: SHOPLINE_SCOPES.join(','),
    redirectUri
  })

  return `${storeOrigin(config, handle)}/admin/oauth-web/#/oauth/authorize?${query.toString()}`
}

type TokenEnvelope = {
  code?: number
  message?: string
  data?: { accessToken?: string; scope?: string; expireTime?: string }
}

const readGrant = async (response: Response, what: string): Promise<ShoplineGrant> => {
  if (!response.ok) {
    throw new ShoplineOauthError(`${what} failed: HTTP ${response.status}`)
  }

  const envelope = (await response.json()) as TokenEnvelope
  if (envelope.code !== 200 || envelope.data?.accessToken === undefined) {
    throw new ShoplineOauthError(`${what} failed: ${envelope.code ?? 'no code'} ${envelope.message ?? ''}`.trim())
  }

  const expiresAt = new Date(envelope.data.expireTime ?? '')
  if (Number.isNaN(expiresAt.getTime())) {
    throw new ShoplineOauthError(`${what} returned no usable expireTime`)
  }

  return { accessToken: envelope.data.accessToken, scope: envelope.data.scope ?? '', expiresAt }
}

/**
 * Signs an app-credential request.
 *
 * The signature covers the JSON body, if any, immediately followed by the millisecond timestamp —
 * `{"code":"…"}1788897712345`. There is no separator, and the body must be the exact bytes sent.
 */
const signedHeaders = async (config: AppConfig, body: string | undefined): Promise<Record<string, string>> => {
  const timestamp = Date.now()

  return {
    appkey: config.appKey,
    sign: await hmacSha256Hex(config.appSecret, `${body ?? ''}${timestamp}`),
    timestamp: String(timestamp),
    'content-type': 'application/json'
  }
}

/** Exchanges the install callback's `code` for the store's access token. */
export const exchangeInstallCode = async (config: AppConfig, handle: string, code: string): Promise<ShoplineGrant> => {
  const body = JSON.stringify({ code })
  const response = await fetch(`${storeOrigin(config, handle)}/admin/oauth/token/create`, {
    method: 'POST',
    headers: await signedHeaders(config, body),
    body
  })

  return readGrant(response, 'token create')
}

/**
 * Renews the store's access token.
 *
 * There is no refresh token to present: the request is authenticated by the app's own credentials
 * and addressed to the store's handle, so a store that has uninstalled simply refuses it.
 */
export const refreshAccessToken = async (config: AppConfig, handle: string): Promise<ShoplineGrant> => {
  const response = await fetch(`${storeOrigin(config, handle)}/admin/oauth/token/refresh`, {
    method: 'POST',
    headers: await signedHeaders(config, undefined)
  })

  return readGrant(response, 'token refresh')
}

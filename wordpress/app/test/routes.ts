import { env } from 'cloudflare:workers'

import { hmacSha256Hex, sha256Hex } from '../src/crypto/hmac'
import app from '../src/index'
import { canonicalMessage } from '../src/services/signature'
import type { SeededRegistration } from './helpers'

export const ORIGIN = 'https://consent-wordpress.blotout.io'

/** Lets every `/register` through unless a test swaps it. */
export const allowAll: RateLimit = { limit: async () => ({ success: true }) }

export type CallOptions = {
  method?: string
  body?: string
  headers?: Record<string, string>
  env?: Partial<Env>
}

export const call = async (path: string, options: CallOptions = {}): Promise<Response> => {
  return await app.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: options.method ?? 'GET',
      redirect: 'manual',
      headers: { ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...options.headers },
      ...(options.body === undefined ? {} : { body: options.body })
    }),
    { ...env, REGISTER_LIMITER: allowAll, SHARE_LIMITER: allowAll, ...options.env } as typeof env
  )
}

export type SignOptions = {
  method?: string
  body?: unknown
  /** Overrides any signed part, to prove the broker binds it. */
  tamper?: Partial<{ shopId: string; method: string; pathAndQuery: string; body: string; timestamp: string; nonce: string }>
  secret?: string
  signature?: string
}

/** Signs a call the way the plugin's `RequestSigner` does. */
export const signedHeaders = async (registration: SeededRegistration, path: string, options: SignOptions = {}) => {
  const body = options.body === undefined ? '' : JSON.stringify(options.body)
  const timestamp = options.tamper?.timestamp ?? String(Math.floor(Date.now() / 1000))
  const nonce = options.tamper?.nonce ?? crypto.randomUUID().replaceAll('-', '')
  const message = canonicalMessage({
    registrationId: registration.id,
    timestamp,
    nonce,
    shopId: options.tamper?.shopId ?? registration.shopId,
    method: options.tamper?.method ?? options.method ?? 'GET',
    pathAndQuery: options.tamper?.pathAndQuery ?? path,
    bodySha256: await sha256Hex(options.tamper?.body ?? body)
  })

  return {
    body,
    headers: {
      'X-Blotout-Registration': registration.id,
      'X-Blotout-Ts': timestamp,
      'X-Blotout-Nonce': nonce,
      'X-Blotout-Sig': options.signature ?? (await hmacSha256Hex(options.secret ?? registration.secret, message))
    }
  }
}

export const signedCall = async (registration: SeededRegistration, path: string, options: SignOptions = {}): Promise<Response> => {
  const method = options.method ?? 'GET'
  const signed = await signedHeaders(registration, path, options)

  return call(path, { method, headers: signed.headers, ...(method === 'GET' ? {} : { body: signed.body }) })
}

export const signedJson = async <T>(registration: SeededRegistration, path: string, options: SignOptions = {}) => {
  const response = await signedCall(registration, path, options)

  return { status: response.status, body: (await response.json()) as T }
}

/**
 * The three cryptographic primitives SHOPLINE's auth protocol needs, on WebCrypto.
 *
 * `shopline-api-js` implements the same three with `crypto-js`, `jsonwebtoken` and `axios`. Its
 * answers must match ours byte for byte, so each function below records exactly which detail of the
 * upstream implementation it is reproducing.
 */

const encoder = new TextEncoder()

const hmacKey = (secret: string): Promise<CryptoKey> => {
  return crypto.subtle.importKey('raw', encoder.encode(secret) as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify'
  ])
}

const toHex = (bytes: ArrayBuffer): string => {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * HMAC-SHA256, lowercase hex.
 *
 * Hex because `crypto-js`'s `.toString()` defaults to it; SHOPLINE compares the string.
 */
export const hmacSha256Hex = async (secret: string, message: string): Promise<string> => {
  return toHex(await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(message) as BufferSource))
}

/** Constant-time string comparison, so a signature check leaks nothing through timing. */
export const safeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) {
    return false
  }

  let diff = 0
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }

  return diff === 0
}

/**
 * The string SHOPLINE signs for an OAuth callback: every query parameter except `sign`, sorted by
 * key, serialized as `URLSearchParams`.
 *
 * `localeCompare` is what upstream sorts with. For the ASCII keys SHOPLINE sends it agrees with
 * ordinary comparison, and using it here keeps the two implementations aligned if that ever stops
 * being true.
 */
export const signedQueryString = (query: Record<string, string>): string => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)
    .filter(([key]) => key !== 'sign')
    .sort(([a], [b]) => a.localeCompare(b))) {
    params.append(key, value)
  }

  return params.toString()
}

const TEN_MINUTES_MS = 10 * 60 * 1000

export type CallbackVerification = { valid: true } | { valid: false; reason: 'stale_timestamp' | 'bad_signature' }

/**
 * Verifies an install-callback query.
 *
 * The timestamp window is checked first and separately: an expired signature is a retry, a wrong
 * signature is an attack, and the two deserve different log lines.
 */
export const verifyCallbackSignature = async (
  appSecret: string,
  query: Record<string, string>,
  now = Date.now()
): Promise<CallbackVerification> => {
  const timestamp = Number(query['timestamp'])
  if (!Number.isFinite(timestamp) || now - timestamp > TEN_MINUTES_MS) {
    return { valid: false, reason: 'stale_timestamp' }
  }

  const expected = await hmacSha256Hex(appSecret, signedQueryString(query))
  if (!safeEqual(expected, query['sign'] ?? '')) {
    return { valid: false, reason: 'bad_signature' }
  }

  return { valid: true }
}

/** Verifies a webhook body against `X-Shopline-Hmac-Sha256`. */
export const verifyWebhookSignature = async (appSecret: string, rawBody: string, hmac: string): Promise<boolean> => {
  return safeEqual(await hmacSha256Hex(appSecret, rawBody), hmac)
}

export type SessionTokenClaims = {
  /** Store handle, e.g. `srini-test`. */
  handle: string
  /** The staff user this token was minted for. */
  sub: string
  exp: number
  iss?: string
  aud?: string
  sid?: string
}

export class SessionTokenError extends Error {
  constructor(reason: string) {
    super(`session token rejected: ${reason}`)
    this.name = 'SessionTokenError'
  }
}

const decodeBase64Url = (value: string): string => {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/')
  return atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), '='))
}

/**
 * UTF-8 base64, matching `js-base64`'s `Base64.encode`.
 *
 * `btoa` alone throws above U+00FF and would encode the wrong bytes below it. App secrets are hex,
 * so the two agree today; this keeps them agreeing if that changes.
 */
const base64Utf8 = (value: string): string => {
  return btoa(String.fromCharCode(...encoder.encode(value)))
}

/**
 * Verifies the App Bridge session token.
 *
 * HS256, and the key is the **base64 encoding of the app secret** read as UTF-8 bytes — upstream
 * calls `jwt.verify(token, Base64.encode(appSecret))`, and `jsonwebtoken` takes a string secret as
 * its raw key material. Signing over the app secret itself would fail every token.
 */
export const verifySessionToken = async (appSecret: string, token: string, now = Date.now()): Promise<SessionTokenClaims> => {
  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new SessionTokenError('malformed')
  }

  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string]

  let header: { alg?: string }
  let claims: Partial<SessionTokenClaims> & { nbf?: number }
  try {
    header = JSON.parse(decodeBase64Url(headerPart))
    claims = JSON.parse(decodeBase64Url(payloadPart))
  } catch {
    throw new SessionTokenError('unparseable')
  }

  if (header.alg !== 'HS256') {
    throw new SessionTokenError(`unexpected alg ${String(header.alg)}`)
  }

  const expected = await hmacSha256Hex(base64Utf8(appSecret), `${headerPart}.${payloadPart}`)
  const signature = toHex(Uint8Array.from(decodeBase64Url(signaturePart), (character) => character.charCodeAt(0)).buffer)
  if (!safeEqual(expected, signature)) {
    throw new SessionTokenError('bad signature')
  }

  const nowSeconds = Math.floor(now / 1000)
  if (typeof claims.exp !== 'number' || claims.exp <= nowSeconds) {
    throw new SessionTokenError('expired')
  }

  if (typeof claims.nbf === 'number' && claims.nbf > nowSeconds) {
    throw new SessionTokenError('not yet valid')
  }

  if (typeof claims.handle !== 'string' || claims.handle === '') {
    throw new SessionTokenError('missing handle')
  }

  return { ...claims, handle: claims.handle, sub: claims.sub ?? '', exp: claims.exp }
}

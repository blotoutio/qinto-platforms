import type { AppConfig } from '../config'
import { hmacSha256Hex, sha256Hex, timingSafeEqual } from '../crypto/hmac'
import type { Db } from '../db/client'
import { consumeNonce } from '../db/queries/nonces'
import type { Registration } from '../db/queries/registrations'
import { findRegistration, readSiteSecret, touchRegistration } from '../db/queries/registrations'

/** Allowed clock skew. A used nonce is kept this long past its timestamp. */
export const SIGNATURE_WINDOW_MS = 5 * 60 * 1000

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const TIMESTAMP_PATTERN = /^\d{1,12}$/
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/
const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/

type SignedParts = {
  registrationId: string
  timestamp: string
  nonce: string
  shopId: string
  method: string
  pathAndQuery: string
  bodySha256: string
}

/** What the plugin signs. Must match `RequestSigner.php` byte for byte. `shopId` is the stored one, never a header. */
export const canonicalMessage = (parts: SignedParts): string => {
  return ['v1', parts.registrationId, parts.timestamp, parts.nonce, parts.shopId, parts.method, parts.pathAndQuery, parts.bodySha256].join(
    '\n'
  )
}

type SignedRequest = { headers: Headers; method: string; url: string; body: string }

/** Only `unknown_registration` tells the plugin to drop its secret and register again. */
type VerifyFailure = 'unauthorized' | 'clock_skew' | 'unknown_registration' | 'replay'

type VerifyResult = { ok: true; registration: Registration } | { ok: false; reason: VerifyFailure }

const readHeaders = (headers: Headers) => {
  const registrationId = headers.get('x-blotout-registration') ?? ''
  const timestamp = headers.get('x-blotout-ts') ?? ''
  const nonce = headers.get('x-blotout-nonce') ?? ''
  const signature = headers.get('x-blotout-sig') ?? ''
  const wellFormed =
    UUID_PATTERN.test(registrationId) && TIMESTAMP_PATTERN.test(timestamp) && NONCE_PATTERN.test(nonce) && SIGNATURE_PATTERN.test(signature)

  return wellFormed ? { registrationId, timestamp, nonce, signature } : undefined
}

/** Cheap checks first; the nonce is consumed only after the signature is proven, so a forger cannot burn nonces. */
export const verifySignedRequest = async (
  db: Db,
  config: AppConfig,
  request: SignedRequest,
  options: { allowUnverified: boolean; now?: number }
): Promise<VerifyResult> => {
  const now = options.now ?? Date.now()
  const headers = readHeaders(request.headers)
  if (headers === undefined) {
    return { ok: false, reason: 'unauthorized' }
  }

  const signedAtMs = Number(headers.timestamp) * 1000
  if (Math.abs(now - signedAtMs) > SIGNATURE_WINDOW_MS) {
    return { ok: false, reason: 'clock_skew' }
  }

  const registration = await findRegistration(db, headers.registrationId)
  if (registration === undefined || (registration.verifiedAt === null && !options.allowUnverified)) {
    return { ok: false, reason: 'unknown_registration' }
  }

  const secret = await readSiteSecret(config, registration)
  const url = new URL(request.url)
  const message = canonicalMessage({
    registrationId: headers.registrationId,
    timestamp: headers.timestamp,
    nonce: headers.nonce,
    shopId: registration.shopId,
    method: request.method.toUpperCase(),
    pathAndQuery: `${url.pathname}${url.search}`,
    bodySha256: await sha256Hex(request.body)
  })
  if (!timingSafeEqual(await hmacSha256Hex(secret, message), headers.signature)) {
    return { ok: false, reason: 'unauthorized' }
  }

  // Kept until the signature itself expires: a timestamp up to the window ahead stays valid that long.
  const expiresAt = new Date(signedAtMs + SIGNATURE_WINDOW_MS)
  if (!(await consumeNonce(db, { registrationId: registration.id, nonce: headers.nonce, expiresAt }))) {
    return { ok: false, reason: 'replay' }
  }

  await touchRegistration(db, registration.id, now)

  return { ok: true, registration }
}

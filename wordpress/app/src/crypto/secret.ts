import { toBase64Url } from './hmac'

/** AES-256-GCM for every secret this app stores. Envelope: `v1.<iv>.<ciphertext>`, base64url. */

const VERSION = 'v1'
const IV_BYTES = 12

const encoder = new TextEncoder()

/** A wrong key, a wrong AAD and tampered bytes are deliberately indistinguishable. */
export class SecretDecryptError extends Error {
  constructor() {
    super('secret could not be decrypted')
    this.name = 'SecretDecryptError'
  }
}

export class SecretKeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecretKeyError'
  }
}

const fromBase64 = (value: string): Uint8Array => {
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }

  return bytes
}

const loadKey = async (kek: string): Promise<CryptoKey> => {
  const raw = fromBase64(kek)
  if (raw.length !== 32) {
    throw new SecretKeyError(`TOKEN_KEK must decode to 32 bytes, got ${raw.length}`)
  }

  return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

const keyCache = new Map<string, Promise<CryptoKey>>()

const importKey = (kek: string): Promise<CryptoKey> => {
  let key = keyCache.get(kek)
  if (key === undefined) {
    key = loadKey(kek)
    keyCache.set(kek, key)
  }

  return key
}

/** `<table>:<id>:<column>`, so a ciphertext moved to another row or column fails to decrypt. */
export const secretAad = (table: string, primaryKey: string, column: string): string => `${table}:${primaryKey}:${column}`

/** `kek` is base64 of 32 bytes (`env.TOKEN_KEK`); `aad` comes from `secretAad`. */
export const encryptSecret = async (kek: string, plaintext: string, aad: string): Promise<string> => {
  const key = await importKey(kek)
  // Never reuse an IV under one AES-GCM key: a fresh one every call.
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: encoder.encode(aad) as BufferSource },
    key,
    encoder.encode(plaintext) as BufferSource
  )

  return `${VERSION}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`
}

/** Every failure but a bad key is a bare `SecretDecryptError`; it never names the envelope or plaintext. */
export const decryptSecret = async (kek: string, envelope: string, aad: string): Promise<string> => {
  const parts = envelope.split('.')
  if (parts.length !== 3 || parts[0] !== VERSION) {
    throw new SecretDecryptError()
  }

  const [, iv, ciphertext] = parts as [string, string, string]
  try {
    const key = await importKey(kek)
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(iv) as BufferSource, additionalData: encoder.encode(aad) as BufferSource },
      key,
      fromBase64(ciphertext) as BufferSource
    )

    return new TextDecoder().decode(plaintext)
  } catch (error) {
    if (error instanceof SecretKeyError) {
      throw error
    }

    throw new SecretDecryptError()
  }
}

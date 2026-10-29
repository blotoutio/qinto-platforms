/**
 * AES-256-GCM envelope encryption for every token this app stores.
 *
 * One helper, one code path, so "is this column encrypted?" is answered by whether it goes through
 * here rather than by reading each caller.
 */

const IV_BYTES = 12
const VERSION = 'v1'

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

const base64ToBytes = (value: string): Uint8Array => {
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }

  return bytes
}

const bytesToBase64Url = (bytes: Uint8Array): string => {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

// Importing the key is a syscall-ish cost per call; the isolate is reused, the KEK is not.
const keyCache = new Map<string, Promise<CryptoKey>>()

const importKey = (kek: string): Promise<CryptoKey> => {
  const cached = keyCache.get(kek)
  if (cached !== undefined) {
    return cached
  }

  const imported = (async () => {
    const raw = base64ToBytes(kek)
    if (raw.length !== 32) {
      throw new SecretKeyError(`TOKEN_KEK must decode to 32 bytes, got ${raw.length}`)
    }

    return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
  })()

  keyCache.set(kek, imported)

  return imported
}

/**
 * Binds a ciphertext to the row and column it belongs to.
 *
 * A ciphertext lifted into another row or another column fails to decrypt, so a database write
 * cannot move one store's token onto another store.
 */
export const secretAad = (table: string, primaryKey: string, column: string): string => {
  return `${table}:${primaryKey}:${column}`
}

/**
 * Encrypts one secret.
 *
 * @param kek Base64 of 32 random bytes, from `env.TOKEN_KEK`.
 * @param plaintext The secret. Never logged, never returned to a caller in the clear.
 * @param aad From `secretAad`.
 * @returns `v1.<iv>.<ciphertext>`, base64url, safe to store in one text column.
 */
export const encryptSecret = async (kek: string, plaintext: string, aad: string): Promise<string> => {
  const key = await importKey(kek)
  // A fresh IV every call. Reusing one under a single AES-GCM key breaks the cipher outright, so
  // there is no code path that supplies, caches or derives it.
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const encoder = new TextEncoder()
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: encoder.encode(aad) as BufferSource },
    key,
    encoder.encode(plaintext) as BufferSource
  )

  return `${VERSION}.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(ciphertext))}`
}

/**
 * Decrypts one secret.
 *
 * @throws SecretDecryptError for any failure, without distinguishing the cause and without ever
 * putting the envelope or the plaintext in the message.
 */
export const decryptSecret = async (kek: string, envelope: string, aad: string): Promise<string> => {
  const parts = envelope.split('.')
  if (parts.length !== 3 || parts[0] !== VERSION) {
    throw new SecretDecryptError()
  }

  const [, ivPart, ciphertextPart] = parts as [string, string, string]
  try {
    const key = await importKey(kek)
    const encoder = new TextEncoder()
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: base64ToBytes(ivPart) as BufferSource,
        additionalData: encoder.encode(aad) as BufferSource
      },
      key,
      base64ToBytes(ciphertextPart) as BufferSource
    )

    return new TextDecoder().decode(plaintext)
  } catch (error) {
    if (error instanceof SecretKeyError) {
      throw error
    }

    throw new SecretDecryptError()
  }
}

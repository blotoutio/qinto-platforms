import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { decryptSecret, encryptSecret, SecretDecryptError, SecretKeyError, secretAad } from '../src/crypto/secret'

const KEK = env.TOKEN_KEK
const AAD = secretAad('shopline_sessions', 'offline_srini-test', 'access_token_enc')

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a token', async () => {
    const envelope = await encryptSecret(KEK, 'qoa_super_secret', AAD)

    await expect(decryptSecret(KEK, envelope, AAD)).resolves.toBe('qoa_super_secret')
  })

  it('produces a different ciphertext each time, proving the IV is fresh', async () => {
    const first = await encryptSecret(KEK, 'same-plaintext', AAD)
    const second = await encryptSecret(KEK, 'same-plaintext', AAD)

    expect(first).not.toBe(second)
    // The IV is the second segment, and it is what must differ.
    expect(first.split('.')[1]).not.toBe(second.split('.')[1])
  })

  it('is versioned so the format can change without a migration', async () => {
    expect(await encryptSecret(KEK, 'x', AAD)).toMatch(/^v1\./)
  })

  it('round-trips a value containing multi-byte characters', async () => {
    const value = 'tökén–✓'

    await expect(decryptSecret(KEK, await encryptSecret(KEK, value, AAD), AAD)).resolves.toBe(value)
  })

  it('refuses a ciphertext moved to another row', async () => {
    const envelope = await encryptSecret(KEK, 'qoa_a', secretAad('qinto_connections', 'store-a', 'access_token_enc'))

    await expect(decryptSecret(KEK, envelope, secretAad('qinto_connections', 'store-b', 'access_token_enc'))).rejects.toThrow(
      SecretDecryptError
    )
  })

  it('refuses a ciphertext moved to another column of the same row', async () => {
    const envelope = await encryptSecret(KEK, 'qor_refresh', secretAad('qinto_connections', 'store-a', 'refresh_token_enc'))

    await expect(decryptSecret(KEK, envelope, secretAad('qinto_connections', 'store-a', 'access_token_enc'))).rejects.toThrow(
      SecretDecryptError
    )
  })
})

/**
 * Flips one bit of a base64url segment, on the bytes rather than the characters.
 *
 * Substituting a character is not reliable: base64url's final character can carry padding bits, so
 * swapping `A` for `B` there sometimes decodes to the identical bytes and the ciphertext is not
 * tampered with at all.
 */
const flipOneBit = (segment: string): string => {
  const padded = segment.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), '='))
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  bytes[0] = (bytes[0] ?? 0) ^ 0x01

  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

describe('tampering', () => {
  it('refuses a ciphertext with one bit flipped', async () => {
    const envelope = await encryptSecret(KEK, 'qoa_tamper', AAD)
    const [version, iv, ciphertext] = envelope.split('.') as [string, string, string]

    await expect(decryptSecret(KEK, `${version}.${iv}.${flipOneBit(ciphertext)}`, AAD)).rejects.toThrow(SecretDecryptError)
  })

  it('refuses a ciphertext with a flipped IV', async () => {
    const envelope = await encryptSecret(KEK, 'qoa_tamper', AAD)
    const [version, iv, ciphertext] = envelope.split('.') as [string, string, string]

    await expect(decryptSecret(KEK, `${version}.${flipOneBit(iv)}.${ciphertext}`, AAD)).rejects.toThrow(SecretDecryptError)
  })

  it('refuses a truncated ciphertext', async () => {
    const envelope = await encryptSecret(KEK, 'qoa_tamper', AAD)
    const [version, iv, ciphertext] = envelope.split('.') as [string, string, string]

    await expect(decryptSecret(KEK, `${version}.${iv}.${ciphertext.slice(0, -4)}`, AAD)).rejects.toThrow(SecretDecryptError)
  })
})

describe('more envelope handling', () => {
  it('refuses a ciphertext encrypted under another key', async () => {
    const other = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))

    await expect(decryptSecret(KEK, await encryptSecret(other, 'qoa_x', AAD), AAD)).rejects.toThrow(SecretDecryptError)
  })

  it.each([
    ['no separators', 'not-an-envelope'],
    ['an unknown version', 'v2.aaaa.bbbb'],
    ['too few segments', 'v1.aaaa'],
    ['too many segments', 'v1.aaaa.bbbb.cccc'],
    ['an empty string', '']
  ])('rejects a malformed envelope with %s', async (_label, envelope) => {
    await expect(decryptSecret(KEK, envelope, AAD)).rejects.toThrow(SecretDecryptError)
  })

  it('never leaks the envelope or the plaintext in the error', async () => {
    const envelope = await encryptSecret(KEK, 'qoa_do_not_log_me', AAD)

    const error = await decryptSecret(KEK, envelope, 'wrong:aad:here').catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(SecretDecryptError)
    expect((error as Error).message).not.toContain('qoa_')
    expect((error as Error).message).not.toContain(envelope)
  })

  it('refuses a key that is not 32 bytes', async () => {
    await expect(encryptSecret(btoa('short'), 'x', AAD)).rejects.toThrow(SecretKeyError)
  })

  it('surfaces a bad key on decrypt rather than disguising it as a decrypt failure', async () => {
    await expect(decryptSecret(btoa('short'), 'v1.AAAA.BBBB', AAD)).rejects.toThrow(SecretKeyError)
  })
})

describe('secretAad', () => {
  it('names the table, the row and the column', () => {
    expect(secretAad('qinto_connections', 'srini-test', 'refresh_token_enc')).toBe('qinto_connections:srini-test:refresh_token_enc')
  })
})

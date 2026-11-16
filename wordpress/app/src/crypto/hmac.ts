const encoder = new TextEncoder()

const toHex = (bytes: Uint8Array): string => {
  let hex = ''
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0')
  }

  return hex
}

/** Unpadded base64url. */
export const toBase64Url = (bytes: Uint8Array): string => {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

export const hmacSha256Hex = async (secret: string, message: string): Promise<string> => {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret) as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign'
  ])
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message) as BufferSource)

  return toHex(new Uint8Array(signature))
}

export const sha256Hex = async (value: string): Promise<string> => {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value) as BufferSource)))
}

/** Never short-circuits, so timing cannot reveal how much of a signature matched. */
export const timingSafeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) {
    return false
  }

  let mismatch = 0
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }

  return mismatch === 0
}

export const randomHex = (bytes: number): string => toHex(crypto.getRandomValues(new Uint8Array(bytes)))

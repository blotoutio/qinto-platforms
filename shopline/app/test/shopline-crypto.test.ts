import { describe, expect, it } from 'vitest'

import {
  hmacSha256Hex,
  SessionTokenError,
  safeEqual,
  signedQueryString,
  verifyCallbackSignature,
  verifySessionToken,
  verifyWebhookSignature
} from '../src/shopline/crypto'

const SECRET = 'test-app-secret'

const base64Url = (value: string): string => btoa(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')

/**
 * Mints a session token the way SHOPLINE does.
 *
 * The key is the **base64 of the app secret**, matching `jwt.verify(token, Base64.encode(secret))`
 * upstream. If this helper and `verifySessionToken` ever disagree about that, every real token
 * fails — which is precisely what these tests exist to catch.
 */
const mintSessionToken = async (claims: Record<string, unknown>, options?: { alg?: string; secret?: string }): Promise<string> => {
  const header = base64Url(JSON.stringify({ alg: options?.alg ?? 'HS256', typ: 'JWT' }))
  const payload = base64Url(JSON.stringify(claims))
  const hex = await hmacSha256Hex(btoa(options?.secret ?? SECRET), `${header}.${payload}`)
  const bytes = (hex.match(/../g) ?? []).map((pair) => Number.parseInt(pair, 16))

  return `${header}.${payload}.${base64Url(String.fromCharCode(...bytes))}`
}

describe('hmacSha256Hex', () => {
  it('is lowercase hex, matching crypto-js .toString()', async () => {
    expect(await hmacSha256Hex('key', 'message')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is stable for the same inputs', async () => {
    expect(await hmacSha256Hex('key', 'message')).toBe(await hmacSha256Hex('key', 'message'))
  })

  it('changes with the key', async () => {
    expect(await hmacSha256Hex('key-a', 'message')).not.toBe(await hmacSha256Hex('key-b', 'message'))
  })
})

describe('safeEqual', () => {
  it('accepts identical strings', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
  })

  it('rejects different strings of the same length', () => {
    expect(safeEqual('abc', 'abd')).toBe(false)
  })

  it('rejects different lengths without comparing', () => {
    expect(safeEqual('abc', 'abcd')).toBe(false)
  })
})

describe('signedQueryString', () => {
  it('sorts keys and drops sign', () => {
    expect(signedQueryString({ handle: 'shop', code: 'abc', sign: 'ignored', timestamp: '123' })).toBe('code=abc&handle=shop&timestamp=123')
  })

  it('percent-encodes values the way URLSearchParams does', () => {
    expect(signedQueryString({ a: 'x y', b: 'p+q' })).toBe('a=x+y&b=p%2Bq')
  })

  it('handles an empty query', () => {
    expect(signedQueryString({})).toBe('')
  })
})

describe('verifyCallbackSignature', () => {
  const now = 1_700_000_000_000

  const signed = async (extra: Record<string, string> = {}): Promise<Record<string, string>> => {
    const query = { handle: 'srini-test', code: 'the-code', timestamp: String(now), ...extra }

    return { ...query, sign: await hmacSha256Hex(SECRET, signedQueryString(query)) }
  }

  it('accepts a correctly signed, fresh query', async () => {
    await expect(verifyCallbackSignature(SECRET, await signed(), now + 1000)).resolves.toEqual({ valid: true })
  })

  it('rejects a query older than the ten-minute window as stale, not as forged', async () => {
    await expect(verifyCallbackSignature(SECRET, await signed(), now + 11 * 60 * 1000)).resolves.toEqual({
      valid: false,
      reason: 'stale_timestamp'
    })
  })

  it('rejects a missing timestamp', async () => {
    const query = await signed()
    const { timestamp: _dropped, ...rest } = query

    await expect(verifyCallbackSignature(SECRET, rest, now)).resolves.toEqual({ valid: false, reason: 'stale_timestamp' })
  })

  it('rejects a non-numeric timestamp', async () => {
    await expect(verifyCallbackSignature(SECRET, { ...(await signed()), timestamp: 'soon' }, now)).resolves.toEqual({
      valid: false,
      reason: 'stale_timestamp'
    })
  })

  it('rejects a tampered parameter', async () => {
    await expect(verifyCallbackSignature(SECRET, { ...(await signed()), handle: 'someone-else' }, now)).resolves.toEqual({
      valid: false,
      reason: 'bad_signature'
    })
  })

  it('rejects an absent signature', async () => {
    const { sign: _dropped, ...unsigned } = await signed()

    await expect(verifyCallbackSignature(SECRET, unsigned, now)).resolves.toEqual({ valid: false, reason: 'bad_signature' })
  })

  it('rejects a signature made with another secret', async () => {
    const query = { handle: 'srini-test', timestamp: String(now) }
    const forged = { ...query, sign: await hmacSha256Hex('not-our-secret', signedQueryString(query)) }

    await expect(verifyCallbackSignature(SECRET, forged, now)).resolves.toEqual({ valid: false, reason: 'bad_signature' })
  })
})

describe('verifyWebhookSignature', () => {
  const body = '{"handle":"srini-test","operate":"UNINSTALL"}'

  it('accepts a body signed with the app secret', async () => {
    await expect(verifyWebhookSignature(SECRET, body, await hmacSha256Hex(SECRET, body))).resolves.toBe(true)
  })

  it('rejects a modified body', async () => {
    const hmac = await hmacSha256Hex(SECRET, body)

    await expect(verifyWebhookSignature(SECRET, `${body} `, hmac)).resolves.toBe(false)
  })

  it('rejects a signature from another secret', async () => {
    await expect(verifyWebhookSignature(SECRET, body, await hmacSha256Hex('other', body))).resolves.toBe(false)
  })
})

describe('verifySessionToken', () => {
  const now = 1_700_000_000_000
  const future = Math.floor(now / 1000) + 600

  it('accepts a valid token and returns the handle and staff subject', async () => {
    const token = await mintSessionToken({ handle: 'srini-test', sub: 'staff-42', exp: future })

    await expect(verifySessionToken(SECRET, token, now)).resolves.toMatchObject({ handle: 'srini-test', sub: 'staff-42', exp: future })
  })

  it('defaults an absent subject to the empty string rather than failing', async () => {
    const token = await mintSessionToken({ handle: 'srini-test', exp: future })

    await expect(verifySessionToken(SECRET, token, now)).resolves.toMatchObject({ sub: '' })
  })

  it('accepts a token whose nbf has passed', async () => {
    const token = await mintSessionToken({ handle: 'srini-test', exp: future, nbf: Math.floor(now / 1000) - 10 })

    await expect(verifySessionToken(SECRET, token, now)).resolves.toMatchObject({ handle: 'srini-test' })
  })

  it('rejects a token that is not yet valid', async () => {
    const token = await mintSessionToken({ handle: 'srini-test', exp: future, nbf: future - 1 })

    await expect(verifySessionToken(SECRET, token, now)).rejects.toThrow(/not yet valid/)
  })

  it('rejects an expired token', async () => {
    const token = await mintSessionToken({ handle: 'srini-test', exp: Math.floor(now / 1000) - 1 })

    await expect(verifySessionToken(SECRET, token, now)).rejects.toThrow(/expired/)
  })

  it('rejects a token with no exp', async () => {
    const token = await mintSessionToken({ handle: 'srini-test' })

    await expect(verifySessionToken(SECRET, token, now)).rejects.toThrow(/expired/)
  })

  it('rejects a token with no handle', async () => {
    const token = await mintSessionToken({ sub: 'staff-42', exp: future })

    await expect(verifySessionToken(SECRET, token, now)).rejects.toThrow(/missing handle/)
  })

  it('rejects an empty handle', async () => {
    const token = await mintSessionToken({ handle: '', exp: future })

    await expect(verifySessionToken(SECRET, token, now)).rejects.toThrow(/missing handle/)
  })

  it('rejects a token signed with the raw secret instead of its base64', async () => {
    const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const payload = base64Url(JSON.stringify({ handle: 'srini-test', exp: future }))
    const hex = await hmacSha256Hex(SECRET, `${header}.${payload}`)
    const bytes = (hex.match(/../g) ?? []).map((pair) => Number.parseInt(pair, 16))
    const token = `${header}.${payload}.${base64Url(String.fromCharCode(...bytes))}`

    await expect(verifySessionToken(SECRET, token, now)).rejects.toThrow(/bad signature/)
  })

  it('rejects a token signed with another secret', async () => {
    const token = await mintSessionToken({ handle: 'srini-test', exp: future }, { secret: 'someone-elses-secret' })

    await expect(verifySessionToken(SECRET, token, now)).rejects.toThrow(/bad signature/)
  })

  it('rejects an algorithm other than HS256, including none', async () => {
    const token = await mintSessionToken({ handle: 'srini-test', exp: future }, { alg: 'none' })

    await expect(verifySessionToken(SECRET, token, now)).rejects.toThrow(/unexpected alg/)
  })

  it('rejects a token that is not three segments', async () => {
    await expect(verifySessionToken(SECRET, 'a.b', now)).rejects.toThrow(/malformed/)
  })

  it('rejects unparseable segments', async () => {
    await expect(verifySessionToken(SECRET, `${base64Url('not json')}.${base64Url('nope')}.sig`, now)).rejects.toThrow(/unparseable/)
  })

  it('throws SessionTokenError, which the middleware turns into a 401', async () => {
    await expect(verifySessionToken(SECRET, 'garbage', now)).rejects.toBeInstanceOf(SessionTokenError)
  })
})

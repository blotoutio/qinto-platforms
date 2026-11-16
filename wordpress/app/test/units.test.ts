import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it } from 'vitest'

import { verifyMessage, verifySiteOwnership } from '../src/common/site-verify'
import { isHostname, isReturnUrlFor, isSiteUrl, publicOrigin, siteOrigin } from '../src/common/urls'
import { ConfigError, QINTO_SCOPES, readConfig } from '../src/config'
import { hmacSha256Hex, randomHex, sha256Hex, timingSafeEqual } from '../src/crypto/hmac'
import { coveredByRoot } from '../src/qinto/origins'
import { RETURN_URL, stubFetch } from './helpers'

let restore: (() => void) | undefined
afterEach(() => {
  restore?.()
  restore = undefined
})

describe('hmac', () => {
  it('matches the RFC-style vector, so the PHP signer can be checked against the same one', async () => {
    expect(await hmacSha256Hex('key', 'The quick brown fox jumps over the lazy dog')).toBe(
      'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8'
    )
  })

  it('hashes the empty body the way every signed GET does', async () => {
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('compares in constant time and rejects any difference', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true)
    expect(timingSafeEqual('abc', 'abd')).toBe(false)
    expect(timingSafeEqual('abc', 'abcd')).toBe(false)
  })

  it('mints hex of the asked length, different every time', () => {
    expect(randomHex(32)).toMatch(/^[0-9a-f]{64}$/)
    expect(randomHex(16)).not.toBe(randomHex(16))
  })
})

describe('urls', () => {
  it('accepts only an https site URL without credentials', () => {
    expect(isSiteUrl('https://shop.example.com')).toBe(true)
    expect(isSiteUrl('http://shop.example.com')).toBe(false)
    expect(isSiteUrl('https://user:pw@shop.example.com')).toBe(false)
    expect(isSiteUrl('not a url')).toBe(false)
  })

  it("pins the return URL to the site's own admin-post.php", () => {
    expect(isReturnUrlFor(RETURN_URL, 'https://shop.example.com')).toBe(true)
    expect(isReturnUrlFor(RETURN_URL, 'https://other.example.com')).toBe(false)
    expect(isReturnUrlFor('https://shop.example.com/evil', 'https://shop.example.com')).toBe(false)
    expect(isReturnUrlFor('https://shop.example.com/wp-admin/admin-post.php/x', 'https://shop.example.com')).toBe(false)
    expect(isReturnUrlFor('http://shop.example.com/wp-admin/admin-post.php', 'https://shop.example.com')).toBe(false)
    expect(isReturnUrlFor('https://u@shop.example.com/wp-admin/admin-post.php', 'https://shop.example.com')).toBe(false)
    expect(isReturnUrlFor('nope', 'https://shop.example.com')).toBe(false)
    expect(isReturnUrlFor(RETURN_URL, 'nope')).toBe(false)
  })

  it('accepts lower-case hostnames only', () => {
    expect(isHostname('shop.example.com')).toBe(true)
    expect(isHostname('Shop.example.com')).toBe(false)
    expect(isHostname('localhost')).toBe(false)
    expect(isHostname('a/b.com')).toBe(false)
    expect(isHostname(42)).toBe(false)
  })

  it('derives the browser origin and the public origin', () => {
    expect(siteOrigin('https://shop.example.com/blog')).toBe('https://shop.example.com')
    expect(publicOrigin('http://consent-wordpress.blotout.io/x')).toBe('https://consent-wordpress.blotout.io')
    expect(publicOrigin('http://localhost:3458/x')).toBe('http://localhost:3458')
  })

  it('treats the root domain and its subdomains as already allowed by Qinto', () => {
    expect(coveredByRoot('https://shop.example.com', 'shop.example.com')).toBe(true)
    expect(coveredByRoot('https://www.shop.example.com', 'shop.example.com')).toBe(true)
    expect(coveredByRoot('https://myshop.example.com', 'shop.example.com')).toBe(false)
  })
})

describe('readConfig', () => {
  it('asks for the app-install scope alongside its domain:write base', () => {
    expect(QINTO_SCOPES).toContain('feature:manage_domain_apps:write')
    expect(QINTO_SCOPES).toContain('domain:write')
  })

  it('names every missing value', () => {
    expect(() => readConfig({ ...env, QINTO_CLIENT_SECRET: '', TOKEN_KEK: '' })).toThrow(
      'missing configuration: qintoClientSecret, tokenKek'
    )
  })

  it('accepts a loopback dev callback origin and normalises it', () => {
    expect(readConfig({ ...env, QINTO_DEV_CALLBACK_ORIGIN: 'http://localhost:3458/' }).devCallbackOrigin).toBe('http://localhost:3458')
    expect(readConfig({ ...env, QINTO_DEV_CALLBACK_ORIGIN: '' }).devCallbackOrigin).toBeUndefined()
  })

  it('refuses a dev callback origin that could send a code elsewhere', () => {
    expect(() => readConfig({ ...env, QINTO_DEV_CALLBACK_ORIGIN: 'https://evil.example.com' })).toThrow(ConfigError)
    expect(() => readConfig({ ...env, QINTO_DEV_CALLBACK_ORIGIN: 'not a url' })).toThrow(ConfigError)
  })
})

describe('verifySiteOwnership', () => {
  const SECRET = 'b'.repeat(64)

  const answerWith = (body: (challenge: string) => Promise<string> | string, status = 200) => {
    const stub = stubFetch(async (request) => {
      const challenge = new URL(request.url).searchParams.get('challenge') ?? ''

      return new Response(await body(challenge), { status })
    })
    restore = stub.restore

    return stub
  }

  it("passes when the site answers a fresh challenge with the registration's secret", async () => {
    const stub = answerWith((challenge) => hmacSha256Hex(SECRET, verifyMessage(challenge)))

    await expect(verifySiteOwnership(RETURN_URL, SECRET)).resolves.toBe(true)
    const url = new URL(stub.calls[0]?.url ?? '')
    expect(url.pathname).toBe('/wp-admin/admin-post.php')
    expect(url.searchParams.get('action')).toBe('blotout_verify')
    expect(url.searchParams.get('challenge')).toMatch(/^[0-9a-f]{32}$/)
  })

  it('fails on a stale answer, a wrong secret, an error status or a network failure', async () => {
    answerWith(() => hmacSha256Hex(SECRET, verifyMessage('an-old-challenge')))
    await expect(verifySiteOwnership(RETURN_URL, SECRET)).resolves.toBe(false)
    restore?.()

    answerWith((challenge) => hmacSha256Hex('c'.repeat(64), verifyMessage(challenge)))
    await expect(verifySiteOwnership(RETURN_URL, SECRET)).resolves.toBe(false)
    restore?.()

    answerWith(() => 'nope', 500)
    await expect(verifySiteOwnership(RETURN_URL, SECRET)).resolves.toBe(false)
    restore?.()

    restore = stubFetch(() => Promise.reject(new Error('offline'))).restore
    await expect(verifySiteOwnership(RETURN_URL, SECRET)).resolves.toBe(false)
  })
})

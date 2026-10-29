import { describe, expect, it } from 'vitest'

import { parseConsentValue, readConsent } from '../src/consent'

/** The sandbox's async cookie and localStorage proxies. */
const fakeBrowser = (
  cookies: Record<string, string> = {},
  storage: Record<string, string> = {},
  failures: { cookie?: boolean; storage?: boolean } = {}
) => ({
  cookie: {
    get: (name?: string) => (failures.cookie === true ? Promise.reject(new Error('blocked')) : Promise.resolve(cookies[name ?? ''] ?? ''))
  },
  localStorage: {
    getItem: (key: string) => (failures.storage === true ? Promise.reject(new Error('blocked')) : Promise.resolve(storage[key] ?? null))
  }
})

describe('parseConsentValue', () => {
  it.each(['1', 'true', 'yes', 'ALLOW', 'granted', ' accepted ', 'all'])('reads %s as a blanket grant', (value) => {
    expect(parseConsentValue(value)).toEqual({ necessary: true, functional: true, analytics: true, marketing: true, salesOfData: true })
  })

  it.each(['0', 'false', 'no', 'DENY', 'denied', 'rejected', 'none'])('reads %s as a blanket refusal', (value) => {
    expect(parseConsentValue(value)).toEqual({ necessary: true, functional: false, analytics: false, marketing: false, salesOfData: false })
  })

  it('always reports necessary as true, because a visitor cannot opt out of it', () => {
    expect(parseConsentValue('false')?.necessary).toBe(true)
  })

  it('reads a per-category object', () => {
    expect(parseConsentValue(JSON.stringify({ analytics: true, marketing: false, functional: true, salesOfData: false }))).toEqual({
      necessary: true,
      functional: true,
      analytics: true,
      marketing: false,
      salesOfData: false
    })
  })

  it.each([
    ['statistics', { statistics: true }, 'analytics'],
    ['performance', { performance: true }, 'analytics'],
    ['analytics_storage', { analytics_storage: 'granted' }, 'analytics'],
    ['advertising', { advertising: true }, 'marketing'],
    ['targeting', { targeting: true }, 'marketing'],
    ['ad_storage', { ad_storage: 'granted' }, 'marketing'],
    ['preferences', { preferences: true }, 'functional'],
    ['functionality_storage', { functionality_storage: 'granted' }, 'functional'],
    ['sale_of_data', { sale_of_data: true }, 'salesOfData'],
    ['sharing', { sharing: true }, 'salesOfData']
  ])('recognizes %s as %s', (_label, source, expected) => {
    expect(parseConsentValue(JSON.stringify(source))?.[expected as 'analytics']).toBe(true)
  })

  it('omits a category the store said nothing about, rather than guessing false', () => {
    // A guessed `false` would look like a refusal, and the edge would gate on it.
    expect(parseConsentValue(JSON.stringify({ analytics: true }))).toEqual({ necessary: true, analytics: true })
  })

  it.each([
    ['an empty string', ''],
    ['whitespace', '   '],
    ['unparseable JSON', '{oops'],
    ['a JSON array', '[1,2]'],
    ['JSON null', 'null'],
    ['an object with no recognizable category', JSON.stringify({ version: 2, ts: 1 })],
    ['an object whose values are not booleans', JSON.stringify({ analytics: 'maybe' })],
    ['a value that is not a string at all', null],
    ['a number', 7]
  ])('returns null for %s, so nothing is sent', (_label, value) => {
    expect(parseConsentValue(value)).toBeNull()
  })
})

describe('readConsent', () => {
  it.each(['shopline_consent', 'sl_consent', 'cookie_consent', 'cookieconsent_status', '_sl_consent'])(
    'finds a state in the %s cookie',
    async (name) => {
      await expect(readConsent(fakeBrowser({ [name]: 'accepted' }))).resolves.toMatchObject({ analytics: true })
    }
  )

  it('falls back to localStorage', async () => {
    await expect(readConsent(fakeBrowser({}, { shopline_consent: JSON.stringify({ analytics: false }) }))).resolves.toEqual({
      necessary: true,
      analytics: false
    })
  })

  it('prefers a cookie over localStorage', async () => {
    const browser = fakeBrowser({ shopline_consent: 'accepted' }, { shopline_consent: 'denied' })

    await expect(readConsent(browser)).resolves.toMatchObject({ analytics: true })
  })

  it('returns null when no store holds a state', async () => {
    // Sending nothing is the honest answer; the edge then applies the site's own default.
    await expect(readConsent(fakeBrowser())).resolves.toBeNull()
  })

  it('skips a cookie whose value it cannot read as consent', async () => {
    await expect(readConsent(fakeBrowser({ shopline_consent: 'v2:abc', sl_consent: 'accepted' }))).resolves.toMatchObject({
      analytics: true
    })
  })

  it('survives a cookie proxy that rejects', async () => {
    await expect(readConsent(fakeBrowser({}, { sl_consent: 'accepted' }, { cookie: true }))).resolves.toMatchObject({ analytics: true })
  })

  it('survives a storage proxy that rejects', async () => {
    await expect(readConsent(fakeBrowser({}, {}, { cookie: true, storage: true }))).resolves.toBeNull()
  })
})

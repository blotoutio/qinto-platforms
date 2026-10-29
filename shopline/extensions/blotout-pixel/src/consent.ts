import type { ConsentCategories } from './blotout-socket'

/**
 * Reads whatever consent state the storefront happens to hold, and maps it to Blotout's categories.
 *
 * **We never gate.** Every event and every identify call is sent regardless of what this returns;
 * the Blotout SDK and the tag worker's consent gate decide what reaches which destination app. This
 * only tells Blotout what the visitor chose, so it can make that decision.
 *
 * The sandbox has no `window.Shopline`, so the Customer Privacy API is unreachable and SHOPLINE
 * documents no consent surface for a pixel extension. What is left is the storefront's own cookie
 * or localStorage, read through the async `api.browser.*` proxies — and the key names are a
 * store-by-store guess. So: try the names below, and when none matches, send nothing rather than
 * inventing a state.
 */

type BrowserProxy = {
  cookie: { get: (name?: string) => Promise<string> }
  localStorage: { getItem: (key: string) => Promise<string | null> }
}

/** Names observed on SHOPLINE storefronts and in its consent-banner apps, most specific first. */
const CANDIDATE_KEYS = ['shopline_consent', 'sl_consent', 'cookie_consent', 'cookieconsent_status', '_sl_consent']

const GRANTED = new Set(['1', 'true', 'yes', 'allow', 'granted', 'accepted', 'all'])
const DENIED = new Set(['0', 'false', 'no', 'deny', 'denied', 'rejected', 'none'])

const asBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim().toLowerCase()
  if (GRANTED.has(normalized)) {
    return true
  }

  return DENIED.has(normalized) ? false : undefined
}

const readField = (source: Record<string, unknown>, names: string[]): boolean | undefined => {
  for (const name of names) {
    const decided = asBoolean(source[name])
    if (decided !== undefined) {
      return decided
    }
  }

  return undefined
}

/**
 * Turns one stored consent value into Blotout categories.
 *
 * Two shapes are accepted: a JSON object of per-category flags, and a single blanket value like
 * `accepted`. `necessary` is always `true` — Blotout's schema only accepts `true` for it, because
 * strictly necessary processing is not something a visitor can opt out of.
 */
export const parseConsentValue = (raw: unknown): ConsentCategories | null => {
  if (typeof raw !== 'string') {
    return null
  }

  const trimmed = raw.trim()
  if (trimmed === '') {
    return null
  }

  const blanket = asBoolean(trimmed)
  if (blanket !== undefined) {
    return { necessary: true, functional: blanket, analytics: blanket, marketing: blanket, salesOfData: blanket }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null
  }

  const source = parsed as Record<string, unknown>
  const analytics = readField(source, ['analytics', 'statistics', 'performance', 'analytics_storage'])
  const marketing = readField(source, ['marketing', 'advertising', 'targeting', 'ad_storage'])
  const functional = readField(source, ['functional', 'preferences', 'functionality_storage'])
  const salesOfData = readField(source, ['salesOfData', 'sale_of_data', 'sharing'])

  if (analytics === undefined && marketing === undefined && functional === undefined && salesOfData === undefined) {
    return null
  }

  return {
    necessary: true,
    ...(functional === undefined ? {} : { functional }),
    ...(analytics === undefined ? {} : { analytics }),
    ...(marketing === undefined ? {} : { marketing }),
    ...(salesOfData === undefined ? {} : { salesOfData })
  }
}

/**
 * Looks for a consent state in the storefront's cookies and localStorage.
 *
 * Every read is wrapped: the proxies reject when the storefront blocks storage, and a rejected
 * consent read must not stop tracking from starting.
 */
export const readConsent = async (browser: BrowserProxy): Promise<ConsentCategories | null> => {
  for (const key of CANDIDATE_KEYS) {
    const fromCookie = parseConsentValue(await browser.cookie.get(key).catch(() => null))
    if (fromCookie !== null) {
      return fromCookie
    }
  }

  for (const key of CANDIDATE_KEYS) {
    const fromStorage = parseConsentValue(await browser.localStorage.getItem(key).catch(() => null))
    if (fromStorage !== null) {
      return fromStorage
    }
  }

  return null
}

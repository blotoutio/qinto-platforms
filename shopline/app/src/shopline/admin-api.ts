import type { AppConfig } from '../config'
import { API_VERSION } from '../config'
import type { StoreSession } from './session-store'

export class AdminApiError extends Error {
  readonly status: number
  readonly body: string

  constructor(path: string, status: number, body: string) {
    super(`SHOPLINE ${path} -> ${status}`)
    this.name = 'AdminApiError'
    this.status = status
    // Truncated because it reaches log lines; SHOPLINE errors are short and the tail is noise.
    this.body = body.slice(0, 512)
  }
}

/**
 * Calls the store's Admin API.
 *
 * @param path Relative to the versioned root, e.g. `merchants/shop.json`.
 */
export const adminApi = async <T>(
  config: AppConfig,
  session: StoreSession,
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> => {
  const url = `https://${session.handle}.${config.apiHost}/admin/openapi/${API_VERSION}/${path}`
  const response = await fetch(url, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      'Content-Type': 'application/json'
    },
    ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) })
  })

  if (!response.ok) {
    throw new AdminApiError(path, response.status, await response.text())
  }

  return (await response.json()) as T
}

export type ShopInfo = {
  shopId: string | null
  shopName: string | null
  primaryDomain: string | null
  currency: string | null
  ianaTimezone: string | null
}

type ShopEnvelope = {
  data?: {
    id?: number
    name?: string
    /** The store's single primary domain, e.g. `srini-test.myshopline.com`. */
    domain?: string
    currency?: string
    iana_timezone?: string
  }
}

/**
 * Reads the store's shop record.
 *
 * SHOPLINE exposes only the single primary `domain` — there is no endpoint that lists a store's
 * domains, on REST or GraphQL. Domain discovery in the onboarding flow is built on that limit,
 * so this returns one host and never pretends to more.
 */
export const fetchShopInfo = async (config: AppConfig, session: StoreSession): Promise<ShopInfo> => {
  const { data } = await adminApi<ShopEnvelope>(config, session, 'merchants/shop.json')

  return {
    shopId: data?.id === undefined ? null : String(data.id),
    shopName: data?.name ?? null,
    primaryDomain: data?.domain ?? null,
    currency: data?.currency ?? null,
    ianaTimezone: data?.iana_timezone ?? null
  }
}

export type PixelSettings = {
  destination: string
  enabled: boolean
}

/**
 * Pushes the pixel extension's settings.
 *
 * The body is `{ settings: "<JSON string>" }` — a JSON *string* inside a JSON object, which is
 * SHOPLINE's shape, not a mistake. Values are strings because that is how the sandbox receives
 * them: `enabled` arrives as `'true'`, never `true`.
 */
export const pushPixelSettings = async (config: AppConfig, session: StoreSession, settings: PixelSettings): Promise<void> => {
  await adminApi(config, session, 'pixel/update_config.json', {
    method: 'POST',
    body: { settings: JSON.stringify({ destination: settings.destination, enabled: String(settings.enabled) }) }
  })
}

/**
 * The admin side of `/admin/qinto/channels`: types and the two calls the Blotout page makes.
 *
 * Both go to this same backend with the admin session cookie, so no token handling is needed.
 */

import type { KeyConflict, StoreState } from "../../lib/destinations"

export type { StoreState }

export type Store = {
  sales_channel_id: string
  name: string
  publishable_keys: string[]
  first_party_domain: string | null
  enabled: boolean
  state: StoreState
  conflicts: KeyConflict[]
}

const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    credentials: "include",
    headers: { "content-type": "application/json" },
    ...init,
  })
  const body = (await response.json().catch(() => ({}))) as T & { message?: string }

  if (!response.ok) {
    throw new Error(body.message ?? `The request failed (${response.status}). Try again.`)
  }

  return body
}

export const fetchStores = async (): Promise<Store[]> =>
  (await request<{ stores: Store[] }>("/admin/qinto/channels")).stores

export const saveStore = (
  salesChannelId: string,
  body: { first_party_domain?: string | null; enabled?: boolean }
) =>
  request(`/admin/qinto/channels/${encodeURIComponent(salesChannelId)}`, {
    method: "POST",
    body: JSON.stringify(body),
  })

export const hostOf = (url: string | null): string => {
  if (!url) {
    return ""
  }

  try {
    // host, not hostname: a domain on a non-standard port keeps its port.
    return new URL(url).host
  } catch {
    return url
  }
}

export const STATE_LABEL: Record<StoreState, string> = {
  sending: "Sending",
  off: "Tracking off",
  notset: "No domain set",
  nokey: "No publishable key",
}

export const STATE_COLOR: Record<StoreState, "green" | "grey" | "orange"> = {
  sending: "green",
  off: "grey",
  notset: "orange",
  nokey: "grey",
}

/**
 * Which first-party domain a storefront request sends to, decided from the sales channels behind
 * its publishable API key.
 *
 * Pure and dependency-free so it can be unit-tested without a Medusa container. Every store is
 * configured on its own: there is no store-wide default and no master switch, so a store with no
 * domain sends nothing.
 *
 * A domain is held as an https origin (`https://data.yourstore.com`).
 */

/** One store's saved settings, as stored in `qinto_channel_connection`. */
export type ChannelRow = {
  sales_channel_id: string
  first_party_domain: string | null
  enabled: boolean
}

export type Destination = {
  /** True only when events should be sent: a domain is set and the store's switch is on. */
  enabled: boolean
  firstPartyDomain: string | null
  /** The store whose settings decided the answer, or null when none is configured. */
  salesChannelId: string | null
  /** The key spans several configured stores that disagree on domain or switch. */
  ambiguous: boolean
}

/** What the admin shows for a store. Shared with the admin page. */
export type StoreState = "sending" | "off" | "notset" | "nokey"

/** A publishable key, reduced to what conflict detection needs. */
export type KeyLink = {
  title: string
  salesChannelIds: string[]
}

export type KeyConflict = {
  keyTitle: string
  /** The store this key's storefront actually sends with. */
  sendsToSalesChannelId: string
}

const NOWHERE: Destination = {
  enabled: false,
  firstPartyDomain: null,
  salesChannelId: null,
  ambiguous: false,
}

/**
 * Of the key's stores that have a domain, the one with the lowest sales channel id decides. Medusa
 * does not guarantee the order of a key's channels, so sorting keeps the answer stable across
 * requests.
 * Stores without a domain are skipped rather than winning with "nothing", so a half-set-up store
 * linked to the same key does not silence one that works.
 */
export const pickDestination = (
  salesChannelIds: readonly string[],
  rows: readonly ChannelRow[]
): Destination => {
  const configured = [...salesChannelIds]
    .sort()
    .map((id) => rows.find((r) => r.sales_channel_id === id))
    .filter((r): r is ChannelRow => Boolean(r?.first_party_domain))

  const [decisive] = configured

  if (!decisive) {
    return NOWHERE
  }

  const ambiguous = configured.some(
    (r) => r.first_party_domain !== decisive.first_party_domain || r.enabled !== decisive.enabled
  )

  return {
    enabled: decisive.enabled,
    firstPartyDomain: decisive.enabled ? decisive.first_party_domain : null,
    salesChannelId: decisive.sales_channel_id,
    ambiguous,
  }
}

export const storeState = (row: ChannelRow | undefined, hasKey: boolean): StoreState => {
  if (!hasKey) {
    return "nokey"
  }

  if (!row?.first_party_domain) {
    return "notset"
  }

  return row.enabled ? "sending" : "off"
}

/**
 * Keys linked to this store that are shared with other stores which disagree, and the store each
 * such key's storefront really sends with. Empty when there is nothing to warn about.
 */
export const conflictsFor = (
  salesChannelId: string,
  keys: readonly KeyLink[],
  rows: readonly ChannelRow[]
): KeyConflict[] =>
  keys
    .filter((k) => k.salesChannelIds.includes(salesChannelId) && k.salesChannelIds.length > 1)
    .map((k) => ({ key: k, destination: pickDestination(k.salesChannelIds, rows) }))
    .filter(({ destination }) => destination.ambiguous && destination.salesChannelId !== null)
    .map(({ key, destination }) => ({
      keyTitle: key.title,
      sendsToSalesChannelId: destination.salesChannelId as string,
    }))

export type RowChange = { first_party_domain?: string | null; enabled?: boolean }

/**
 * What a save writes to a store's row.
 *
 * Saving a first-party domain turns tracking on: pasting a destination is an explicit opt-in.
 * Clearing the domain leaves the switch as it was (the store sends nothing anyway without one),
 * and an explicit `enabled` in the same request always wins.
 */
export const rowPatch = (change: RowChange): RowChange => ({
  ...(change.first_party_domain !== undefined
    ? { first_party_domain: change.first_party_domain || null }
    : {}),
  ...(change.first_party_domain ? { enabled: true } : {}),
  ...(change.enabled !== undefined ? { enabled: change.enabled } : {}),
})

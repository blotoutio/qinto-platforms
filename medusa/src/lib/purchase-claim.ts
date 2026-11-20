/**
 * Which orders a storefront may claim the Purchase for. Pure, so it is tested without a database.
 *
 * The claim is what makes a Purchase go out once per order across tabs, browsers and devices: the
 * first confirmation page view claims it and sends, every later view is told it was claimed.
 */

/**
 * Only orders placed this recently can be claimed. The confirmation page is shown right after
 * checkout, so a real first view is well inside it; it also stops orders placed before this
 * version (sent once already, never claimed) from being sent again when reopened.
 */
export const CLAIM_WINDOW_MS = 24 * 60 * 60 * 1000

export type ClaimOrder = {
  id: string
  created_at?: string | Date | null
  sales_channel_id?: string | null
}

export type Claimability = "claimable" | "not_found" | "other_store" | "stale"

export const isOrderId = (value: unknown): value is string =>
  typeof value === "string" && /^order_[A-Za-z0-9]+$/.test(value)

const timeOf = (value: unknown): number =>
  value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : NaN

export const claimability = (
  order: ClaimOrder | null | undefined,
  salesChannelIds: string[],
  now: number
): Claimability => {
  if (!order) {
    return "not_found"
  }

  if (salesChannelIds.length > 0 && !salesChannelIds.includes(order.sales_channel_id ?? "")) {
    return "other_store"
  }

  const created = timeOf(order.created_at)

  return Number.isNaN(created) || now - created > CLAIM_WINDOW_MS ? "stale" : "claimable"
}

import { HttpTypes } from "@medusajs/types"
import { compact, toContent, type Properties } from "./mapping"

/**
 * Turning two cart states into the events that must have happened between them.
 *
 * Pure, framework-free, and separated from the component for the same reason `mapping.ts` is: this
 * is the half worth testing. Every bug found during verification lived here — a first add read as a
 * starting position, a removed line with no payload left to describe it — and none of them were
 * visible from reading the code. It returns events rather than sending them so a test can assert on
 * them without a browser.
 */

/**
 * A line is stored with its mapped content, not just its id.
 *
 * A removal is discovered by the line being *absent* from the new cart, so by the time it has to be
 * reported there is nothing left to map. Keeping the payload from when the line last existed is the
 * only way `RemoveFromCart` can carry a price and a product id rather than a bare id.
 */
export type Line = {
  id: string
  quantity: number
  unitPrice: number
  content: ReturnType<typeof toContent>
}

export type Snapshot = {
  /** `null` records "we looked and there was no cart" — which is what makes a first add reportable. */
  cartId: string | null
  /** When it was stored, so a copy left in shared storage from an old visit is not diffed against. */
  at?: number
  currency?: string
  lines: Line[]
}

/** What to store when the shopper has no cart yet. See `diffEvents` for why this is not just `null`. */
export const NO_CART: Snapshot = { cartId: null, lines: [] }

export type DerivedEvent = { name: string; properties: Properties }

const isLine = (value: unknown): value is Line => {
  const line = value as Line | null
  return typeof line?.id === "string" && typeof line.quantity === "number" && typeof line.unitPrice === "number"
}

/**
 * After this long a stored snapshot is a starting position again. Every page view refreshes it, so
 * only a return after a long absence is affected, and that first view emits nothing either way.
 */
export const SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** A snapshot read back from shared storage, or `null` when it is not one or too old (never looked). */
export const asSnapshot = (value: unknown, now: number = Date.now()): Snapshot | null => {
  const s = value as Snapshot | null
  const cartIdOk = s?.cartId === null || typeof s?.cartId === "string"
  const fresh = typeof s?.at !== "number" || now - s.at <= SNAPSHOT_MAX_AGE_MS

  return cartIdOk && fresh && Array.isArray(s?.lines) && s.lines.every(isLine) ? s : null
}

export const snapshotOf = (cart: HttpTypes.StoreCart): Snapshot => ({
  cartId: cart.id,
  currency: cart.currency_code?.toUpperCase(),
  lines: (cart.items ?? []).map((item) => ({
    id: item.id,
    quantity: item.quantity ?? 0,
    unitPrice: item.unit_price ?? 0,
    content: toContent(item),
  })),
})

/**
 * The events implied by moving from `previous` to `next`.
 *
 * Quantity is treated as a **delta, not a set**: a line going 1 → 3 is `AddToCart` of 2, which is
 * what the shopper did and what every ad platform expects.
 *
 * Never having looked at the cart is kept distinct from having looked and found none. With no
 * snapshot at all the cart's contents are a starting position — a returning shopper arriving with
 * three items has not just added three things — so nothing is emitted. But a snapshot whose
 * `cartId` is `null` means this session watched the cart come into existence, and every line in it
 * is genuinely new. Collapsing those two cases dropped a new visitor's first `AddToCart`, which is
 * the most common one there is.
 */
export const diffEvents = (
  cart: HttpTypes.StoreCart,
  previous: Snapshot | null,
  next: Snapshot
): DerivedEvent[] => {
  if (previous === null) {
    return []
  }

  if (previous.cartId !== null && previous.cartId !== next.cartId) {
    return []
  }

  const events: DerivedEvent[] = []
  const before = new Map(previous.lines.map((line) => [line.id, line]))
  const currency = next.currency ?? previous.currency

  for (const line of next.lines) {
    const was = before.get(line.id)
    before.delete(line.id)

    const delta = line.quantity - (was?.quantity ?? 0)
    if (delta === 0) {
      continue
    }

    events.push({
      name: delta > 0 ? "AddToCart" : "RemoveFromCart",
      properties: compact({
        currency,
        value: line.unitPrice * Math.abs(delta),
        contents: [{ ...line.content, quantity: Math.abs(delta) }],
      }),
    })
  }

  // Whatever is left was removed outright, described from the snapshot taken while it still existed.
  for (const line of Array.from(before.values())) {
    events.push({
      name: "RemoveFromCart",
      properties: compact({
        currency,
        value: line.unitPrice * line.quantity,
        contents: [{ ...line.content, quantity: line.quantity }],
      }),
    })
  }

  return events
}

/** The shipping and payment choices already reported for a cart; `""` means none yet. */
export type CheckoutState = { cartId: string | null; shipping: string; payment: string }

/** The shipping option to report: empty until the cart has both an option and a street address. */
export const shippingChoice = (cart: HttpTypes.StoreCart): string =>
  cart.shipping_address?.address_1?.trim()
    ? (cart.shipping_methods ?? []).map((method) => method.shipping_option_id).sort().join(",")
    : ""

/**
 * The state after reporting `choice`, or `null` when it is empty or this step was already reported
 * for this cart. Once per cart, not per choice: Card, then PayPal, then Card is one AddPaymentInfo.
 */
export const reportChoice = (
  cart: HttpTypes.StoreCart,
  previous: unknown,
  step: "shipping" | "payment",
  choice: string
): CheckoutState | null => {
  // Only a value of the right shape counts as reported.
  const stored = previous as Partial<CheckoutState> | null
  const text = (value: unknown): string => (typeof value === "string" ? value : "")
  const state: CheckoutState =
    stored?.cartId === cart.id
      ? { cartId: cart.id, shipping: text(stored.shipping), payment: text(stored.payment) }
      : { cartId: cart.id, shipping: "", payment: "" }

  return choice === "" || state[step] !== "" ? null : { ...state, [step]: choice }
}

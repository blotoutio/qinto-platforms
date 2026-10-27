/**
 * What the context route asks Medusa for, and what it hands back to the browser.
 *
 * Pure and framework-free so the rules can be tested without a request. Two layers, on purpose:
 *
 * 1. **The field lists replace Medusa's defaults.** A list whose entries carry no `+`, `-` or `*`
 *    prefix replaces the route's default fields; a prefixed one only adds to them. The defaults
 *    include payment session `data` (a provider's client secret), the billing address and metadata,
 *    none of which tracking reads. Medusa computes `total` itself when it is asked for.
 * 2. **The response is projected anyway.** Medusa silently drops a field a route does not allow and
 *    only accepts some relations whole (`*shipping_address` on an order), so what comes back is not
 *    guaranteed to be what was asked for. The projection is what actually bounds the response: it
 *    copies exactly the fields `mapping.ts` and `cart-diff.ts` read, and nothing else.
 */

const ADDRESS_FIELDS = [
  "first_name",
  "last_name",
  "phone",
  "city",
  "province",
  "country_code",
  "postal_code",
  "address_1",
] as const

const ITEM_FIELDS = [
  "id",
  "quantity",
  "unit_price",
  "product_id",
  "variant_id",
  "product_title",
  "title",
  "thumbnail",
  "product_handle",
  "variant_sku",
] as const

const fields = (list: readonly string[]): string => list.join(",")

export const CART_FIELDS = fields([
  "id",
  "currency_code",
  "email",
  "total",
  ...ITEM_FIELDS.map((f) => `items.${f}`),
  // Counted, never read: a new shipping method or payment session is what AddShippingInfo and
  // AddPaymentInfo are derived from. The session's `data` is the one field that must never leave.
  "shipping_methods.id",
  "payment_collection.payment_sessions.id",
  ...ADDRESS_FIELDS.map((f) => `shipping_address.${f}`),
])

export const ORDER_FIELDS = fields([
  "id",
  "display_id",
  "currency_code",
  "email",
  "total",
  "tax_total",
  "shipping_total",
  ...ITEM_FIELDS.map((f) => `items.${f}`),
  // The order route allows the address only as a whole relation; the projection trims it.
  "*shipping_address",
])

export const CUSTOMER_FIELDS = fields(["id", "email", "first_name", "last_name", "phone"])

/** `calculated_price` is only askable alongside a region; see the route. */
export const productFields = (withPrice: boolean): string =>
  fields([
    "id",
    "title",
    "handle",
    "thumbnail",
    "variants.id",
    "variants.sku",
    ...(withPrice ? ["*variants.calculated_price"] : []),
    "*categories",
  ])

/**
 * Medusa ids are a type prefix and a ULID. Checked before an id is put into a backend path, so a
 * cookie or query value cannot walk to another endpoint (`../customers/me`) or smuggle in its own
 * query string.
 */
export const isCartId = (value: string | null | undefined): value is string =>
  typeof value === "string" && /^cart_[A-Za-z0-9]+$/.test(value)

export const isOrderId = (value: string | null | undefined): value is string =>
  typeof value === "string" && /^order_[A-Za-z0-9]+$/.test(value)

/* ------------------------------------------------------------------ projection */

type Json = Record<string, unknown>

const asObject = (value: unknown): Json | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : null

const asArray = (value: unknown): Json[] =>
  Array.isArray(value) ? value.map(asObject).filter((v): v is Json => v !== null) : []

/** Copies only the listed keys that are present. */
const pick = (source: Json | null, keys: readonly string[]): Json | null => {
  if (source === null) {
    return null
  }

  const out: Json = {}
  for (const key of keys) {
    if (source[key] !== undefined) {
      out[key] = source[key]
    }
  }

  return out
}

const projectItem = (item: Json): Json => {
  const out = pick(item, ITEM_FIELDS) as Json
  // `mapping.ts` reads the SKU from the variant relation; the flat column is what the narrowed
  // query returns, so it is re-homed there rather than widening the query to the whole variant.
  const sku = out.variant_sku ?? asObject(item.variant)?.sku
  delete out.variant_sku
  if (sku !== undefined && sku !== null) {
    out.variant = { sku }
  }

  return out
}

const idsOnly = (value: unknown): Json[] => asArray(value).map((entry) => ({ id: entry.id }))

export const projectCart = (input: unknown): Json | null => {
  const cart = asObject(input)
  if (cart === null) {
    return null
  }

  const paymentCollection = asObject(cart.payment_collection)

  return {
    ...pick(cart, ["id", "currency_code", "email", "total"]),
    items: asArray(cart.items).map(projectItem),
    shipping_methods: idsOnly(cart.shipping_methods),
    payment_collection:
      paymentCollection === null
        ? null
        : { payment_sessions: idsOnly(paymentCollection.payment_sessions) },
    shipping_address: pick(asObject(cart.shipping_address), ADDRESS_FIELDS),
  }
}

export const projectOrder = (input: unknown): Json | null => {
  const order = asObject(input)
  if (order === null) {
    return null
  }

  return {
    ...pick(order, ["id", "display_id", "currency_code", "email", "total", "tax_total", "shipping_total"]),
    items: asArray(order.items).map(projectItem),
    shipping_address: pick(asObject(order.shipping_address), ADDRESS_FIELDS),
  }
}

export const projectCustomer = (input: unknown): Json | null =>
  pick(asObject(input), ["id", "email", "first_name", "last_name", "phone"])

export const projectProduct = (input: unknown): Json | null => {
  const product = asObject(input)
  if (product === null) {
    return null
  }

  return {
    ...pick(product, ["id", "title", "handle", "thumbnail"]),
    categories: asArray(product.categories).map((c) => ({ name: c.name })),
    variants: asArray(product.variants).map((variant) => ({
      ...pick(variant, ["id", "sku"]),
      calculated_price: pick(asObject(variant.calculated_price), [
        "calculated_amount",
        "currency_code",
      ]),
    })),
  }
}

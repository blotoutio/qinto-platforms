import { HttpTypes } from "@medusajs/types"

/**
 * Medusa objects to Blotout standard-event payloads.
 *
 * Pure functions, no I/O, no globals, no SDK import. Everything that could silently send the wrong
 * number lives here, which is why it is separated from the client: it is the half worth testing.
 *
 * **Nothing in this module may throw.** Several of these run during *server* render — the order
 * confirmation page calls `purchase(order)` inside its JSX, the checkout calls `cartEvent(cart)` —
 * so an unexpected shape from a future Medusa version, a null line, or a missing relation would
 * turn into a 500 on the page a shopper sees after paying. Every exported mapper is therefore
 * wrapped in `guard`, which returns an empty payload instead. A missing analytics event is a
 * rounding error; a broken checkout is not.
 *
 * The field names are the platform's and are not guessable. A content item's price is `value` —
 * the price of *one* unit, not the line total — and neither `price` nor `item_price` is read;
 * `variantId` is what GA4 turns into `item_variant`; Purchase reads `taxCost` and `shippingCost`,
 * not `tax` and `shipping`. A wrong name is dropped in silence rather than rejected, so these are
 * checked against Qinto's published standard-event list rather than guessed.
 *
 * Medusa 2.x amounts are already decimal (an order totalling €20.00 reports `total: 20`), so
 * nothing here divides by 100.
 */

/**
 * One cart, order or product line, in Blotout's `Content` shape.
 *
 * `id`, `quantity` and `value` are required. `value` is the **unit** price: a line of two €5 tees
 * is `{ quantity: 2, value: 5 }`, and the line total lives on the event's own `value`, not here.
 */
export type Content = {
  id: string
  quantity: number
  value: number
  variantId?: string
  sku?: string
  title?: string
  category?: string
  image?: string
  url?: string
}

export type Properties = Record<string, unknown>

const isNonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== ""

/**
 * Drops keys that carry no information.
 *
 * `null`, `undefined`, `''` and `[]` go; `0` and `false` stay, because those are answers — a free
 * item's `value: 0` is a fact, and dropping it would make the event look malformed.
 */
export const compact = <T extends object>(
  input: T
): Partial<{ [K in keyof T]: NonNullable<T[K]> }> =>
  Object.fromEntries(
    Object.entries(input).filter(([, value]) => {
      if (value === undefined || value === null || value === "") {
        return false
      }

      return !(Array.isArray(value) && value.length === 0)
    })
  ) as Partial<{ [K in keyof T]: NonNullable<T[K]> }>

/**
 * Reports a mapping failure without letting it escape.
 *
 * Silent in production: a console error on a shopper's order confirmation page helps nobody, and
 * the event is already lost either way. In development it is loud, because a mapper that throws is
 * a real defect that should be found before release.
 */
const report = (name: string, error: unknown): void => {
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[qinto] mapping ${name} failed:`, error)
  }
}

/**
 * Wraps a mapper so it returns `fallback` instead of throwing.
 *
 * Applied to every export below. The fallback is always a shape the caller can use unchanged, so
 * no call site needs its own try/catch.
 */
const guard =
  <A extends unknown[], R>(name: string, fn: (...args: A) => R, fallback: R) =>
  (...args: A): R => {
    try {
      return fn(...args)
    } catch (error) {
      report(name, error)

      return fallback
    }
  }

/**
 * An absolute link to a product page, or undefined.
 *
 * Works on the server as well as the client. ViewContent, InitiateCheckout and Purchase are all
 * mapped during server render, where there is no `window` — an earlier version returned undefined
 * there, so the only event that ever carried a product URL was AddToCart. Ad platforms fetch these
 * to build product cards, so the server path falls back to `NEXT_PUBLIC_BASE_URL`.
 *
 * The storefront is region-scoped: every route carries a country code as its first segment
 * (`/dk/products/…`), and omitting it produces a link that 404s.
 */
const absoluteUrl = (
  handle?: string | null,
  countryCode?: string | null
): string | undefined => {
  if (!isNonEmpty(handle)) {
    return undefined
  }

  const origin =
    typeof window === "undefined"
      ? (process.env.NEXT_PUBLIC_BASE_URL ?? "").replace(/\/+$/, "")
      : window.location.origin

  if (origin === "") {
    return undefined
  }

  const fromPath =
    typeof window === "undefined"
      ? undefined
      : window.location.pathname.split("/")[1]

  const region = isNonEmpty(countryCode) ? countryCode : fromPath
  const prefix = isNonEmpty(region) && /^[a-z]{2}$/i.test(region) ? `/${region}` : ""

  return `${origin}${prefix}/products/${handle}`
}

/**
 * One cart or order line.
 *
 * `id` is the product id, not the line id: ad platforms match on the product across its variants,
 * and a Medusa line id is unique per cart and matches nothing. The variant travels as `variantId`.
 */
const toContentUnsafe = (
  item: HttpTypes.StoreCartLineItem | HttpTypes.StoreOrderLineItem
): Content => {
  const variant = item.variant as HttpTypes.StoreProductVariant | undefined

  return {
    id: item.product_id ?? item.variant_id ?? item.id,
    quantity: item.quantity ?? 1,
    value: item.unit_price ?? 0,
    ...compact({
      variantId: item.variant_id,
      sku: variant?.sku,
      title: item.product_title ?? item.title,
      image: item.thumbnail,
      url: absoluteUrl(item.product_handle),
    }),
  }
}

const toContentsUnsafe = (
  items: (HttpTypes.StoreCartLineItem | HttpTypes.StoreOrderLineItem)[] | null | undefined
): Content[] => (Array.isArray(items) ? items : []).map(toContentUnsafe)

/** A product-detail view. `variant` is the selected variant, when the shopper has chosen one. */
const viewContentUnsafe = (
  product: HttpTypes.StoreProduct,
  variant: HttpTypes.StoreProductVariant | undefined,
  currencyCode: string | null | undefined
): Properties => {
  const price = variant?.calculated_price?.calculated_amount ?? undefined

  return compact({
    currency: currencyCode?.toUpperCase(),
    value: price,
    contents: [
      compact({
        id: product.id,
        quantity: 1,
        value: price ?? 0,
        variantId: variant?.id,
        sku: variant?.sku,
        title: product.title,
        category: product.categories?.map((c) => c.name).join(","),
        image: product.thumbnail,
        url: absoluteUrl(product.handle),
      }),
    ],
  })
}

/**
 * A single line being added to or removed from the cart.
 *
 * `currency` and `value` are both **required** on AddToCart and RemoveFromCart. The event's `value`
 * is this line's contribution, not the cart total — the event is about the line. The content
 * item's own `value` stays the unit price, so the two differ whenever `quantity` is above one.
 */
const cartLineChangeUnsafe = (
  product: HttpTypes.StoreProduct,
  variant: HttpTypes.StoreProductVariant | undefined,
  quantity: number,
  currencyCode: string | null | undefined
): Properties => {
  const unit = variant?.calculated_price?.calculated_amount ?? 0

  return compact({
    currency: currencyCode?.toUpperCase(),
    value: unit * quantity,
    contents: [
      compact({
        id: product.id,
        quantity,
        value: unit,
        variantId: variant?.id,
        sku: variant?.sku,
        title: product.title,
        image: product.thumbnail,
        url: absoluteUrl(product.handle),
      }),
    ],
  })
}

/** A whole-cart event: InitiateCheckout, AddShippingInfo, AddPaymentInfo. */
const cartEventUnsafe = (cart: HttpTypes.StoreCart): Properties =>
  compact({
    currency: cart.currency_code?.toUpperCase(),
    value: cart.total ?? 0,
    contents: toContentsUnsafe(cart.items),
  })

/**
 * The only event Blotout records as a conversion.
 *
 * `orderId` is also the dedupe key — the runtime derives the event id from it — so an order counts
 * once however many times its confirmation page is loaded.
 */
const purchaseUnsafe = (order: HttpTypes.StoreOrder): Properties =>
  compact({
    currency: order.currency_code?.toUpperCase(),
    value: order.total ?? 0,
    orderId: orderIdOfUnsafe(order),
    contents: toContentsUnsafe(order.items),
    taxCost: order.tax_total,
    shippingCost: order.shipping_total,
  })

/**
 * The id a Purchase carries, and deduplicates on.
 *
 * **The order's own id, not its display number.** `display_id` is the number a merchant sees in the
 * admin — human-friendly, but it is a per-store sequence, so it collides across stores and is not
 * what anything else identifies the order by. `id` is the durable key the Store API, webhooks and
 * the merchant's own database all use, which makes it the one that joins.
 */
const orderIdOfUnsafe = (order: {
  display_id?: number | null
  id?: string | null
}): string => (order.id != null && order.id !== "" ? String(order.id) : String(order.display_id ?? ""))

/**
 * Identity traits, keyed by Qinto's standard trait names, written exactly as the docs list them.
 *
 * The eight standard keys are `email`, `phone`, `first_name`, `last_name`, `country`, `state`,
 * `city` and `postal_code`. The server folds camelCase into snake_case, but it does not translate
 * synonyms: an earlier version sent `zip`, which is not a standard key and so landed as a custom
 * trait instead of the standard postcode. Spelling them literally removes the guesswork.
 *
 * `address` is the one **custom** trait here, deliberately: there is no standard street-address
 * key, so it arrives as a custom trait rather than one of the eight standard ones.
 *
 * `compact` is generic over its input and drops nulls from the type as well as the value, so each
 * builder below type-checks against `Traits` on its own without a cast — an earlier version returned
 * `Record<string, unknown>`, which is assignable to anything and quietly enforced nothing. The
 * address is the shipping address, the one a shopper filled in.
 */
export type Traits = Partial<
  Record<
    | "email"
    | "phone"
    | "first_name"
    | "last_name"
    | "country"
    | "state"
    | "city"
    | "postal_code"
    // Custom, not a standard key — see above.
    | "address",
    string
  >
>

const traitsFromAddress = (
  address:
    | HttpTypes.StoreCartAddress
    | HttpTypes.StoreOrderAddress
    | null
    | undefined
): Traits =>
  compact({
    first_name: address?.first_name,
    last_name: address?.last_name,
    phone: address?.phone,
    city: address?.city,
    state: address?.province,
    country: address?.country_code,
    postal_code: address?.postal_code,
    address: address?.address_1,
  })

const cartTraitsUnsafe = (cart: HttpTypes.StoreCart): Traits =>
  compact({
    ...traitsFromAddress(cart.shipping_address),
    email: cart.email,
  })

const orderTraitsUnsafe = (order: HttpTypes.StoreOrder): Traits =>
  compact({
    ...traitsFromAddress(order.shipping_address),
    email: order.email,
  })

const customerTraitsUnsafe = (customer: HttpTypes.StoreCustomer): Traits =>
  compact({
    email: customer.email,
    first_name: customer.first_name,
    last_name: customer.last_name,
    phone: customer.phone,
  })

/**
 * The public surface, each one incapable of throwing.
 *
 * The `Unsafe` implementations above are the real logic and call one another directly — guarding
 * an inner call would hide a failure behind a plausible-looking empty value, which is worse than
 * one guard at the boundary.
 */
export const toContent = guard("toContent", toContentUnsafe, { id: "", quantity: 1, value: 0 } as ReturnType<typeof toContentUnsafe>)
export const toContents = guard("toContents", toContentsUnsafe, [] as ReturnType<typeof toContentsUnsafe>)
export const viewContent = guard("viewContent", viewContentUnsafe, {} as ReturnType<typeof viewContentUnsafe>)
export const cartLineChange = guard("cartLineChange", cartLineChangeUnsafe, {} as ReturnType<typeof cartLineChangeUnsafe>)
export const cartEvent = guard("cartEvent", cartEventUnsafe, {} as ReturnType<typeof cartEventUnsafe>)
export const purchase = guard("purchase", purchaseUnsafe, {} as ReturnType<typeof purchaseUnsafe>)
export const orderIdOf = guard("orderIdOf", orderIdOfUnsafe, "" as ReturnType<typeof orderIdOfUnsafe>)
export const cartTraits = guard("cartTraits", cartTraitsUnsafe, {} as ReturnType<typeof cartTraitsUnsafe>)
export const orderTraits = guard("orderTraits", orderTraitsUnsafe, {} as ReturnType<typeof orderTraitsUnsafe>)
/**
 * Traits for a signed-in customer.
 *
 * Automatic capture sends these once per session when Medusa resolves a signed-in customer from the
 * session cookie. Exported because a storefront that surfaces a logged-in customer elsewhere needs
 * the same shape.
 */
export const customerTraits = guard("customerTraits", customerTraitsUnsafe, {} as ReturnType<typeof customerTraitsUnsafe>)

/**
 * The identifiers a signed-in customer is aliased with, **email first**.
 *
 * The order is what keeps one shopper one person. Qinto never merges persons: an alias nobody owns
 * creates a new person (or joins the one this browser is already linked to), and an alias owned by
 * a different person than the browser's is a conflict, not a link. A guest checkout aliases only the
 * email. If a later sign-in on another device sent the customer id first, that unseen id would mint a
 * second person and the email would then conflict with the guest's. Sending the email first joins
 * the guest's person, and the customer id attaches to it. It is also the graph's own precedence for
 * identifiers that arrive together: email, then phone, then custom ids.
 */
const customerAliasesUnsafe = (customer: HttpTypes.StoreCustomer): string[] =>
  [customer.email, customer.id].filter(isNonEmpty)

export const customerAliases = guard("customerAliases", customerAliasesUnsafe, [] as string[])

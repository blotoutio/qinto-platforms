import type { PixelEvents } from '@shoplineos/shopline-pixels-extension'

/**
 * The SHOPLINE customer-event payloads this pixel reads.
 *
 * **Derived from SHOPLINE's own types, not restated.** They were restated once, on the reasoning
 * that `subscribe<K extends string>` widens to a permissive `CustomEvent` so a mistyped field would
 * compile silently. That is true of `subscribe` and is not a reason to hand-write the payloads —
 * `PixelEvents` is exported and exact.
 *
 * The restatement drifted into fiction: it grew a `checkout: { order: { shipping_price,
 * subtotal_price } }` object that no SHOPLINE pixel event has ever carried, and `purchase()` read
 * `shipping` and `subtotal` out of it. Both vanished through `compact()` rather than failing, and
 * the fixtures fed the same invented shape, so no test could catch it. Deriving makes it a compile
 * error.
 */
type DataOf<K extends keyof PixelEvents> = PixelEvents[K]['data']

/** Rides every standard event. */
export type EventCommon = {
  login_em: string | null
  /** Declared `string`, but `checkout_completed` sends a number. Both are handled. */
  customer_id: string | number | null
}

/**
 * The loosest cart or checkout line, deliberately.
 *
 * Every event's own `list` item is assignable to this; `lead` in particular declares most fields
 * optional. `toContent` takes this rather than a per-event shape so there is one line mapper.
 */
export type LineItem = {
  spuId?: string
  skuId?: string
  skuItemNo?: string
  title?: string
  variant?: string
  price?: number
  quantity?: number
  category?: string
}

export type PixelEvent<TData> = {
  /** SHOPLINE's own anonymous client id. Stable per visitor, per store. */
  clientId: string
  /** SHOPLINE's event id. Not reused as the Blotout `eventId` except where noted. */
  id: string
  timestamp: string
  name: string
  data: TData
}

export type PageViewedData = DataOf<'page_viewed'>
export type ProductViewedData = DataOf<'product_viewed'>
export type CartChangeData = DataOf<'product_added_to_cart'> | DataOf<'product_removed_from_cart'>
export type CheckoutData = DataOf<'checkout_started'>
export type ContactInfoData = DataOf<'checkout_contact_info_submitted'>
export type PaymentInfoData = DataOf<'payment_info_submitted'>
/**
 * The identity SHOPLINE attaches to a completed order.
 *
 * Not in `PixelEvents`, and the only reason anything here is hand-written: the declared payload is
 * incomplete against what the platform actually sends. Read off a live order on
 * `srini-test.myshopline.com` on 2026-09-10. Every field is optional
 * because the declaration gives no guarantee at all.
 *
 * This is the identity attached to the order itself, so it rides the conversion frame rather than an
 * earlier one. `checkout_contact_info_submitted` does also fire, but late and not always observed —
 * so this is the source that cannot be missed.
 */
export type CheckoutUserInfo = {
  email?: string
  phone?: string
  firstName?: string
  lastName?: string
  city?: string
  province?: string
  country?: string
  postcode?: string
  user_id?: string | number
}

export type CheckoutCompletedData = Omit<DataOf<'checkout_completed'>, 'customer_id'> & {
  /** Declared `string | null`; a real order sends a number. */
  customer_id: string | number | null
  userInfo?: CheckoutUserInfo
}
export type SearchSubmittedData = DataOf<'search_submitted'>
export type LeadData = DataOf<'lead'>

/** The settings declared in `shopline.pixels.extension.toml`. Both arrive as strings. */
export type PixelSettings = {
  destination?: unknown
  enabled?: unknown
}

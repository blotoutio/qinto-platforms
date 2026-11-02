import type {
  CartChangeData,
  CheckoutCompletedData,
  CheckoutData,
  ContactInfoData,
  EventCommon,
  LeadData,
  LineItem,
  PageViewedData,
  PaymentInfoData,
  ProductViewedData,
  SearchSubmittedData
} from './types'

/**
 * SHOPLINE customer events to Blotout standard events.
 *
 * Pure functions, no I/O, no globals — which is why this module carries the 100% coverage
 * threshold. Everything that could silently send the wrong number lives here.
 *
 * The mapping is the standard eleven and nothing else (`extensions/blotout-pixel/AGENTS.md`). Two of the eleven have
 * no SHOPLINE source at all: `AddShippingInfo` (SHOPLINE publishes no shipping-info event) and
 * `Subscribe`. Adding or remapping an event is a decision to raise, not a guess to make.
 */

export type BlotoutProperties = Record<string, unknown>
export type BlotoutTraits = Record<string, unknown>

/**
 * One line, in the Qinto standard events `Content` shape.
 *
 * `value` is the price of ONE unit, not the line total: the event's own `value` carries the total.
 * The docs say so outright ("Content.item_price is Content.value"), so the old `item_price` name
 * is gone. A field outside the docs' `Content` type is not sent.
 */
export type Content = {
  id: string
  quantity: number
  value: number
  title?: string
  variantId?: string
  category?: string
  sku?: string
}

const isNonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

/**
 * An id SHOPLINE may send as either a string or a number.
 *
 * `customer_id` is declared `string | null` and arrives as a number on `checkout_completed`.
 * Without this, a guest with a customer id and no email links to nothing at all, because
 * `identifierFor` only ever saw a string.
 */
const asId = (value: unknown): string | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }

  return isNonEmpty(value) ? value.trim() : undefined
}

/**
 * Drops keys that carry no information.
 *
 * `null`, `undefined`, `''` and `[]` go; `0` and `false` stay, because those are answers — a free
 * item's `value: 0` is a fact, and dropping it would make the event look malformed. This runs on
 * every event on every storefront page, so the bytes matter.
 */
export const compact = <T extends Record<string, unknown>>(input: T): BlotoutProperties => {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => {
      if (value === undefined || value === null || value === '') {
        return false
      }

      return !(Array.isArray(value) && value.length === 0)
    })
  )
}

/**
 * One cart or checkout line.
 *
 * `spuId` is preferred as the id because it identifies the product across its variants, which is
 * what ad platforms match on; `skuId` is the fallback when a store publishes only variants.
 */
export const toContent = (item: LineItem): Content => {
  return {
    id: item.spuId ?? item.skuId ?? '',
    quantity: item.quantity ?? 1,
    value: item.price ?? 0,
    ...compact({
      title: item.title,
      variantId: item.skuId,
      category: item.category,
      sku: item.skuItemNo
    })
  }
}

export const toContents = (list: LineItem[] | undefined): Content[] => {
  return (list ?? []).map(toContent)
}

/** Σ unit price × quantity, rounded to cents so float noise never reaches a destination. */
const linesTotal = (contents: Content[]): number => {
  return Math.round(contents.reduce((total, content) => total + content.value * content.quantity, 0) * 100) / 100
}

export const pageView = (data: PageViewedData): BlotoutProperties => {
  return compact({ title: data.title, path: data.path })
}

export const viewContent = (data: ProductViewedData): BlotoutProperties => {
  return compact({
    currency: data.currency,
    value: data.price,
    contents: [
      toContent({
        spuId: data.spuId,
        skuId: data.skuId,
        skuItemNo: data.skuItemNo,
        title: data.title,
        price: data.price,
        category: data.category,
        quantity: 1
      })
    ]
  })
}

export const cartChange = (data: CartChangeData): BlotoutProperties => {
  return compact({
    currency: data.currency,
    value: data.value,
    contents: toContents(data.list)
  })
}

export const initiateCheckout = (data: CheckoutData): BlotoutProperties => {
  return compact({
    currency: data.currency,
    value: data.value,
    contents: toContents(data.list)
  })
}

export const addPaymentInfo = (data: PaymentInfoData): BlotoutProperties => {
  return compact({
    currency: data.currency,
    value: data.value,
    contents: toContents(data.list)
  })
}

/**
 * The only event Blotout records as a conversion.
 *
 * It needs a finite numeric `value` and a non-empty `orderId`; `orderId` is also the dedupe key, so
 * a retried purchase must produce the same one. `orderSeq` is the merchant-visible order number and
 * is stable across retries, which `event.id` is not.
 */
export const purchase = (data: CheckoutCompletedData): BlotoutProperties => {
  const contents = toContents(data.list)

  return compact({
    currency: data.currency,
    value: data.value,
    orderId: data.orderSeq,
    contents,
    // `taxCost` and `shippingCost`, not `tax` and `shipping`: those are the names the providers
    // read, and the wrong ones are dropped in silence.
    taxCost: data.taxAmount,
    shippingCost: data.shippingAmount,
    // SHOPLINE gives the code alone, so the docs' optional `type` and `value` stay out.
    discounts: isNonEmpty(data.coupon) ? [{ code: data.coupon.trim() }] : undefined,
    grossValue: contents.length > 0 ? linesTotal(contents) : undefined
  })
}

export const search = (data: SearchSubmittedData): BlotoutProperties => {
  return compact({ search: data.keyword })
}

/**
 * Lead takes `name` and `category` as flat strings, not `contents` (standard events docs). A lead
 * with several lines is named after its first.
 */
export const lead = (data: LeadData): BlotoutProperties => {
  const contents = toContents(data.list)
  const first = contents[0]

  return compact({
    currency: data.currency,
    value: linesTotal(contents),
    name: first?.title,
    category: first?.category
  })
}

/**
 * Traits that ride every event.
 *
 * Trait keys are snake_case, the standard traits' own spelling (user data docs). `customer_id` is
 * not a standard trait; it lands as a custom one under this exact key.
 *
 * `login_em` is only present for a signed-in customer, so most events contribute nothing and
 * `identify` is skipped rather than called with an empty object.
 */
export const commonTraits = (data: EventCommon): BlotoutTraits => {
  return compact({ email: data.login_em, customer_id: asId(data.customer_id) })
}

/**
 * Traits from the checkout contact step.
 *
 * This is the richest identity SHOPLINE gives us and the reason
 * `checkout_contact_info_submitted` is subscribed at all — it is never sent as an event.
 */
export const contactTraits = (data: ContactInfoData): BlotoutTraits => {
  const address = data.shippingAddress ?? {}

  return compact({
    ...commonTraits(data),
    email: data.email ?? data.login_em,
    phone: data.phone ?? address.phone,
    first_name: address.firstName,
    last_name: address.lastName,
    city: address.city,
    state: address.state,
    country: address.country,
    postal_code: address.zip
  })
}

/**
 * Traits from a completed order.
 *
 * The identity SHOPLINE attaches to the order itself.
 *
 * `contactTraits` runs earlier in the checkout and usually supplies the same person, but it arrives
 * on its own frame and late. Reading `userInfo` here puts the identity
 * on the conversion, which is the frame that has to be attributable — and `login_em` is null for a
 * guest, so without it the only identity on a guest's purchase would be the anonymous id.
 */
export const purchaseTraits = (data: CheckoutCompletedData): BlotoutTraits => {
  const user = data.userInfo ?? {}

  return compact({
    ...commonTraits(data),
    email: user.email ?? data.login_em,
    phone: user.phone,
    first_name: user.firstName,
    last_name: user.lastName,
    city: user.city,
    // SHOPLINE calls it `province`; Blotout's trait is `state`, the same thing under both names.
    state: user.province,
    country: user.country,
    postal_code: user.postcode,
    customer_id: asId(data.customer_id) ?? asId(user.user_id)
  })
}

/**
 * The identifier to link a visitor by, or null.
 *
 * Email is preferred over the SHOPLINE customer id because it resolves to the same person across
 * channels, which is the whole point of the identity graph. Blotout's `identify` refuses an empty id.
 */
export const identifierFor = (traits: BlotoutTraits): string | null => {
  const email = traits['email']
  if (isNonEmpty(email)) {
    return email.trim().toLowerCase()
  }

  return asId(traits['customer_id']) ?? null
}

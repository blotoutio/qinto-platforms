import type { BlotoutSocket } from './blotout-socket'
import type { SendIdentity } from './identity'
import type { BlotoutProperties } from './mapping'
import {
  addPaymentInfo,
  cartChange,
  commonTraits,
  contactTraits,
  initiateCheckout,
  lead,
  pageView,
  purchase,
  purchaseTraits,
  search,
  viewContent
} from './mapping'
import { distinctBy } from './repeats'
import type {
  CartChangeData,
  CheckoutCompletedData,
  CheckoutData,
  ContactInfoData,
  EventCommon,
  LeadData,
  PageViewedData,
  PaymentInfoData,
  PixelEvent,
  ProductViewedData,
  SearchSubmittedData
} from './types'

/**
 * What the pixel subscribes to, in one table.
 *
 * Split out from `index.ts` so it can be driven by synthetic events in a test without a sandbox:
 * the whole surface is `(analytics, blotout) => void`, and `analytics` is one method.
 */

export type Analytics = {
  subscribe: <T>(name: string, callback: (event: T) => void) => unknown
}

/**
 * Reports a mapping failure instead of letting it escape.
 *
 * The socket, the session and the consent read are all non-throwing by construction, but the
 * mapping functions read fields off `event.data` — and `data` is whatever SHOPLINE actually
 * delivered, not what `types.ts` says. A malformed payload, a future SHOPLINE change, or a
 * merchant app publishing a same-named custom event with a different shape would otherwise throw
 * straight back into the handler SHOPLINE called.
 *
 * A broken storefront is a far worse outcome than a missing event, so every subscription is wrapped.
 */
export type OnError = (message: string) => void

/**
 * SHOPLINE's variant parameter, dropped before two paths are compared.
 *
 * The variant picker rewrites the URL to `?sku=<id>` and republishes `page_viewed`; the shopper
 * picked a swatch, they did not view a page. Only this parameter is ignored — `/search?keyword=…`
 * and `?page=2` are real navigations and must still count.
 *
 * Hand-rolled rather than `new URL()`: the strict sandbox is not guaranteed to carry it, and a throw
 * here would be caught by `guard` and cost the PageView entirely.
 */
const withoutVariant = (path: string): string => {
  const [base = '', query] = path.split('?')
  if (query === undefined) {
    return path
  }

  const kept = query.split('&').filter((pair) => !pair.startsWith('sku='))

  return kept.length === 0 ? base : `${base}?${kept.join('&')}`
}

const guard = <T>(name: string, onError: OnError, handle: (event: T) => void): ((event: T) => void) => {
  return (event: T) => {
    try {
      handle(event)
    } catch (error) {
      onError(`mapping ${name} failed: ${String(error)}`)
    }
  }
}

/** Identity rides the first event, so a signed-in visitor is linked on whatever they do first. */
const track = (
  blotout: BlotoutSocket,
  identify: SendIdentity,
  sent: { event: string; data: EventCommon; properties: Record<string, unknown> }
): void => {
  identify(commonTraits(sent.data))
  blotout.track(sent.event, sent.properties)
}

/**
 * Wires every mapped SHOPLINE event to its Blotout event.
 *
 * The eleven standard events, minus the two SHOPLINE cannot produce. Deliberately **not**
 * subscribed: `cart_viewed`, `collection_viewed`, `search_view_results`, `login` and
 * `registration_completed` have no exact Blotout equivalent, and sending them under an invented name
 * would pollute a merchant's event list (`extensions/blotout-pixel/AGENTS.md`).
 */
export const subscribeAll = (analytics: Analytics, blotout: BlotoutSocket, identify: SendIdentity, onError: OnError): void => {
  const on = <T>(name: string, handle: (event: T) => void): void => {
    analytics.subscribe<T>(name, guard(name, onError, handle))
  }

  // Only the two view events are gated. A repeated view says nothing a merchant does not already
  // have; a repeated `AddToCart` of the same line is a shopper adding it twice, which is a fact.
  // The state is a closure per `subscribeAll` call, and `subscribeAll` runs once per page load — so
  // a reload always sends its PageView, and nothing is remembered between pages.
  const pageChanged = distinctBy<BlotoutProperties>((properties) => {
    const path = typeof properties['path'] === 'string' ? withoutVariant(properties['path']) : ''

    return `${String(properties['title'] ?? '')}\u0000${path}`
  })
  const productChanged = distinctBy<BlotoutProperties>((properties) => JSON.stringify(properties))

  on<PixelEvent<PageViewedData>>('page_viewed', (event) => {
    // Above the gate: where the shopper is should not depend on whether we send a PageView for it.
    // `url` is declared non-optional but arrives from SHOPLINE, not from us, and repointing the
    // context at a missing one would strip the page URL off every later frame.
    if (typeof event.data.url === 'string' && event.data.url !== '') {
      blotout.setUrl(event.data.url)
    }

    // The `path` sent is whatever SHOPLINE gave us, `?sku=` included. Only the comparison ignores it.
    const properties = pageView(event.data)
    if (!pageChanged(properties)) {
      return
    }

    track(blotout, identify, { event: 'PageView', data: event.data, properties })
  })

  on<PixelEvent<ProductViewedData>>('product_viewed', (event) => {
    const properties = viewContent(event.data)
    if (!productChanged(properties)) {
      return
    }

    track(blotout, identify, { event: 'ViewContent', data: event.data, properties })
  })

  on<PixelEvent<CartChangeData>>('product_added_to_cart', (event) => {
    track(blotout, identify, { event: 'AddToCart', data: event.data, properties: cartChange(event.data) })
  })

  on<PixelEvent<CartChangeData>>('product_removed_from_cart', (event) => {
    track(blotout, identify, { event: 'RemoveFromCart', data: event.data, properties: cartChange(event.data) })
  })

  on<PixelEvent<CheckoutData>>('checkout_started', (event) => {
    track(blotout, identify, { event: 'InitiateCheckout', data: event.data, properties: initiateCheckout(event.data) })
  })

  // The identity step, not an event. It is the only place SHOPLINE gives us email, phone, name and
  // address together, and Blotout has no standard event for entering contact details.
  on<PixelEvent<ContactInfoData>>('checkout_contact_info_submitted', (event) => {
    identify(contactTraits(event.data))
  })

  on<PixelEvent<PaymentInfoData>>('payment_info_submitted', (event) => {
    track(blotout, identify, { event: 'AddPaymentInfo', data: event.data, properties: addPaymentInfo(event.data) })
  })

  on<PixelEvent<CheckoutCompletedData>>('checkout_completed', (event) => {
    // Identity from the order itself, so the conversion frame carries it rather than depending on
    // the earlier contact step arriving. One identify, before the
    // Purchase it belongs to.
    identify(purchaseTraits(event.data))

    // The order number is the eventId as well as the orderId: Blotout deduplicates conversions on it,
    // so a replayed checkout must not arrive as a second purchase. `orderSeq` is declared
    // non-optional, but it arrives from SHOPLINE rather than from us — and an empty one would ship a
    // conversion with no dedupe key at all, which is worse than a minted id that at least records
    // the purchase once.
    const orderId = typeof event.data.orderSeq === 'string' && event.data.orderSeq.trim() !== '' ? event.data.orderSeq : undefined
    if (orderId === undefined) {
      onError('checkout_completed arrived with no order number; the Purchase cannot be deduplicated')
    }

    blotout.track('Purchase', purchase(event.data), orderId)
  })

  on<PixelEvent<SearchSubmittedData>>('search_submitted', (event) => {
    track(blotout, identify, { event: 'Search', data: event.data, properties: search(event.data) })
  })

  on<PixelEvent<LeadData>>('lead', (event) => {
    track(blotout, identify, { event: 'Lead', data: event.data, properties: lead(event.data) })
  })
}

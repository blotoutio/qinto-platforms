import { describe, expect, it } from 'vitest'

import type { BlotoutSocket } from '../src/blotout-socket'
import { identitySender } from '../src/identity'
import type { Analytics } from '../src/subscriptions'
import { subscribeAll } from '../src/subscriptions'

type Sent =
  | { kind: 'track'; event: string; properties: Record<string, unknown> | undefined; eventId: string | undefined }
  | { kind: 'identify'; traits: Record<string, unknown>; id: string | null | undefined }
  | { kind: 'consent' }
  | { kind: 'setUrl'; url: string }

/**
 * Drives the real subscription table with synthetic SHOPLINE events.
 *
 * This is the check that matters most in this package: it asserts the exact payload each storefront
 * action produces, which is the thing a merchant's reporting depends on and the thing a careless
 * edit breaks silently.
 */
const harness = () => {
  const sent: Sent[] = []
  const handlers = new Map<string, (event: unknown) => void>()

  const analytics: Analytics = {
    subscribe: <T>(name: string, callback: (event: T) => void) => {
      handlers.set(name, callback as (event: unknown) => void)

      return () => true
    }
  }

  const blotout: BlotoutSocket = {
    track: (event, properties, eventId) => sent.push({ kind: 'track', event, properties, eventId }),
    identify: (traits, id) => sent.push({ kind: 'identify', traits, id }),
    consent: () => sent.push({ kind: 'consent' }),
    setUrl: (url) => sent.push({ kind: 'setUrl', url }),
    close: () => undefined
  }

  const errors: string[] = []
  // The real sender, with nothing sent yet — one page load of a session that has not identified.
  const identify = identitySender({ blotout, sessionId: 'sl_test', known: {} })
  subscribeAll(analytics, blotout, identify, (message) => errors.push(message))

  return {
    sent,
    errors,
    subscribed: () => [...handlers.keys()],
    fire: (name: string, data: unknown) => {
      const handler = handlers.get(name)
      if (handler === undefined) {
        throw new Error(`nothing subscribed to ${name}`)
      }

      handler({ clientId: 'sl-client-1', id: 'sl-event-1', timestamp: '1700000000000', name, data })
    },
    tracks: () => sent.filter((entry): entry is Extract<Sent, { kind: 'track' }> => entry.kind === 'track'),
    urls: () => sent.filter((entry): entry is Extract<Sent, { kind: 'setUrl' }> => entry.kind === 'setUrl').map((entry) => entry.url),
    identifies: () => sent.filter((entry): entry is Extract<Sent, { kind: 'identify' }> => entry.kind === 'identify')
  }
}

const ANON = { login_em: null, customer_id: null }
const SIGNED_IN = { login_em: 'ada@example.com', customer_id: 'cust-1' }

describe('the subscription table', () => {
  it('subscribes to exactly the mapped events and the identity step', () => {
    expect(harness().subscribed().sort()).toEqual(
      [
        'checkout_completed',
        'checkout_contact_info_submitted',
        'checkout_started',
        'lead',
        'page_viewed',
        'payment_info_submitted',
        'product_added_to_cart',
        'product_removed_from_cart',
        'product_viewed',
        'search_submitted'
      ].sort()
    )
  })

  it.each(['cart_viewed', 'collection_viewed', 'search_view_results', 'login', 'registration_completed'])(
    'does not subscribe to %s, which has no exact Blotout equivalent',
    (name) => {
      // Sending these under an invented name would pollute the merchant's event list, and renaming
      // one is a decision to raise rather than a guess to make.
      expect(harness().subscribed()).not.toContain(name)
    }
  )
})

describe('event mapping end to end', () => {
  it('page_viewed sends PageView', () => {
    const app = harness()
    app.fire('page_viewed', { ...ANON, title: 'Dress', url: 'https://shop/x', path: '/x' })

    expect(app.tracks()).toEqual([{ kind: 'track', event: 'PageView', properties: { title: 'Dress', path: '/x' }, eventId: undefined }])
  })

  it('product_viewed sends ViewContent', () => {
    const app = harness()
    app.fire('product_viewed', {
      ...ANON,
      spuId: 'spu-1',
      skuId: 'sku-1',
      skuItemNo: 'SKU-9',
      currency: 'USD',
      title: 'Dress',
      variant: 'M',
      price: 49.5,
      category: 'Dresses'
    })

    expect(app.tracks()[0]).toMatchObject({ event: 'ViewContent', properties: { currency: 'USD', value: 49.5 } })
  })

  it('product_added_to_cart sends AddToCart', () => {
    const app = harness()
    app.fire('product_added_to_cart', {
      ...ANON,
      cartId: 'c1',
      value: 99,
      currency: 'USD',
      list: [{ spuId: 'a', quantity: 2, price: 49.5 }]
    })

    expect(app.tracks()[0]).toMatchObject({ event: 'AddToCart', properties: { cartId: 'c1', value: 99 } })
  })

  it('product_removed_from_cart sends RemoveFromCart', () => {
    const app = harness()
    app.fire('product_removed_from_cart', { ...ANON, value: 49.5, currency: 'USD', list: [{ spuId: 'a', quantity: 1, price: 49.5 }] })

    expect(app.tracks()[0]).toMatchObject({ event: 'RemoveFromCart' })
  })

  it('checkout_started sends InitiateCheckout', () => {
    const app = harness()
    app.fire('checkout_started', { ...ANON, value: 99, currency: 'USD', list: [{ spuId: 'a', quantity: 2, price: 49.5 }] })

    expect(app.tracks()[0]).toMatchObject({ event: 'InitiateCheckout', properties: { numItems: 2 } })
  })

  it('payment_info_submitted sends AddPaymentInfo', () => {
    const app = harness()
    app.fire('payment_info_submitted', { ...ANON, value: 99, currency: 'USD', paymentType: 'card', list: [] })

    expect(app.tracks()[0]).toMatchObject({ event: 'AddPaymentInfo', properties: { paymentType: 'card' } })
  })

  it('search_submitted sends Search', () => {
    const app = harness()
    app.fire('search_submitted', { ...ANON, keyword: 'blue dress' })

    expect(app.tracks()[0]).toMatchObject({ event: 'Search', properties: { search: 'blue dress' } })
  })

  it('lead sends Lead', () => {
    const app = harness()
    app.fire('lead', { ...ANON, currency: 'USD', list: [{ price: 25, quantity: 2 }] })

    expect(app.tracks()[0]).toMatchObject({ event: 'Lead', properties: { value: 50 } })
  })

  it('checkout_completed sends Purchase with the order number as both orderId and eventId', () => {
    const app = harness()
    app.fire('checkout_completed', {
      ...SIGNED_IN,
      orderSeq: 'ORD-1001',
      value: 108.9,
      currency: 'USD',
      taxAmount: 9.9,
      email: 'ada@example.com',
      shippingAddress: { firstName: 'Ada', city: 'Hyderabad', country: 'IN' },
      list: [{ spuId: 'a', quantity: 2, price: 49.5 }]
    })

    // Blotout deduplicates conversions on the eventId, so a replayed checkout must not land twice.
    expect(app.tracks()[0]).toMatchObject({
      event: 'Purchase',
      eventId: 'ORD-1001',
      properties: { orderId: 'ORD-1001', value: 108.9, taxCost: 9.9 }
    })
  })

  it('mints an eventId and says so when SHOPLINE sends no order number', () => {
    const app = harness()
    app.fire('checkout_completed', { ...ANON, orderSeq: '  ', value: 10, currency: 'USD', list: [] })

    // A conversion with no dedupe key is worse than one recorded under a minted id, but the
    // merchant's reporting will not match their orders and they need to know why.
    expect(app.tracks()[0]?.eventId).toBeUndefined()
    expect(app.errors.some((message) => message.includes('no order number'))).toBe(true)
  })

  it.each([
    ['a missing data object', undefined],
    ['a null data object', null]
  ])('reports a mapping failure for %s instead of throwing back into the SHOPLINE handler', (_label, data) => {
    const app = harness()

    expect(() => app.fire('product_viewed', data)).not.toThrow()
    expect(app.errors.some((message) => message.includes('mapping product_viewed failed'))).toBe(true)
    expect(app.sent).toEqual([])
  })

  it('degrades rather than reporting when the payload is the wrong shape but still readable', () => {
    const app = harness()

    // Reading a field off a number yields `undefined` rather than throwing, so the event goes out
    // with whatever mapped. That is the right outcome: an event with thin properties is more useful
    // than no event, and there is nothing here for a merchant to act on.
    expect(() => app.fire('product_viewed', 42)).not.toThrow()
    expect(app.errors).toEqual([])
    expect(app.tracks()[0]).toMatchObject({ event: 'ViewContent', properties: {} })
  })

  it('reports a mapping failure instead of throwing back into the SHOPLINE handler', () => {
    const app = harness()

    // SHOPLINE's payloads are not ours to guarantee: a malformed event, a future field change, or a
    // merchant app publishing a same-named custom event with a different shape would otherwise
    // throw out of the callback SHOPLINE called, breaking the storefront rather than one event.
    expect(() => app.fire('product_added_to_cart', undefined)).not.toThrow()
    expect(app.errors.some((message) => message.includes('mapping product_added_to_cart failed'))).toBe(true)
    expect(app.sent).toEqual([])
  })

  it('checkout_completed identifies from what its payload actually carries, then purchases', () => {
    // SHOPLINE's `checkout_completed` has no email, phone or address — only `login_em` and
    // `customer_id`. This test used to feed it a contact block and assert the address came through,
    // which was asserting a payload SHOPLINE never sends. The contact step is where identity comes
    // from, and it fires earlier in the checkout.
    const app = harness()
    app.fire('checkout_completed', {
      ...SIGNED_IN,
      orderSeq: 'ORD-1',
      appOrderSeq: 'ORD-1',
      value: 10,
      currency: 'USD',
      taxAmount: 0,
      shippingAmount: 0,
      list: []
    })

    expect(app.sent[0]).toMatchObject({ kind: 'identify', id: SIGNED_IN.login_em, traits: { customerId: SIGNED_IN.customer_id } })
    expect(app.sent[1]).toMatchObject({ kind: 'track', event: 'Purchase' })
  })
})

describe('identity', () => {
  it('rides every event for a signed-in visitor', () => {
    const app = harness()
    app.fire('page_viewed', { ...SIGNED_IN, title: 'x', url: 'u', path: '/p' })

    expect(app.identifies()[0]).toMatchObject({ id: 'ada@example.com', traits: { email: 'ada@example.com', customerId: 'cust-1' } })
  })

  it('is skipped entirely for an anonymous visitor', () => {
    const app = harness()
    app.fire('page_viewed', { ...ANON, title: 'x', url: 'u', path: '/p' })

    // An identify with no traits and no id tells the graph nothing and still costs a frame.
    expect(app.identifies()).toEqual([])
  })

  it('links by customer id when there is no email', () => {
    const app = harness()
    app.fire('page_viewed', { login_em: null, customer_id: 'cust-9', title: 'x', url: 'u', path: '/p' })

    expect(app.identifies()[0]).toMatchObject({ id: 'cust-9' })
  })

  it('sends traits without an identifier, which attach to the anonymous profile', () => {
    const app = harness()
    app.fire('checkout_contact_info_submitted', { ...ANON, value: 10, currency: 'USD', list: [], shippingAddress: { city: 'Pune' } })

    expect(app.identifies()[0]).toMatchObject({ id: null, traits: { city: 'Pune' } })
  })

  it('identifies a guest purchase from the order, which is the only identity SHOPLINE gives it', () => {
    const app = harness()

    // No `login_em`, no `customer_id` — a guest. Before `userInfo` was read, this Purchase arrived
    // with no email at all and could not be attributed to a person.
    app.fire('checkout_completed', {
      ...ANON,
      orderSeq: 'ORDER-9',
      value: 100,
      currency: 'USD',
      taxAmount: 0,
      shippingAmount: 1,
      list: [],
      userInfo: { email: 'grace@example.com', firstName: 'Grace', country: 'GB' }
    })

    expect(app.identifies()).toEqual([
      { kind: 'identify', id: 'grace@example.com', traits: { email: 'grace@example.com', firstName: 'Grace', country: 'GB' } }
    ])
    expect(app.tracks()).toEqual([
      { kind: 'track', event: 'Purchase', properties: expect.objectContaining({ orderId: 'ORDER-9' }), eventId: 'ORDER-9' }
    ])
  })

  it('sends one identify per order, not one per trait source', () => {
    const app = harness()
    app.fire('checkout_completed', {
      ...SIGNED_IN,
      orderSeq: 'ORDER-10',
      value: 100,
      currency: 'USD',
      taxAmount: 0,
      shippingAmount: 1,
      list: [],
      userInfo: { email: 'ada@example.com' }
    })

    expect(app.identifies()).toHaveLength(1)
  })

  it('sends no event for checkout_contact_info_submitted, only identity', () => {
    const app = harness()
    app.fire('checkout_contact_info_submitted', { ...ANON, value: 10, currency: 'USD', list: [], email: 'ada@example.com' })

    // Blotout has no standard event for entering contact details, and inventing one would pollute the
    // merchant's event list. It is subscribed purely as the richest identity SHOPLINE offers.
    expect(app.tracks()).toEqual([])
    expect(app.identifies()).toHaveLength(1)
  })

  it('sends nothing at all when the contact step carried no identity', () => {
    const app = harness()
    app.fire('checkout_contact_info_submitted', { ...ANON, value: 10, currency: 'USD', list: [] })

    expect(app.sent).toEqual([])
  })
})

describe('identity, sent once', () => {
  it('sends one identify for a signed-in visitor across a whole page of events', () => {
    const app = harness()

    app.fire('page_viewed', { ...SIGNED_IN, title: 'Dress', url: 'https://shop/x', path: '/x' })
    app.fire('product_viewed', { ...SIGNED_IN, spuId: 'spu-1', currency: 'USD', price: 10, variant: 'M' })
    app.fire('product_added_to_cart', {
      ...SIGNED_IN,
      currency: 'USD',
      value: 10,
      cartId: 'c1',
      list: [{ spuId: 'spu-1', price: 10, quantity: 1 }]
    })

    // The same `login_em` on every event. The graph learns nothing from the repeats.
    expect(app.identifies()).toHaveLength(1)
    expect(app.tracks().map((entry) => entry.event)).toEqual(['PageView', 'ViewContent', 'AddToCart'])
  })

  it('sends identity again when the checkout adds phone, name and address', () => {
    const app = harness()

    app.fire('page_viewed', { ...SIGNED_IN, title: 'Checkout', url: 'https://shop/c', path: '/c' })
    app.fire('checkout_contact_info_submitted', {
      ...SIGNED_IN,
      value: 10,
      currency: 'USD',
      list: [],
      phone: '+447700900123',
      shippingAddress: { city: 'London' }
    })

    expect(app.identifies()).toHaveLength(2)
    expect(app.identifies()[1]?.traits).toMatchObject({ phone: '+447700900123', city: 'London' })
  })

  it('does not repeat a poorer identity after a richer one', () => {
    const app = harness()

    // The thank-you page publishes `checkout_completed` before `page_viewed`, so the order's full
    // identity goes first and the plain two that follow add nothing.
    app.fire('checkout_completed', {
      ...SIGNED_IN,
      orderSeq: 'ORDER-1',
      value: 10,
      currency: 'USD',
      taxAmount: 0,
      shippingAmount: 1,
      list: [],
      userInfo: { email: SIGNED_IN.login_em, phone: '+447700900123', city: 'London' }
    })
    app.fire('page_viewed', { ...SIGNED_IN, title: 'Thanks', url: 'https://shop/t', path: '/t' })

    expect(app.identifies()).toHaveLength(1)
  })

  it('sends identity again when a different visitor signs in', () => {
    const app = harness()

    app.fire('page_viewed', { ...SIGNED_IN, title: 'x', url: 'u', path: '/p' })
    app.fire('page_viewed', { login_em: 'grace@example.com', customer_id: 'cust-2', title: 'y', url: 'u2', path: '/p2' })

    expect(app.identifies().map((entry) => entry.id)).toEqual(['ada@example.com', 'grace@example.com'])
  })

  it('identifies on a page load that starts with nothing sent', () => {
    // What the harness models: a session that has not identified yet. Carrying identity *between*
    // page loads is `identity.ts`, and is tested there.
    const first = harness()
    first.fire('page_viewed', { ...SIGNED_IN, title: 'x', url: 'u', path: '/p' })

    const second = harness()
    second.fire('page_viewed', { ...SIGNED_IN, title: 'x', url: 'u', path: '/p' })

    expect([first.identifies().length, second.identifies().length]).toEqual([1, 1])
  })

  it('sends nothing for an anonymous visitor, however many events they produce', () => {
    const app = harness()

    app.fire('page_viewed', { ...ANON, title: 'x', url: 'u', path: '/p' })
    app.fire('page_viewed', { ...ANON, title: 'y', url: 'u2', path: '/p2' })

    expect(app.identifies()).toEqual([])
  })
})

/**
 * The republish cases, measured on the live storefront rather than reasoned about.
 *
 * SHOPLINE's theme republishes `product_viewed` on any change to the product form and republishes
 * `page_viewed` when it rewrites the URL for a variant. Both were verified against
 * `srini-test.myshopline.com` on 2026-09-10 by wrapping `Shopline.analytics.publish`.
 */
describe('events SHOPLINE republishes', () => {
  const PRODUCT = {
    ...ANON,
    spuId: 'spu-1',
    skuId: 'sku-1',
    skuItemNo: '240',
    currency: 'USD',
    title: 'Sweatshirt',
    variant: 'black,S',
    item_price: 49.5,
    category: 'Tops'
  }

  it('sends one ViewContent when a quantity click republishes the same product', () => {
    const app = harness()

    // A shopper on the product page clicking `+` twice. SHOPLINE republishes `product_viewed`
    // unchanged each time; nothing new has been viewed.
    app.fire('product_viewed', PRODUCT)
    app.fire('product_viewed', PRODUCT)
    app.fire('product_viewed', PRODUCT)

    expect(app.tracks()).toHaveLength(1)
  })

  it('sends a ViewContent for each variant the shopper actually switches to', () => {
    const app = harness()

    app.fire('product_viewed', PRODUCT)
    app.fire('product_viewed', { ...PRODUCT, skuId: 'sku-2', variant: 'black,M' })
    app.fire('product_viewed', PRODUCT)

    // Back to the first variant is a real second view of it, so three go out: only an *immediately*
    // repeated identity is dropped.
    const variants = app.tracks().map((entry) => {
      const contents = entry.properties?.['contents'] as { variant?: string }[] | undefined

      return contents?.[0]?.variant
    })

    expect(variants).toEqual(['black,S', 'black,M', 'black,S'])
  })

  it('sends one PageView when the same page is republished', () => {
    const app = harness()

    app.fire('page_viewed', { ...ANON, title: 'Dress', url: 'https://shop/x', path: '/x' })
    app.fire('page_viewed', { ...ANON, title: 'Dress', url: 'https://shop/x', path: '/x' })

    expect(app.tracks()).toHaveLength(1)
  })

  it('sends no PageView when the theme rewrites the URL for a variant', () => {
    const app = harness()

    app.fire('page_viewed', { ...ANON, title: 'Dress', url: 'https://shop/x', path: '/x' })
    app.fire('page_viewed', { ...ANON, title: 'Dress', url: 'https://shop/x?sku=2', path: '/x?sku=2' })
    app.fire('page_viewed', { ...ANON, title: 'Dress', url: 'https://shop/x?sku=3', path: '/x?sku=3' })

    // The shopper clicked two swatches. They viewed one page.
    expect(app.tracks()).toHaveLength(1)
  })

  it.each([
    ['a search for something else', '/search?keyword=shoes', '/search?keyword=dress'],
    ['the next page of a collection', '/collections/all', '/collections/all?page=2'],
    ['a variant change alongside a kept parameter', '/search?keyword=x&sku=1', '/search?keyword=y&sku=2']
  ])('still sends a PageView for %s', (_label, first, second) => {
    const app = harness()

    app.fire('page_viewed', { ...ANON, title: 'Shop', url: `https://shop${first}`, path: first })
    app.fire('page_viewed', { ...ANON, title: 'Shop', url: `https://shop${second}`, path: second })

    expect(app.tracks()).toHaveLength(2)
  })

  it('sends no PageView when only the variant changed under a kept parameter', () => {
    const app = harness()

    app.fire('page_viewed', { ...ANON, title: 'Shop', url: 'https://shop/x?keyword=y&sku=1', path: '/x?keyword=y&sku=1' })
    app.fire('page_viewed', { ...ANON, title: 'Shop', url: 'https://shop/x?keyword=y&sku=2', path: '/x?keyword=y&sku=2' })

    expect(app.tracks()).toHaveLength(1)
  })

  it('sends the path SHOPLINE gave it, variant parameter included', () => {
    const app = harness()

    app.fire('page_viewed', { ...ANON, title: 'Dress', url: 'https://shop/x?sku=2', path: '/x?sku=2' })

    // The parameter is ignored when deciding whether the page changed. It is not stripped from the
    // event: a merchant reading paths should see what their storefront actually served.
    expect(app.tracks()[0]?.properties).toEqual({ title: 'Dress', path: '/x?sku=2' })
  })

  it('repoints the page context at each new URL even when the PageView is suppressed', () => {
    const app = harness()

    app.fire('page_viewed', { ...ANON, title: 'Dress', url: 'https://shop/x', path: '/x' })
    app.fire('page_viewed', { ...ANON, title: 'Dress', url: 'https://shop/x?sku=2', path: '/x?sku=2' })

    // Where the shopper is does not depend on whether that move earned a PageView; the ViewContent
    // for the new variant has to carry the URL they are actually on.
    expect(app.urls()).toEqual(['https://shop/x', 'https://shop/x?sku=2'])
    expect(app.tracks()).toHaveLength(1)
  })

  it('sends a PageView on every page load, because the gate is per page load', () => {
    // Two page loads of the same URL are two `subscribeAll` calls. A reload must always report.
    const first = harness()
    first.fire('page_viewed', { ...ANON, title: 'Dress', url: 'https://shop/x', path: '/x' })

    const second = harness()
    second.fire('page_viewed', { ...ANON, title: 'Dress', url: 'https://shop/x', path: '/x' })

    expect([first.tracks().length, second.tracks().length]).toEqual([1, 1])
  })

  it('still reports a page whose title and path SHOPLINE omitted, once', () => {
    const app = harness()

    // A thin event is more useful than none, but two of them are still one page.
    app.fire('page_viewed', { ...ANON })
    app.fire('page_viewed', { ...ANON })

    expect(app.tracks()).toEqual([{ kind: 'track', event: 'PageView', properties: {}, eventId: undefined }])
  })

  it('leaves the page context alone when SHOPLINE sent no URL', () => {
    const app = harness()

    app.fire('page_viewed', { ...ANON, title: 'Dress', path: '/x' })

    expect(app.urls()).toEqual([])
    expect(app.tracks()).toHaveLength(1)
  })

  it('does not drop a repeated cart change, which is a shopper adding the same line twice', () => {
    const app = harness()
    const add = { ...ANON, currency: 'USD', value: 49.5, cartId: 'cart-1', list: [{ spuId: 'spu-1', price: 49.5, quantity: 1 }] }

    app.fire('product_added_to_cart', add)
    app.fire('product_added_to_cart', add)

    expect(app.tracks()).toHaveLength(2)
  })
})

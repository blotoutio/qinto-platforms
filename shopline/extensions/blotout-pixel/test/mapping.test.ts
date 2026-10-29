import { describe, expect, it } from 'vitest'

import {
  addPaymentInfo,
  cartChange,
  commonTraits,
  compact,
  contactTraits,
  identifierFor,
  initiateCheckout,
  lead,
  pageView,
  purchase,
  purchaseTraits,
  search,
  toContent,
  toContents,
  viewContent
} from '../src/mapping'
import type { CheckoutCompletedData } from '../src/types'

const COMMON = { login_em: null, customer_id: null }

/**
 * A payload as it actually arrives, rather than as SHOPLINE types it.
 *
 * SHOPLINE marks almost every field of every event payload required. Runtime data does not honour
 * that — which is the whole reason the mappers are defensive and every subscription is wrapped in
 * `guard`. Most of the tests below feed a deliberately under-delivered payload, so this asserts the
 * parameter type without inventing the missing fields. `T` is inferred from the call site, so no
 * annotation is needed.
 *
 * It is not a shortcut past the types: `src/types.ts` derives them from SHOPLINE's own, and that is
 * what stops a mapper reading a field SHOPLINE never sends.
 */
const delivered = <T>(data: unknown): T => data as T

describe('compact', () => {
  it('drops absent values so a payload never carries a null', () => {
    expect(compact({ a: 1, b: null, c: undefined, d: '', e: 0, f: false })).toEqual({ a: 1, e: 0, f: false })
  })

  it('keeps zero and false, which are answers rather than absences', () => {
    expect(compact({ value: 0, taxed: false })).toEqual({ value: 0, taxed: false })
  })

  it('drops an empty array, which carries nothing and costs bytes on every page', () => {
    expect(compact({ contents: [], list: [1] })).toEqual({ list: [1] })
  })
})

describe('toContent', () => {
  it('prefers the product id over the variant id', () => {
    // Ad platforms match on the product; a variant id would fragment one product into many.
    expect(toContent({ spuId: 'spu-1', skuId: 'sku-1', quantity: 2, price: 10 })).toMatchObject({ id: 'spu-1' })
  })

  it('falls back to the variant id when a store publishes only variants', () => {
    expect(toContent({ skuId: 'sku-1', quantity: 1, price: 5 })).toMatchObject({ id: 'sku-1' })
  })

  it('leaves the id empty rather than inventing one', () => {
    expect(toContent({ quantity: 1, price: 5 }).id).toBe('')
  })

  it('defaults an absent quantity to one and an absent price to zero', () => {
    expect(toContent({ spuId: 's' })).toMatchObject({ id: 's', quantity: 1, item_price: 0 })
  })

  it('carries the descriptive fields only when present', () => {
    expect(toContent({ spuId: 's', title: 'Dress', variant: 'M / Blue', category: 'Dresses', skuItemNo: 'SKU-9' })).toEqual({
      id: 's',
      quantity: 1,
      item_price: 0,
      title: 'Dress',
      variant: 'M / Blue',
      category: 'Dresses',
      sku: 'SKU-9'
    })
  })
})

describe('toContents', () => {
  it('maps every line', () => {
    expect(toContents([{ spuId: 'a' }, { spuId: 'b' }])).toHaveLength(2)
  })

  it('treats an absent list as empty', () => {
    expect(toContents(undefined)).toEqual([])
  })
})

describe('page_viewed → PageView', () => {
  it('sends the title and path, and nothing that duplicates the context', () => {
    // `url` already rides in every frame's `context.page`, so repeating it as a property would
    // store the same string twice on every event.
    expect(pageView({ ...COMMON, title: 'Dress', url: 'https://shop/x?y=1', path: '/x' })).toEqual({ title: 'Dress', path: '/x' })
  })

  it('omits an empty title', () => {
    expect(pageView({ ...COMMON, title: '', url: 'https://shop/x', path: '/x' })).toEqual({ path: '/x' })
  })
})

describe('product_viewed → ViewContent', () => {
  it('turns the flat payload into one content line', () => {
    expect(
      viewContent(
        delivered({
          ...COMMON,
          spuId: 'spu-1',
          skuId: 'sku-1',
          skuItemNo: 'SKU-9',
          currency: 'USD',
          title: 'Multi Color Stitching Dress',
          variant: 'M',
          price: 49.5,
          category: 'Dresses'
        })
      )
    ).toEqual({
      currency: 'USD',
      value: 49.5,
      contents: [
        {
          id: 'spu-1',
          quantity: 1,
          item_price: 49.5,
          title: 'Multi Color Stitching Dress',
          variantId: 'sku-1',
          variant: 'M',
          category: 'Dresses',
          sku: 'SKU-9'
        }
      ]
    })
  })
})

describe('cart changes → AddToCart / RemoveFromCart', () => {
  const data = {
    ...COMMON,
    cartId: 'cart-1',
    value: 99,
    currency: 'USD',
    list: [{ spuId: 'spu-1', quantity: 2, price: 49.5, title: 'Dress' }]
  }

  it('sends the value, currency, lines and cart id', () => {
    expect(cartChange(delivered(data))).toEqual({
      currency: 'USD',
      value: 99,
      cartId: 'cart-1',
      contents: [{ id: 'spu-1', quantity: 2, item_price: 49.5, title: 'Dress' }]
    })
  })

  it('omits an absent cart id', () => {
    const { cartId: _dropped, ...withoutCart } = data
    expect(cartChange(delivered(withoutCart))).not.toHaveProperty('cartId')
  })

  it('sends a zero value rather than dropping it', () => {
    // A free item is a real add-to-cart; dropping the value would make it look malformed.
    expect(cartChange(delivered({ ...data, value: 0 }))).toMatchObject({ value: 0 })
  })

  it('drops an empty line list', () => {
    expect(cartChange(delivered({ ...data, list: [] }))).not.toHaveProperty('contents')
  })
})

describe('checkout_started → InitiateCheckout', () => {
  it('counts the items as well as the money', () => {
    expect(
      initiateCheckout(
        delivered({
          ...COMMON,
          value: 148.5,
          currency: 'USD',
          list: [
            { spuId: 'a', quantity: 2, price: 49.5 },
            { spuId: 'b', quantity: 1, price: 49.5 }
          ]
        })
      )
    ).toMatchObject({ numItems: 3, currency: 'USD', value: 148.5 })
  })

  it('treats a line with no quantity as one item', () => {
    expect(initiateCheckout(delivered({ ...COMMON, value: 10, currency: 'USD', list: [{ spuId: 'a', price: 10 }] }))).toMatchObject({
      numItems: 1
    })
  })

  it('reports an empty cart as zero items rather than omitting the count', () => {
    expect(initiateCheckout(delivered({ ...COMMON, value: 0, currency: 'USD', list: [] }))).toEqual({
      currency: 'USD',
      value: 0,
      numItems: 0
    })
  })
})

describe('payment_info_submitted → AddPaymentInfo', () => {
  it('carries the payment type when SHOPLINE supplies one', () => {
    expect(
      addPaymentInfo(
        delivered({ ...COMMON, value: 99, currency: 'USD', paymentType: 'credit_card', list: [{ spuId: 'a', quantity: 1, price: 99 }] })
      )
    ).toMatchObject({ paymentType: 'credit_card' })
  })

  it('omits it when SHOPLINE does not', () => {
    expect(addPaymentInfo(delivered({ ...COMMON, value: 99, currency: 'USD', list: [] }))).not.toHaveProperty('paymentType')
  })
})

describe('checkout_completed → Purchase', () => {
  // The real payload shape: `shippingAmount` at the top level. There is no `checkout` object and no
  // subtotal — this fixture used to invent both, which is how the bug survived.
  const order = {
    ...COMMON,
    orderSeq: 'ORD-1001',
    appOrderSeq: 'ORD-1001',
    value: 108.9,
    currency: 'USD',
    taxAmount: 9.9,
    shippingAmount: 5,
    coupon: 'WELCOME10',
    list: [{ spuId: 'spu-1', quantity: 2, price: 49.5 }]
  }

  it('uses the order number as the orderId, which is the conversion dedupe key', () => {
    expect(purchase(delivered(order))).toMatchObject({ orderId: 'ORD-1001', value: 108.9, currency: 'USD' })
  })

  it('carries the money breakdown SHOPLINE actually sends', () => {
    expect(purchase(delivered(order))).toMatchObject({ taxCost: 9.9, shippingCost: 5, coupon: 'WELCOME10' })
  })

  it('omits a breakdown SHOPLINE did not send', () => {
    const bare = purchase(delivered({ ...COMMON, orderSeq: 'ORD-2', value: 10, currency: 'USD', list: [] }))

    expect(bare).toEqual({ orderId: 'ORD-2', value: 10, currency: 'USD' })
  })

  it('drops an empty contents list rather than sending one', () => {
    expect(purchase(delivered({ ...COMMON, orderSeq: 'ORD-3', value: 10, currency: 'USD', list: [] }))).not.toHaveProperty('contents')
  })
})

describe('search_submitted → Search', () => {
  it('sends the keyword', () => {
    expect(search({ ...COMMON, keyword: 'blue dress' })).toEqual({ search: 'blue dress' })
  })

  it('omits an empty keyword', () => {
    expect(search({ ...COMMON, keyword: '' })).toEqual({})
  })
})

describe('lead → Lead', () => {
  it('derives the value from the lines, because SHOPLINE sends none', () => {
    expect(lead(delivered({ ...COMMON, currency: 'USD', list: [{ price: 20, quantity: 2 }, { price: 10 }] }))).toMatchObject({ value: 50 })
  })

  it('reports a lead with no monetary lines as zero, not as absent', () => {
    expect(lead(delivered({ ...COMMON, currency: 'USD', list: [] }))).toEqual({ currency: 'USD', value: 0 })
  })
})

describe('commonTraits', () => {
  it('is empty for an anonymous visitor, so no identify is sent', () => {
    expect(commonTraits(COMMON)).toEqual({})
  })

  it('carries the login email and customer id for a signed-in visitor', () => {
    expect(commonTraits({ login_em: 'a@b.com', customer_id: 'cust-1' })).toEqual({ email: 'a@b.com', customerId: 'cust-1' })
  })
})

describe('contactTraits', () => {
  const base = { ...COMMON, value: 99, currency: 'USD', list: [] }

  it('prefers the explicit email over the login email', () => {
    expect(contactTraits(delivered({ ...base, login_em: 'old@b.com', email: 'typed@b.com' }))).toMatchObject({ email: 'typed@b.com' })
  })

  it('falls back to the login email when the contact step carried none', () => {
    expect(contactTraits(delivered({ ...base, login_em: 'login@b.com' }))).toMatchObject({ email: 'login@b.com' })
  })

  it('maps the whole shipping address', () => {
    expect(
      contactTraits(
        delivered({
          ...base,
          email: 'a@b.com',
          shippingAddress: { firstName: 'Ada', lastName: 'Lovelace', city: 'Hyderabad', state: 'Telangana', country: 'IN', zip: '500001' }
        })
      )
    ).toEqual({
      email: 'a@b.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      city: 'Hyderabad',
      state: 'Telangana',
      country: 'IN',
      postalCode: '500001'
    })
  })

  it('prefers the typed phone over the address phone', () => {
    expect(contactTraits(delivered({ ...base, phone: '+911', shippingAddress: { phone: '+912' } }))).toMatchObject({ phone: '+911' })
  })

  it('uses the address phone when nothing else is given', () => {
    expect(contactTraits(delivered({ ...base, shippingAddress: { phone: '+912' } }))).toMatchObject({ phone: '+912' })
  })

  it('is empty when the step carried no identity at all', () => {
    expect(contactTraits(delivered(base))).toEqual({})
  })
})

describe('identifierFor', () => {
  it('prefers email, because it resolves to one person across channels', () => {
    expect(identifierFor({ email: 'A@B.com', customerId: 'cust-1' })).toBe('a@b.com')
  })

  it('trims and lowercases, so the same person is not two identities', () => {
    expect(identifierFor({ email: '  Ada@Example.COM ' })).toBe('ada@example.com')
  })

  it('falls back to the customer id', () => {
    expect(identifierFor({ customerId: 'cust-1' })).toBe('cust-1')
  })

  it('returns null rather than an empty id, which Blotout refuses', () => {
    expect(identifierFor({})).toBeNull()
    expect(identifierFor({ email: '   ', customerId: '' })).toBeNull()
    expect(identifierFor({ email: 42, customerId: null })).toBeNull()
  })
})

/**
 * The identity a real order actually carries.
 *
 * Payload shape read off a live order on `srini-test.myshopline.com` on 2026-09-10, not from the
 * SDK's types, which declare neither `userInfo` nor a numeric `customer_id`.
 */
describe('purchaseTraits', () => {
  const ORDER = {
    login_em: null,
    customer_id: null,
    orderSeq: 'ORDER-1',
    value: 100,
    currency: 'USD',
    shippingAmount: 1,
    taxAmount: 0,
    list: []
  } as unknown as CheckoutCompletedData

  it('takes the whole identity from userInfo, which is all a guest ever has', () => {
    expect(
      purchaseTraits({
        ...ORDER,
        userInfo: {
          email: 'Grace@Example.com',
          phone: '+447700900789',
          firstName: 'Grace',
          lastName: 'Hopper',
          city: 'Birmingham',
          province: 'West Midlands',
          country: 'GB',
          postcode: 'B1 1AA',
          user_id: 2792498953
        }
      } as Parameters<typeof purchaseTraits>[0])
    ).toEqual({
      email: 'Grace@Example.com',
      phone: '+447700900789',
      firstName: 'Grace',
      lastName: 'Hopper',
      city: 'Birmingham',
      state: 'West Midlands',
      country: 'GB',
      postalCode: 'B1 1AA',
      customerId: '2792498953'
    })
  })

  it('falls back to login_em when SHOPLINE sent no userInfo', () => {
    expect(purchaseTraits({ ...ORDER, login_em: 'ada@example.com', customer_id: 'cust-1' })).toEqual({
      email: 'ada@example.com',
      customerId: 'cust-1'
    })
  })

  it('returns nothing for an order SHOPLINE gave no identity for, so identify is skipped', () => {
    expect(purchaseTraits(ORDER)).toEqual({})
  })

  it('carries a numeric customer_id through as an identifier', () => {
    // Declared `string | null`; `checkout_completed` sends a number. Before this, a guest with a
    // customer id and no email linked to nothing.
    const traits = purchaseTraits({ ...ORDER, customer_id: 2792498953 })

    expect(traits).toEqual({ customerId: '2792498953' })
    expect(identifierFor(traits)).toBe('2792498953')
  })

  it('prefers the order email over a stale signed-in one', () => {
    const traits = purchaseTraits({ ...ORDER, login_em: 'old@example.com', userInfo: { email: 'new@example.com' } })

    expect(identifierFor(traits)).toBe('new@example.com')
  })
})

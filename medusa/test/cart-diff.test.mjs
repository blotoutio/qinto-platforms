import { strict as assert } from "node:assert"
import { test } from "node:test"
import { NO_CART, diffEvents, snapshotOf } from "../.test-build/cart-diff.js"

/**
 * The cart diff is where every bug found during live verification lived, so each rule below is
 * pinned by a test rather than by a comment.
 */

const line = (id, quantity, unitPrice = 10, productId = "prod_1") => ({
  id,
  quantity,
  unit_price: unitPrice,
  product_id: productId,
  variant_id: "variant_1",
  product_title: "Medusa Sweatshirt",
})

const cart = (items, extra = {}) => ({
  id: "cart_1",
  currency_code: "eur",
  total: items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0),
  items,
  ...extra,
})

const names = (events) => events.map((e) => e.name)

test("a quantity increase is an AddToCart of the delta, not of the new total", () => {
  const before = snapshotOf(cart([line("l1", 1)]))
  const after = cart([line("l1", 3)])

  const events = diffEvents(after, before, snapshotOf(after))

  assert.deepEqual(names(events), ["AddToCart"])
  assert.equal(events[0].properties.contents[0].quantity, 2)
  assert.equal(events[0].properties.value, 20)
})

test("a quantity decrease is a RemoveFromCart of the delta", () => {
  const before = snapshotOf(cart([line("l1", 3)]))
  const after = cart([line("l1", 1)])

  const events = diffEvents(after, before, snapshotOf(after))

  assert.deepEqual(names(events), ["RemoveFromCart"])
  assert.equal(events[0].properties.contents[0].quantity, 2)
})

test("a line removed outright still carries its price and product id", () => {
  // The line is gone from the new cart, so this can only come from the stored snapshot.
  const before = snapshotOf(cart([line("l1", 2)]))
  const after = cart([])

  const events = diffEvents(after, before, snapshotOf(after))

  assert.deepEqual(names(events), ["RemoveFromCart"])
  assert.equal(events[0].properties.value, 20)
  assert.equal(events[0].properties.contents[0].id, "prod_1")
  assert.equal(events[0].properties.contents[0].quantity, 2)
})

test("an unchanged cart produces nothing", () => {
  const same = cart([line("l1", 2)])

  assert.deepEqual(diffEvents(same, snapshotOf(same), snapshotOf(same)), [])
})

test("a returning shopper's existing cart is a starting position, not a pile of adds", () => {
  // No snapshot at all: this session has never looked, so it cannot claim anything was added.
  const after = cart([line("l1", 3)])

  assert.deepEqual(diffEvents(after, null, snapshotOf(after)), [])
})

test("a new visitor's FIRST add is reported — the bug that shipped silently", () => {
  // NO_CART means "we looked, and there was no cart". Everything in the cart is therefore new.
  const after = cart([line("l1", 1)])

  const events = diffEvents(after, NO_CART, snapshotOf(after))

  assert.deepEqual(names(events), ["AddToCart"])
  assert.equal(events[0].properties.contents[0].quantity, 1)
})

test("a different cart id resets rather than reporting a phantom diff", () => {
  const before = snapshotOf(cart([line("l1", 5)]))
  const after = { ...cart([line("l9", 1)]), id: "cart_2" }

  assert.deepEqual(diffEvents(after, before, snapshotOf(after)), [])
})

test("shipping and payment appearing each emit once, and not again", () => {
  const empty = cart([line("l1", 1)])
  const withShipping = cart([line("l1", 1)], { shipping_methods: [{ id: "sm_1" }] })
  const withBoth = cart([line("l1", 1)], {
    shipping_methods: [{ id: "sm_1" }],
    payment_collection: { payment_sessions: [{ id: "ps_1" }] },
  })

  assert.deepEqual(
    names(diffEvents(withShipping, snapshotOf(empty), snapshotOf(withShipping))),
    ["AddShippingInfo"]
  )
  assert.deepEqual(
    names(diffEvents(withBoth, snapshotOf(withShipping), snapshotOf(withBoth))),
    ["AddPaymentInfo"]
  )
  // Steady state: neither fires a second time.
  assert.deepEqual(diffEvents(withBoth, snapshotOf(withBoth), snapshotOf(withBoth)), [])
})

test("several lines changing at once each produce their own event", () => {
  const before = snapshotOf(cart([line("l1", 1), line("l2", 2, 10, "prod_2")]))
  const after = cart([line("l1", 3), line("l3", 1, 10, "prod_3")])

  const events = diffEvents(after, before, snapshotOf(after))

  assert.deepEqual(names(events).sort(), ["AddToCart", "AddToCart", "RemoveFromCart"])
})

test("currency is carried from the cart, upper-cased", () => {
  const before = snapshotOf(cart([line("l1", 1)]))
  const after = cart([line("l1", 2)])

  assert.equal(diffEvents(after, before, snapshotOf(after))[0].properties.currency, "EUR")
})

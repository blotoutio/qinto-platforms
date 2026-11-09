import { strict as assert } from "node:assert"
import { test } from "node:test"
import { NO_CART, diffEvents, reportChoice, shippingChoice, snapshotOf } from "../.test-build/cart-diff.js"

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

const ADDRESS = { address_1: "1 Queen Street", postal_code: "1010", city: "Auckland" }
const method = (option) => ({ shipping_option_id: option })

test("a pre-selected shipping option or a payment session on the cart reports nothing", () => {
  // The reported bug: the storefront does both on its own, before the shopper has chosen anything.
  const before = cart([line("l1", 1)])
  const after = cart([line("l1", 1)], {
    shipping_methods: [method("so_standard")],
    payment_collection: { payment_sessions: [{ id: "ps_1" }] },
  })

  assert.deepEqual(diffEvents(after, snapshotOf(before), snapshotOf(after)), [])
  assert.equal(shippingChoice(after), "")
})

test("the shipping choice needs both an option and a street address", () => {
  assert.equal(shippingChoice(cart([], { shipping_address: ADDRESS })), "")
  assert.equal(shippingChoice(cart([], { shipping_methods: [method("so_a")], shipping_address: { country_code: "nz" } })), "")
  assert.equal(shippingChoice(cart([], { shipping_methods: [method("so_a")], shipping_address: ADDRESS })), "so_a")
})

test("a choice is reported once, and again only when it changes", () => {
  const c = cart([line("l1", 1)])

  assert.equal(reportChoice(c, null, "shipping", ""), null)

  const standard = reportChoice(c, null, "shipping", "so_standard")
  assert.deepEqual(standard, { cartId: "cart_1", shipping: "so_standard", payment: "" })
  assert.equal(reportChoice(c, standard, "shipping", "so_standard"), null)

  // Medusa replaces the method, so a count would not move; the option does.
  assert.equal(reportChoice(c, standard, "shipping", "so_express").shipping, "so_express")
})

test("shipping and payment are remembered separately, and per cart", () => {
  const c = cart([line("l1", 1)])
  const both = reportChoice(c, reportChoice(c, null, "shipping", "so_a"), "payment", "card")

  assert.deepEqual(both, { cartId: "cart_1", shipping: "so_a", payment: "card" })
  assert.equal(reportChoice(c, both, "payment", "card"), null)
  assert.equal(reportChoice(c, both, "payment", "paypal").payment, "paypal")

  // A new cart starts clean.
  assert.deepEqual(reportChoice({ ...c, id: "cart_2" }, both, "payment", "card"), {
    cartId: "cart_2",
    shipping: "",
    payment: "card",
  })
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

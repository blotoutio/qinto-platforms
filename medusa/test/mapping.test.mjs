import test from "node:test"
import assert from "node:assert/strict"
import * as m from "../.test-build/mapping.js"

/**
 * The safety contract, tested directly.
 *
 * `purchase`, `cartEvent` and `viewContent` are called inside server-rendered JSX — the order
 * confirmation page calls `purchase(order)` in its own markup. A throw there is a 500 on the page
 * a shopper sees after paying, so these tests feed each mapper the shapes a real store eventually
 * produces: nulls, missing relations, wrong types, and objects that throw when read.
 */

const hostile = [
  ["null", null],
  ["undefined", undefined],
  ["empty object", {}],
  ["number", 42],
  ["string", "nonsense"],
  ["array", []],
  ["items not an array", { items: "not-an-array", currency_code: "eur" }],
  ["items containing null", { items: [null, undefined], currency_code: "eur" }],
  ["getter that throws", { get items() { throw new Error("boom") } }],
  ["nested getter that throws", { items: [{ get unit_price() { throw new Error("boom") } }] }],
]

for (const [name, input] of hostile) {
  test(`purchase() survives ${name}`, () => {
    assert.doesNotThrow(() => m.purchase(input))
  })
  test(`cartEvent() survives ${name}`, () => {
    assert.doesNotThrow(() => m.cartEvent(input))
  })
  test(`orderIdOf() survives ${name}`, () => {
    assert.doesNotThrow(() => m.orderIdOf(input))
    assert.equal(typeof m.orderIdOf(input), "string")
  })
  test(`orderTraits() survives ${name}`, () => {
    assert.doesNotThrow(() => m.orderTraits(input))
  })
  test(`toContents() survives ${name}`, () => {
    assert.doesNotThrow(() => m.toContents(input))
    assert.ok(Array.isArray(m.toContents(input)))
  })
  test(`viewContent() survives ${name}`, () => {
    assert.doesNotThrow(() => m.viewContent(input, undefined, "eur"))
  })
}

test("compact drops empties but keeps 0 and false", () => {
  const out = m.compact({ a: 0, b: false, c: null, d: undefined, e: "", f: [], g: "keep" })
  assert.deepEqual(out, { a: 0, b: false, g: "keep" })
})

test("purchase maps a realistic order correctly", () => {
  const out = m.purchase({
    display_id: 7,
    currency_code: "eur",
    total: 20,
    tax_total: 0,
    shipping_total: 10,
    items: [{ product_id: "prod_1", variant_id: "var_1", quantity: 2, unit_price: 5,
              product_title: "Tee", variant: { sku: "TEE-M" } }],
  })
  assert.equal(out.orderId, "7")
  assert.equal(out.currency, "EUR")
  assert.equal(out.value, 20)
  assert.equal(out.shippingCost, 10)
  assert.equal(out.contents[0].id, "prod_1")
  assert.equal(out.contents[0].value, 5, "value is per unit, not line total")
  assert.equal("item_price" in out.contents[0], false)
  assert.equal(out.contents[0].quantity, 2)
  assert.equal(out.contents[0].sku, "TEE-M")
})

test("every content item carries a per-unit value and no item_price", () => {
  const product = {
    id: "prod_1",
    title: "Tee",
    handle: "tee",
    categories: [],
  }
  const variant = { id: "var_1", sku: "TEE-M", calculated_price: { calculated_amount: 5 } }

  const view = m.viewContent(product, variant, "eur")
  assert.equal(view.contents[0].value, 5)
  assert.equal("item_price" in view.contents[0], false)

  const add = m.cartLineChange(product, variant, 3, "eur")
  assert.equal(add.value, 15, "the event's value is the line's contribution")
  assert.equal(add.contents[0].value, 5, "the item's value stays the unit price")
  assert.equal(add.contents[0].quantity, 3)
  assert.equal("item_price" in add.contents[0], false)

  const cart = m.cartEvent({
    currency_code: "eur",
    total: 10,
    items: [{ product_id: "prod_1", quantity: 2, unit_price: 5 }],
  })
  assert.equal(cart.contents[0].value, 5)
  assert.equal("item_price" in cart.contents[0], false)

  assert.deepEqual(m.toContent(null), { id: "", quantity: 1, value: 0 }, "the guard fallback too")
})

test("traits use the standard keys: first_name, last_name, postal_code", () => {
  const traits = m.orderTraits({
    email: "ada@localhost.test",
    shipping_address: {
      first_name: "Ada",
      last_name: "Lovelace",
      phone: "+4533445566",
      address_1: "12 Analytical Way",
      city: "Aarhus",
      province: "Midtjylland",
      postal_code: "2200",
      country_code: "dk",
    },
  })

  assert.deepEqual(traits, {
    email: "ada@localhost.test",
    first_name: "Ada",
    last_name: "Lovelace",
    phone: "+4533445566",
    address: "12 Analytical Way",
    city: "Aarhus",
    state: "Midtjylland",
    postal_code: "2200",
    country: "dk",
  })

  assert.deepEqual(
    m.customerTraits({ email: "ada@localhost.test", first_name: "Ada", last_name: "Lovelace" }),
    { email: "ada@localhost.test", first_name: "Ada", last_name: "Lovelace" }
  )
})

test("orderIdOf uses the order's own id, not its display number", () => {
  // `display_id` is a per-store sequence and collides across stores; `id` is what the Store API,
  // webhooks and the merchant's own database all join on.
  assert.equal(m.orderIdOf({ display_id: 12, id: "order_abc" }), "order_abc")
  assert.equal(m.orderIdOf({ id: "order_abc" }), "order_abc")
  assert.equal(m.orderIdOf({ display_id: 12 }), "12")
})

test("a guarded mapper returns a usable empty value, not undefined", () => {
  assert.deepEqual(m.purchase(null), {})
  assert.deepEqual(m.toContents(null), [])
  assert.equal(m.orderIdOf(null), "")
})

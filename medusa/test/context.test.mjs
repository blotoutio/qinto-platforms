import test from "node:test"
import assert from "node:assert/strict"
import * as c from "../.test-build/context.js"

/**
 * The context route's two guarantees: ids cannot steer the backend request, and the browser gets
 * back only the fields tracking reads — never a payment session's provider data.
 */

test("ids must be a Medusa-shaped id", () => {
  assert.equal(c.isCartId("cart_01JABCDEF123"), true)
  assert.equal(c.isOrderId("order_01JABCDEF123"), true)

  for (const bad of [
    "",
    null,
    undefined,
    "../customers/me",
    "order_1/../../customers/me",
    "order_1?fields=*customer",
    "order_1#x",
    "order_1%2F..",
    "cart_01JABC",
  ]) {
    assert.equal(c.isOrderId(bad), false, String(bad))
  }

  assert.equal(c.isCartId("order_01JABC"), false)
})

test("field lists replace Medusa's defaults rather than adding to them", () => {
  // A leading `+`, `-` or `*` on every entry would keep the defaults, payment session data included.
  for (const list of [c.CART_FIELDS, c.ORDER_FIELDS, c.CUSTOMER_FIELDS, c.productFields(true)]) {
    assert.ok(list.split(",").some((f) => !/^[+\-* ]/.test(f)), list)
  }

  assert.doesNotMatch(c.CART_FIELDS, /payment_sessions\.data|billing_address|metadata/)
  assert.match(c.productFields(true), /calculated_price/)
  assert.doesNotMatch(c.productFields(false), /calculated_price/)
})

test("projectCart drops payment session data and unread fields", () => {
  const cart = c.projectCart({
    id: "cart_1",
    currency_code: "eur",
    email: "a@b.co",
    total: 20,
    metadata: { secret: 1 },
    billing_address: { address_1: "x" },
    items: [
      { id: "li_1", quantity: 2, unit_price: 10, product_id: "prod_1", variant_sku: "SKU", metadata: {} },
    ],
    shipping_methods: [{ id: "sm_1", data: { x: 1 } }],
    payment_collection: {
      id: "pc_1",
      payment_sessions: [{ id: "ps_1", data: { client_secret: "pi_secret" } }],
    },
    shipping_address: { first_name: "A", city: "Ljubljana", metadata: {}, id: "addr_1" },
  })

  assert.deepEqual(cart, {
    id: "cart_1",
    currency_code: "eur",
    email: "a@b.co",
    total: 20,
    items: [
      { id: "li_1", quantity: 2, unit_price: 10, product_id: "prod_1", variant: { sku: "SKU" } },
    ],
    shipping_methods: [{ id: "sm_1" }],
    payment_collection: { payment_sessions: [{ id: "ps_1" }] },
    shipping_address: { first_name: "A", city: "Ljubljana" },
  })
  assert.doesNotMatch(JSON.stringify(cart), /secret/)
})

test("projectOrder keeps what purchase() and orderTraits() read", () => {
  const order = c.projectOrder({
    id: "order_1",
    display_id: 7,
    currency_code: "eur",
    email: "a@b.co",
    total: 20,
    tax_total: 2,
    shipping_total: 3,
    customer: { id: "cus_1" },
    payment_collections: [{ payment_sessions: [{ data: { client_secret: "x" } }] }],
    billing_address: { address_1: "x" },
    items: [{ id: "oli_1", quantity: 1, unit_price: 20, product_handle: "shirt" }],
    shipping_address: { postal_code: "1000", country_code: "si", company: "Acme" },
  })

  assert.deepEqual(order, {
    id: "order_1",
    display_id: 7,
    currency_code: "eur",
    email: "a@b.co",
    total: 20,
    tax_total: 2,
    shipping_total: 3,
    items: [{ id: "oli_1", quantity: 1, unit_price: 20, product_handle: "shirt" }],
    shipping_address: { postal_code: "1000", country_code: "si" },
  })
})

test("projectProduct and projectCustomer keep only mapped fields", () => {
  assert.deepEqual(
    c.projectProduct({
      id: "prod_1",
      title: "Shirt",
      handle: "shirt",
      description: "long",
      categories: [{ id: "cat_1", name: "Tops" }],
      variants: [
        {
          id: "var_1",
          sku: "S",
          inventory_quantity: 4,
          calculated_price: { calculated_amount: 10, currency_code: "eur", raw: {} },
        },
      ],
    }),
    {
      id: "prod_1",
      title: "Shirt",
      handle: "shirt",
      categories: [{ name: "Tops" }],
      variants: [
        { id: "var_1", sku: "S", calculated_price: { calculated_amount: 10, currency_code: "eur" } },
      ],
    }
  )

  assert.deepEqual(
    c.projectCustomer({ id: "cus_1", email: "a@b.co", addresses: [{}], metadata: {} }),
    { id: "cus_1", email: "a@b.co" }
  )
})

test("projections tolerate junk", () => {
  for (const junk of [null, undefined, 42, "x", [], { items: "nope", payment_collection: [] }]) {
    assert.doesNotThrow(() => {
      c.projectCart(junk)
      c.projectOrder(junk)
      c.projectProduct(junk)
      c.projectCustomer(junk)
    })
  }

  assert.equal(c.projectCart(null), null)
})

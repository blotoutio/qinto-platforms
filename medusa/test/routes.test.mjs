import { strict as assert } from "node:assert"
import { test } from "node:test"
import {
  DEFAULT_ROUTES,
  isCheckoutPath,
  matchPattern,
  orderIdOfPath,
  productHandleOf,
  splitCountry,
} from "../.test-build/routes.js"

const path = (p) => p.split("/").filter(Boolean)

test("the defaults are the Medusa starter's own shapes", () => {
  // An install that passes no config must behave exactly as it did before routes were configurable.
  assert.deepEqual(DEFAULT_ROUTES, {
    product: "products/:handle",
    checkout: "checkout",
    order: "order/:id/confirmed",
  })

  assert.equal(productHandleOf(undefined, path("/products/sweatshirt"), "/products/sweatshirt"), "sweatshirt")
  assert.equal(isCheckoutPath(undefined, path("/checkout"), "/checkout"), true)
  assert.equal(orderIdOfPath(undefined, path("/order/order_123/confirmed"), ""), "order_123")
})

test("a pattern matches the head of the path, not the whole of it", () => {
  // The starter walks checkout steps underneath the same path, and all of them are still checkout.
  assert.equal(isCheckoutPath(undefined, path("/checkout/payment"), ""), true)
  assert.equal(productHandleOf(undefined, path("/products/sweatshirt/reviews"), ""), "sweatshirt")
})

test("a literal that does not match yields nothing rather than a wrong id", () => {
  assert.equal(productHandleOf(undefined, path("/collections/winter"), ""), null)
  assert.equal(isCheckoutPath(undefined, path("/cart"), ""), false)
  // `order/:id/confirmed` must see the final literal, or a cancelled order would report a purchase.
  assert.equal(orderIdOfPath(undefined, path("/order/order_123/cancelled"), ""), null)
  assert.equal(orderIdOfPath(undefined, path("/order/order_123"), ""), null)
})

test("a merchant's own paths are matched by configuring them", () => {
  const routes = {
    product: "wiper-blades/:make/:model",
    checkout: "shop/checkout",
    order: "shop/order/:id",
  }

  // Several captures join with `-`, which is how a split handle usually reads back.
  assert.equal(productHandleOf(routes, path("/wiper-blades/toyota/corolla"), ""), "toyota-corolla")
  assert.equal(isCheckoutPath(routes, path("/shop/checkout"), ""), true)
  assert.equal(isCheckoutPath(routes, path("/checkout"), ""), false)
  assert.equal(orderIdOfPath(routes, path("/shop/order/order_9"), ""), "order_9")
})

test("a function covers shapes a pattern cannot express", () => {
  const routes = {
    product: (segments) =>
      segments[0] === "p" && segments[1] ? segments[1].split("--")[0] : null,
  }

  assert.equal(productHandleOf(routes, path("/p/sweatshirt--blue"), ""), "sweatshirt")
  assert.equal(productHandleOf(routes, path("/other"), ""), null)
})

test("`*` captures the remainder for a path of unknown depth", () => {
  const routes = { product: "shop/*" }

  assert.equal(productHandleOf(routes, path("/shop/mens/tops/tee"), ""), "mens/tops/tee")
  assert.equal(productHandleOf(routes, path("/shop"), ""), null)
})

test("`false` turns an event off for a storefront that has no such page", () => {
  const routes = { checkout: false, product: false, order: false }

  assert.equal(isCheckoutPath(routes, path("/checkout"), ""), false)
  assert.equal(productHandleOf(routes, path("/products/x"), ""), null)
  assert.equal(orderIdOfPath(routes, path("/order/x/confirmed"), ""), null)
})

test("the country prefix is stripped, kept or redefined", () => {
  assert.deepEqual(splitCountry(path("/dk/products/x")), { country: "dk", rest: ["products", "x"] })
  assert.deepEqual(splitCountry(path("/products/x")), { country: null, rest: ["products", "x"] })

  // A storefront with no country segment must not lose a real two-letter page to the default rule.
  assert.deepEqual(splitCountry(path("/hr/jobs"), false), { country: null, rest: ["hr", "jobs"] })
  assert.deepEqual(splitCountry(path("/en-gb/products/x"), (s) => s.includes("-")), {
    country: "en-gb",
    rest: ["products", "x"],
  })
})

test("matching is case-insensitive on literals but preserves captured case", () => {
  assert.deepEqual(matchPattern("Products/:handle", path("/products/Blue-Tee")), { handle: "Blue-Tee" })
})

test("an empty path matches nothing rather than everything", () => {
  assert.equal(matchPattern("products/:handle", []), null)
  assert.equal(matchPattern("", path("/products/x")), null)
  assert.equal(isCheckoutPath(undefined, [], "/"), false)
})

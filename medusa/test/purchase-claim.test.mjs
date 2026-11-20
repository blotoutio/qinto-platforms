import { strict as assert } from "node:assert"
import { test } from "node:test"
import { CLAIM_WINDOW_MS, claimability, isOrderId } from "../.test-build/purchase-claim.js"

/**
 * Which orders the backend lets a browser claim. A claim decides whether a Purchase is sent at all,
 * so a wrong "claimable" double-counts and a wrong refusal loses a conversion.
 */

const NOW = Date.parse("2026-11-20T10:00:00Z")
const order = (extra = {}) => ({
  id: "order_01ABC",
  created_at: new Date(NOW - 60_000).toISOString(),
  sales_channel_id: "sc_nz",
  ...extra,
})

test("a fresh order of this storefront is claimable", () => {
  assert.equal(claimability(order(), ["sc_nz"], NOW), "claimable")
  assert.equal(claimability(order({ created_at: new Date(NOW - 60_000) }), ["sc_nz"], NOW), "claimable")
})

test("a missing order is not", () => {
  assert.equal(claimability(undefined, ["sc_nz"], NOW), "not_found")
  assert.equal(claimability(null, ["sc_nz"], NOW), "not_found")
})

test("another storefront's order is not, even with its id", () => {
  assert.equal(claimability(order({ sales_channel_id: "sc_au" }), ["sc_nz"], NOW), "other_store")
  assert.equal(claimability(order({ sales_channel_id: null }), ["sc_nz"], NOW), "other_store")
  // A key spanning several channels covers each of them.
  assert.equal(claimability(order({ sales_channel_id: "sc_au" }), ["sc_nz", "sc_au"], NOW), "claimable")
})

test("an order older than the window is not: it was placed before this version, or long ago", () => {
  const old = new Date(NOW - CLAIM_WINDOW_MS - 1).toISOString()
  assert.equal(claimability(order({ created_at: old }), ["sc_nz"], NOW), "stale")
  const edge = new Date(NOW - CLAIM_WINDOW_MS + 1).toISOString()
  assert.equal(claimability(order({ created_at: edge }), ["sc_nz"], NOW), "claimable")
})

test("an unreadable date is not trusted; a clock slightly ahead is", () => {
  for (const bad of [null, undefined, "", "yesterday", 0]) {
    assert.equal(claimability(order({ created_at: bad }), ["sc_nz"], NOW), "stale", String(bad))
  }
  assert.equal(claimability(order({ created_at: new Date(NOW + 30_000).toISOString() }), ["sc_nz"], NOW), "claimable")
})

test("order ids are Medusa-shaped", () => {
  assert.equal(isOrderId("order_01JABCDEF123"), true)
  for (const bad of ["", null, undefined, "order_1/../x", "cart_01ABC", "order_", "order_1?x=1"]) {
    assert.equal(isOrderId(bad), false, String(bad))
  }
})

import test from "node:test"
import assert from "node:assert/strict"
import * as m from "../.test-build/mapping.js"

/**
 * Alias order decides whether a returning shopper stays one person.
 *
 * `graph` models the rules on docs.blotout.io/id-graph: an unowned identifier creates a person
 * unless the browser is already linked (then it attaches there); an owned identifier joins an
 * unlinked browser to its owner, and is a conflict for a browser linked to someone else. Persons are
 * never merged and identifiers never change owner.
 */
const graph = () => {
  const owner = new Map()
  const linked = new Map()
  const conflicts = []
  let persons = 0

  const alias = (browser, id) => {
    const mine = linked.get(browser)
    const owned = owner.get(id)

    if (owned === undefined) {
      const person = mine ?? `person_${++persons}`
      owner.set(id, person)
      linked.set(browser, person)
    } else if (mine === undefined) {
      linked.set(browser, owned)
    } else if (mine !== owned) {
      conflicts.push({ browser, id })
    }
  }

  return { alias, owner, linked, conflicts, persons: () => persons }
}

const customer = { id: "cus_01ABC", email: "shopper@example.com", first_name: "Ana" }

test("customerAliases sends the email before the customer id", () => {
  assert.deepEqual(m.customerAliases(customer), ["shopper@example.com", "cus_01ABC"])
  assert.deepEqual(m.customerAliases({ id: "cus_1", email: "" }), ["cus_1"])
  assert.deepEqual(m.customerAliases({ id: "cus_1", email: null }), ["cus_1"])
  assert.deepEqual(m.customerAliases(null), [])
})

test("guest purchase, then sign-in on another device, stays one person", () => {
  const g = graph()

  // Device A: guest checkout aliases only the order email.
  g.alias("device_a", customer.email)

  // Device B: the same shopper registers or signs in.
  for (const id of m.customerAliases(customer)) {
    g.alias("device_b", id)
  }

  assert.equal(g.persons(), 1)
  assert.deepEqual(g.conflicts, [])
  assert.equal(g.linked.get("device_b"), g.linked.get("device_a"))
  assert.equal(g.owner.get(customer.id), g.linked.get("device_a"))
})

test("the old order (customer id first) would have split the shopper", () => {
  // Guards the model itself: if this stopped failing the old way, the test above proves nothing.
  const g = graph()
  g.alias("device_a", customer.email)
  for (const id of [customer.id, customer.email]) {
    g.alias("device_b", id)
  }

  assert.equal(g.persons(), 2)
  assert.deepEqual(g.conflicts, [{ browser: "device_b", id: customer.email }])
})

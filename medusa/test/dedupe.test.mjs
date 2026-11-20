import { strict as assert } from "node:assert"
import { test } from "node:test"
import { SENT_CAP, purchaseAction, remember } from "../.test-build/dedupe.js"

/**
 * Memory shared by every tab of one browser. The bug these pin was seen on a live store: the same
 * Purchase sent again from a second tab.
 */

test("remember adds a key once and keeps the newest", () => {
  assert.deepEqual(remember([], "Purchase:order_1"), ["Purchase:order_1"])
  assert.deepEqual(remember(["a"], "a"), ["a"])

  const full = Array.from({ length: SENT_CAP }, (_, i) => `k${i}`)
  const next = remember(full, "new")
  assert.equal(next.length, SENT_CAP)
  assert.equal(next[next.length - 1], "new")
  assert.equal(next.includes("k0"), false)
})

test("remember never mutates what it was given, and survives junk from storage", () => {
  const list = ["a"]
  remember(list, "b")
  assert.deepEqual(list, ["a"])

  for (const junk of [null, undefined, "a", 42, { a: 1 }, [1, null, "x"]]) {
    assert.deepEqual(remember(junk, "k").at(-1), "k", String(junk))
  }
  assert.deepEqual(remember([1, null, "x"], "k"), ["x", "k"])
})

test("Purchase: the claim's winner always sends, even if a losing view already marked the order", () => {
  // Two views race: the loser's `false` can land first and mark the order in this browser.
  assert.equal(purchaseAction(true, true), "send")
  assert.equal(purchaseAction(true, false), "send")
})

test("Purchase: someone else claimed it, so this view never sends", () => {
  assert.equal(purchaseAction(false, false), "skip")
  assert.equal(purchaseAction(false, true), "skip")
})

test("Purchase: no claim answer (tag not ready, older backend, error) falls back to this browser's memory", () => {
  for (const first of [null, undefined]) {
    assert.equal(purchaseAction(first, false), "send")
    assert.equal(purchaseAction(first, true), "skip")
  }
})

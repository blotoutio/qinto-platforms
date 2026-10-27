import test from "node:test"
import assert from "node:assert/strict"

/**
 * Identify → alias ordering, including across the pre-runtime queue.
 *
 * An alias permanently links the browser to a person, and one that lands before its identify can
 * arrive as a conflict. So the order is the contract: identify first, each alias only after the
 * previous step resolved, and no alias at all when the identify failed.
 *
 * `client.ts` reads `window.qinto` on every call, so a fake runtime is installed on a fake `window`
 * before the module is imported. The module keeps its queue in module state, which is why these
 * tests run in sequence and each waits for the queue to drain.
 */

globalThis.window = {}
const client = await import("../.test-build/client.js")

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

/** A runtime that records calls, resolving each one only after a delay so ordering is observable. */
const fakeRuntime = ({ identifyFails = false } = {}) => {
  const calls = []
  const later = (value, fail = false) =>
    new Promise((resolve, reject) =>
      setTimeout(() => (fail ? reject(new Error("rejected")) : resolve(value)), 5)
    )

  return {
    calls,
    track: (name) => {
      calls.push(["track", name])
      return later({ eventId: "e" })
    },
    identify: (...args) => {
      calls.push(["identify", ...args])
      return later(undefined, identifyFails).then((v) => {
        calls.push(["identify:resolved"])
        return v
      })
    },
    alias: (id) => {
      calls.push(["alias", id])
      return later(undefined).then(() => calls.push(["alias:resolved", id]))
    },
    getAnonId: () => Promise.resolve(null),
  }
}

test("aliases follow the identify, one at a time, when the runtime is present", async () => {
  const q = fakeRuntime()
  window.qinto = q

  client.identify({ email: "ada@localhost.test" }, { alias: ["cus_1", "ada@localhost.test"] })
  await tick(50)

  assert.deepEqual(q.calls, [
    ["identify", { email: "ada@localhost.test" }],
    ["identify:resolved"],
    ["alias", "cus_1"],
    ["alias:resolved", "cus_1"],
    ["alias", "ada@localhost.test"],
    ["alias:resolved", "ada@localhost.test"],
  ])
})

test("the identify shorthand's second argument is never used", async () => {
  const q = fakeRuntime()
  window.qinto = q

  client.identify({ email: "ada@localhost.test" }, { alias: ["cus_1"] })
  await tick(30)

  const identifyCall = q.calls.find(([kind]) => kind === "identify")
  assert.equal(identifyCall.length, 2, "identify(traits) only, no id")
})

test("a queued identify keeps its aliases, and its order, until the runtime arrives", async () => {
  delete window.qinto

  client.track("PageView")
  client.identify({ email: "ada@localhost.test" }, { alias: ["ada@localhost.test"] })
  client.track("Purchase")

  const q = fakeRuntime()
  window.qinto = q
  // The queue polls every 100ms.
  await tick(250)

  assert.deepEqual(q.calls.filter(([kind]) => !kind.endsWith(":resolved")), [
    ["track", "PageView"],
    ["identify", { email: "ada@localhost.test" }],
    ["track", "Purchase"],
    ["alias", "ada@localhost.test"],
  ])
  const resolvedAt = q.calls.findIndex(([kind]) => kind === "identify:resolved")
  const aliasAt = q.calls.findIndex(([kind]) => kind === "alias")
  assert.ok(resolvedAt < aliasAt, "alias is sent only after identify resolved")
})

test("no alias is sent when the identify rejects", async () => {
  const q = fakeRuntime({ identifyFails: true })
  window.qinto = q

  client.identify({ email: "ada@localhost.test" }, { alias: ["cus_1"] })
  await tick(30)

  assert.deepEqual(q.calls, [["identify", { email: "ada@localhost.test" }]])
})

test("blank, missing and repeated aliases are dropped; empty traits send nothing", async () => {
  const q = fakeRuntime()
  window.qinto = q

  client.identify({ email: "a@b.test" }, { alias: ["", "  ", null, undefined, "a@b.test", "a@b.test"] })
  client.identify({}, { alias: ["cus_1"] })
  await tick(30)

  assert.deepEqual(
    q.calls.filter(([kind]) => kind === "alias"),
    [["alias", "a@b.test"]]
  )
  assert.equal(q.calls.filter(([kind]) => kind === "identify").length, 1)
})

test("nothing throws at the caller when the runtime throws or lacks alias", async () => {
  window.qinto = {
    identify: () => {
      throw new Error("boom")
    },
  }
  assert.doesNotThrow(() => client.identify({ email: "a@b.test" }, { alias: ["a@b.test"] }))

  window.qinto = { identify: () => Promise.resolve() }
  assert.doesNotThrow(() => client.identify({ email: "a@b.test" }, { alias: ["a@b.test"] }))
  await tick(10)
})

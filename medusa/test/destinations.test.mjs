import test from "node:test"
import assert from "node:assert/strict"
import { conflictsFor, pickDestination, rowPatch, storeState } from "../.test-build/destinations.js"

const AU = "https://au.dev.qinto.tech"
const NZ = "https://nz.dev.qinto.tech"
const row = (id, url, enabled = true) => ({ sales_channel_id: id, first_party_domain: url, enabled })

test("a key with no configured store sends nowhere", () => {
  assert.deepEqual(pickDestination(["sc_au"], []), {
    enabled: false,
    firstPartyDomain: null,
    salesChannelId: null,
    ambiguous: false,
  })
})

test("a store row without a URL sends nowhere, even when its switch is on", () => {
  const d = pickDestination(["sc_au"], [row("sc_au", null, true)])
  assert.equal(d.enabled, false)
  assert.equal(d.firstPartyDomain, null)
})

test("a store with a URL and the switch on sends to its own URL", () => {
  const d = pickDestination(["sc_nz"], [row("sc_au", AU), row("sc_nz", NZ)])
  assert.deepEqual(d, { enabled: true, firstPartyDomain: NZ, salesChannelId: "sc_nz", ambiguous: false })
})

test("a store with its switch off sends nothing but keeps which store decided", () => {
  const d = pickDestination(["sc_nz"], [row("sc_nz", NZ, false)])
  assert.deepEqual(d, { enabled: false, firstPartyDomain: null, salesChannelId: "sc_nz", ambiguous: false })
})

test("rows for other stores never leak into this key", () => {
  const d = pickDestination(["sc_us"], [row("sc_au", AU), row("sc_nz", NZ)])
  assert.equal(d.firstPartyDomain, null)
})

test("a key on several stores uses the configured store with the lowest id, whatever order Medusa returns", () => {
  const rows = [row("sc_au", AU), row("sc_nz", NZ)]
  assert.equal(pickDestination(["sc_nz", "sc_au"], rows).firstPartyDomain, AU)
  assert.equal(pickDestination(["sc_au", "sc_nz"], rows).firstPartyDomain, AU)
  assert.equal(pickDestination(["sc_x", "sc_nz", "sc_au"], rows).firstPartyDomain, AU)
  assert.equal(pickDestination(["sc_a_unset", "sc_nz"], [row("sc_a_unset", null), row("sc_nz", NZ)]).firstPartyDomain, NZ)
})

test("a key on several stores is ambiguous only when they disagree", () => {
  assert.equal(pickDestination(["a", "b"], [row("a", AU), row("b", NZ)]).ambiguous, true)
  assert.equal(pickDestination(["a", "b"], [row("a", AU), row("b", AU)]).ambiguous, false)
  assert.equal(pickDestination(["a", "b"], [row("a", AU), row("b", AU, false)]).ambiguous, true)
  assert.equal(pickDestination(["a", "b"], [row("a", AU), row("b", null)]).ambiguous, false)
})

test("storeState covers every badge the admin shows", () => {
  assert.equal(storeState(undefined, false), "nokey")
  assert.equal(storeState(row("a", AU), false), "nokey")
  assert.equal(storeState(undefined, true), "notset")
  assert.equal(storeState(row("a", null), true), "notset")
  assert.equal(storeState(row("a", AU, false), true), "off")
  assert.equal(storeState(row("a", AU, true), true), "sending")
})

test("conflictsFor names the key and the store it actually sends to", () => {
  const keys = [
    { title: "Shared key", salesChannelIds: ["sc_au", "sc_nz"] },
    { title: "NZ only", salesChannelIds: ["sc_nz"] },
  ]
  const rows = [row("sc_au", AU), row("sc_nz", NZ)]
  assert.deepEqual(conflictsFor("sc_nz", keys, rows), [
    { keyTitle: "Shared key", sendsToSalesChannelId: "sc_au" },
  ])
  assert.deepEqual(conflictsFor("sc_au", keys, rows), [
    { keyTitle: "Shared key", sendsToSalesChannelId: "sc_au" },
  ])
  assert.deepEqual(conflictsFor("sc_nz", keys, [row("sc_au", AU), row("sc_nz", AU)]), [])
})

test("saving a URL turns tracking on", () => {
  assert.deepEqual(rowPatch({ first_party_domain: AU }), { first_party_domain: AU, enabled: true })
})

test("clearing a URL leaves the switch alone", () => {
  assert.deepEqual(rowPatch({ first_party_domain: null }), { first_party_domain: null })
})

test("an explicit switch value wins over the save default", () => {
  assert.deepEqual(rowPatch({ first_party_domain: AU, enabled: false }), { first_party_domain: AU, enabled: false })
  assert.deepEqual(rowPatch({ enabled: false }), { enabled: false })
  assert.deepEqual(rowPatch({ enabled: true }), { enabled: true })
})

import test from "node:test"
import assert from "node:assert/strict"
import { firstPartyOriginOrNull } from "../.test-build/url.js"

test("a bare first-party domain is accepted, https is assumed", () => {
  assert.equal(firstPartyOriginOrNull("data.yourstore.com"), "https://data.yourstore.com")
  assert.equal(firstPartyOriginOrNull("  Data.YourStore.com/  "), "https://data.yourstore.com")
  assert.equal(firstPartyOriginOrNull("data.shop.com:8443"), "https://data.shop.com:8443")
})

test("an https origin is accepted and normalised", () => {
  assert.equal(firstPartyOriginOrNull("https://data.yourstore.com"), "https://data.yourstore.com")
  assert.equal(firstPartyOriginOrNull("  https://DATA.yourstore.com/  "), "https://data.yourstore.com")
  assert.equal(firstPartyOriginOrNull("https://data.yourstore.com//"), "https://data.yourstore.com")
  assert.equal(firstPartyOriginOrNull("https://data.shop.com:8443"), "https://data.shop.com:8443")
})

test("anything that is not exactly a domain is refused", () => {
  for (const bad of [
    "",
    "   ",
    "yourstore",
    "http://data.yourstore.com",
    "ftp://data.yourstore.com",
    "javascript:alert(1)",
    "https://user:pass@data.yourstore.com",
    "user:pass@data.yourstore.com",
    "data.yourstore.com/some/path",
    "https://data.yourstore.com/some/path",
    "https://data.yourstore.com/?x=1",
    "https://data.yourstore.com/#frag",
    "data.yourstore.com?x=1",
    `${"a".repeat(300)}.yourstore.com`,
  ]) {
    assert.equal(firstPartyOriginOrNull(bad), null, bad)
  }
})

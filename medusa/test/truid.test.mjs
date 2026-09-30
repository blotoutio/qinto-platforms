import { strict as assert } from "node:assert"
import { test } from "node:test"
import {
  TRUID_COOKIE,
  TRUID_MAX_AGE_SECONDS,
  cookieDomainFor,
  isSecureRequest,
  newTruid,
  registrableDomain,
} from "../.test-build/truid.js"

test("the cookie is named for the platform's existing convention", () => {
  // The edge already accepts `truid` as a tag's cookieMapKey, so renaming it would mean a
  // server-side change no other integration needs.
  assert.equal(TRUID_COOKIE, "truid")
})

test("lifetime is the browser's real maximum, not an unenforceable century", () => {
  assert.equal(TRUID_MAX_AGE_SECONDS, 400 * 24 * 60 * 60)
})

test("ids are v4 UUIDs and distinct", () => {
  const a = newTruid()
  const b = newTruid()

  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.notEqual(a, b)
})

test("every subdomain of the store shares one id", () => {
  // A shopper who lands on the apex, browses www and pays on checkout is one visitor, not three.
  assert.equal(cookieDomainFor("shop.com"), ".shop.com")
  assert.equal(cookieDomainFor("www.shop.com"), ".shop.com")
  assert.equal(cookieDomainFor("checkout.shop.com"), ".shop.com")
  assert.equal(cookieDomainFor("a.b.c.shop.com"), ".shop.com")
})

test("the scope survives the port the dev server appends to Host", () => {
  assert.equal(cookieDomainFor("shop.com:3000"), ".shop.com")
})

test("a country suffix widens to the name the merchant owns, not the suffix", () => {
  // `.co.uk` is a public suffix. A cookie scoped there is refused outright, which would leave the
  // visitor with no id at all, so this is worse than not widening.
  assert.equal(cookieDomainFor("shop.co.uk"), ".shop.co.uk")
  assert.equal(cookieDomainFor("www.shop.co.uk"), ".shop.co.uk")
  assert.equal(cookieDomainFor("shop.com.au"), ".shop.com.au")
  assert.equal(cookieDomainFor("checkout.shop.co.jp"), ".shop.co.jp")
})

test("a two-letter second label under a long TLD is still a real name", () => {
  // `co` is only a public suffix under a country TLD. `co.com` is registrable.
  assert.equal(cookieDomainFor("www.co.com"), ".co.com")
})

test("hosts that cannot carry a domain scope stay host-only", () => {
  assert.equal(cookieDomainFor("localhost"), undefined)
  assert.equal(cookieDomainFor("localhost:8000"), undefined)
  assert.equal(cookieDomainFor("store.localhost"), undefined)
  assert.equal(cookieDomainFor("127.0.0.1:8000"), undefined)
  assert.equal(cookieDomainFor("[::1]:8000"), undefined)
  assert.equal(cookieDomainFor("co.uk"), undefined)
  assert.equal(cookieDomainFor(null), undefined)
  assert.equal(cookieDomainFor(""), undefined)
})

test("an explicit override wins over the derivation", () => {
  // The suffix list is not the full Public Suffix List, so a merchant on something it does not
  // know needs a way out that does not involve forking the file.
  assert.equal(cookieDomainFor("shop.example.museum", ".shop.example.museum"), ".shop.example.museum")
  assert.equal(cookieDomainFor("www.shop.com", ".shop.com"), ".shop.com")
})

test("registrable domain is case-insensitive on the caller's behalf", () => {
  assert.equal(cookieDomainFor("WWW.Shop.COM"), ".shop.com")
})

test("registrableDomain reports null where no name is registrable", () => {
  assert.equal(registrableDomain("shop.com"), "shop.com")
  assert.equal(registrableDomain("co.uk"), null)
  assert.equal(registrableDomain("localhost"), null)
})

test("Secure is set on https and omitted on a local dev store", () => {
  // A Secure cookie is ignored over plain http, which would mean no id at all in development.
  assert.equal(isSecureRequest("https", "shop.com"), true)
  assert.equal(isSecureRequest("https,http", "shop.com"), true)
  assert.equal(isSecureRequest(null, "localhost:8000"), false)
  assert.equal(isSecureRequest(null, "127.0.0.1:8000"), false)
  assert.equal(isSecureRequest(null, "shop.com"), true)
})

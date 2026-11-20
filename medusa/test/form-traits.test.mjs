import { strict as assert } from "node:assert"
import { test } from "node:test"
import { IDENTITY_FIELDS, IDENTITY_NAMES, filledIdentity, traitsFrom } from "../.test-build/form-traits.js"

const reader = (values) => (name) => values[name]

test("the checkout address step yields every trait, not just the email", () => {
  // The exact field names the Medusa starter's shipping-address step uses. An earlier version read
  // only the bare names, so this form produced an email and nothing else.
  const traits = traitsFrom(
    reader({
      "email": "ada@localhost.test",
      "shipping_address.first_name": "Ada",
      "shipping_address.last_name": "Lovelace",
      "shipping_address.address_1": "12 Analytical Way",
      "shipping_address.city": "Aarhus",
      "shipping_address.province": "Midtjylland",
      "shipping_address.postal_code": "2200",
      "shipping_address.country_code": "dk",
      "shipping_address.phone": "+4533445566",
    })
  )

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
})

test("the register form still works through the bare names", () => {
  const traits = traitsFrom(
    reader({
      email: "ada@localhost.test",
      first_name: "Ada",
      last_name: "Lovelace",
      phone: "+4533445566",
    })
  )

  assert.deepEqual(traits, {
    email: "ada@localhost.test",
    first_name: "Ada",
    last_name: "Lovelace",
    phone: "+4533445566",
  })
})

test("a login form yields just the email", () => {
  assert.deepEqual(traitsFrom(reader({ email: "ada@localhost.test" })), {
    email: "ada@localhost.test",
  })
})

test("shipping wins over billing when a form carries both", () => {
  const traits = traitsFrom(
    reader({
      "shipping_address.city": "Aarhus",
      "billing_address.city": "Copenhagen",
    })
  )

  assert.equal(traits.city, "Aarhus")
})

test("billing is used when there is no shipping value", () => {
  assert.equal(traitsFrom(reader({ "billing_address.city": "Copenhagen" })).city, "Copenhagen")
})

test("nothing outside the allowlist is ever read", () => {
  // The guarantee that makes a document-level submit listener safe: a password or a card number in
  // the same form cannot be picked up, because the form is never enumerated.
  const traits = traitsFrom(
    reader({
      email: "ada@localhost.test",
      password: "hunter2",
      "shipping_address.company": "Analytical Engines Ltd",
      card_number: "4242424242424242",
      cvv: "123",
    })
  )

  assert.deepEqual(traits, { email: "ada@localhost.test" })
  assert.equal(Object.values(IDENTITY_FIELDS).flat().includes("password"), false)
  assert.equal(Object.values(IDENTITY_FIELDS).flat().includes("card_number"), false)
})

test("blank and whitespace-only values are dropped, and values are trimmed", () => {
  const traits = traitsFrom(
    reader({ email: "  ada@localhost.test  ", first_name: "   ", last_name: "" })
  )

  assert.deepEqual(traits, { email: "ada@localhost.test" })
})

test("trait keys are Qinto's standard names, spelled literally", () => {
  // `zip`, `firstName` and `lastName` are not standard keys: `zip` would land as a custom trait
  // rather than the postcode. `address` is the one intentional custom trait.
  assert.deepEqual(Object.keys(IDENTITY_FIELDS).sort(), [
    "address",
    "city",
    "country",
    "email",
    "first_name",
    "last_name",
    "phone",
    "postal_code",
    "state",
  ])
  assert.equal(
    traitsFrom(reader({ "shipping_address.postal_code": "2200" })).postal_code,
    "2200"
  )
})

test("filled checkout fields are sent without a form submit, typed values over saved ones", () => {
  const next = filledIdentity(
    { email: "old@localhost.test", state: "Canterbury Region", city: "Ashburton" },
    { email: "ada@localhost.test", phone: "+6421123456" },
    ""
  )

  assert.deepEqual(next?.traits, {
    email: "ada@localhost.test",
    state: "Canterbury Region",
    city: "Ashburton",
    phone: "+6421123456",
  })
})

test("nothing is sent until there is an email or a phone", () => {
  assert.equal(filledIdentity({ city: "Ashburton" }, { first_name: "Ada" }, ""), null)
  assert.equal(filledIdentity({}, { email: "ada@" }, ""), null)
  assert.notEqual(filledIdentity({}, { phone: "+6421123456" }, ""), null)
})

test("the same details are not sent twice, a change is", () => {
  const first = filledIdentity({}, { email: "ada@localhost.test" }, "")
  assert.equal(filledIdentity({}, { email: "ada@localhost.test" }, first.key), null)
  assert.notEqual(filledIdentity({}, { email: "ada@localhost.test", phone: "+6421123456" }, first.key), null)
})

test("the key holds no personal data", () => {
  const { key } = filledIdentity({}, { email: "ada@localhost.test" }, "")
  assert.ok(!key.includes("ada"))
})

test("every allowlisted field name is recognised, nothing else", () => {
  assert.ok(IDENTITY_NAMES.has("shipping_address.phone"))
  assert.ok(IDENTITY_NAMES.has("email"))
  assert.ok(!IDENTITY_NAMES.has("password"))
})

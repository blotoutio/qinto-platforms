import { strict as assert } from "node:assert"
import { test } from "node:test"
import { IDENTITY_FIELDS, traitsFrom } from "../.test-build/form-traits.js"

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
    firstName: "Ada",
    lastName: "Lovelace",
    phone: "+4533445566",
    address: "12 Analytical Way",
    city: "Aarhus",
    state: "Midtjylland",
    zip: "2200",
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
    firstName: "Ada",
    lastName: "Lovelace",
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

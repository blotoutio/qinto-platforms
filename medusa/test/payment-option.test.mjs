import { strict as assert } from "node:assert"
import { test } from "node:test"
import { paymentOptionOfFrame, paymentOptionOfLabel } from "../.test-build/payment-option.js"

/**
 * AddPaymentInfo is read from what the shopper clicks, so what counts as a payment control is the
 * whole rule. A missed option loses one event; a wrong match reports a payment nobody chose.
 */

test("the labels seen on a real checkout are recognised", () => {
  assert.equal(paymentOptionOfLabel("Card"), "card")
  assert.equal(paymentOptionOfLabel("PayPal"), "paypal")
  assert.equal(paymentOptionOfLabel("  Credit card "), "card")
  assert.equal(paymentOptionOfLabel("Credit / Debit Card"), "card")
  assert.equal(paymentOptionOfLabel("Pay with PayPal"), "paypal")
  assert.equal(paymentOptionOfLabel("Apple Pay"), "apple_pay")
  assert.equal(paymentOptionOfLabel("Buy with Pay"), "apple_pay")
  assert.equal(paymentOptionOfLabel("Buy with GPay"), "google_pay")
  assert.equal(paymentOptionOfLabel("Google Pay"), "google_pay")
  assert.equal(paymentOptionOfLabel("Afterpay"), "afterpay")
  assert.equal(paymentOptionOfLabel("Debit card"), "card")
  assert.equal(paymentOptionOfLabel("iDeal"), "ideal")
  assert.equal(paymentOptionOfLabel("Manual Payment"), "manual")
})

test("controls that are not a payment choice are refused", () => {
  assert.equal(paymentOptionOfLabel("Shipping (Free)"), null)
  assert.equal(paymentOptionOfLabel("Continue to payment"), null)
  assert.equal(paymentOptionOfLabel("Pay Securely Now"), null)
  assert.equal(paymentOptionOfLabel("Apply gift card"), null)
  assert.equal(paymentOptionOfLabel("Gift card"), null)
  assert.equal(paymentOptionOfLabel("Card number"), null)
  // Managing a saved method is not choosing one.
  assert.equal(paymentOptionOfLabel("Remove credit card"), null)
  assert.equal(paymentOptionOfLabel("Edit PayPal"), null)
  assert.equal(paymentOptionOfLabel("Add new card"), null)
  assert.equal(paymentOptionOfLabel("Store credit"), null)
  assert.equal(paymentOptionOfLabel(""), null)
  assert.equal(paymentOptionOfLabel(null), null)
  assert.equal(paymentOptionOfLabel(undefined), null)
})

test("a sentence that mentions a payment method is not a control", () => {
  assert.equal(
    paymentOptionOfLabel("You will be securely redirected to the PayPal website to complete your order"),
    null
  )
})

test("a payment provider's frame is recognised by host, PayPal's also by name", () => {
  assert.equal(
    paymentOptionOfFrame("https://assets.braintreegateway.com/web/3.136.0/html/hosted-fields-frame.min.html#x", "braintree-hosted-field-number"),
    "card"
  )
  assert.equal(paymentOptionOfFrame("https://js.stripe.com/v3/elements-inner-card.html", ""), "card")
  assert.equal(paymentOptionOfFrame("https://www.paypal.com/smart/buttons", ""), "paypal")
  // PayPal's button frame carries no src at all.
  assert.equal(paymentOptionOfFrame("", "__zoid__paypal_buttons__abc"), "paypal")
})

test("any other frame is not a payment", () => {
  assert.equal(paymentOptionOfFrame("https://www.youtube.com/embed/x", "player"), null)
  assert.equal(paymentOptionOfFrame("https://notbraintreegateway.com/x", ""), null)
  assert.equal(paymentOptionOfFrame("not a url", ""), null)
  assert.equal(paymentOptionOfFrame("", ""), null)
})

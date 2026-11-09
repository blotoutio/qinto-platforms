/** Recognising the payment method a shopper clicked: the cart often never learns of it. */

/** Words that mention a payment method without choosing one. */
const NOT_A_CHOICE =
  /\b(gift|coupon|discount|promo|voucher|credit|remove|delete|edit|change|update|manage|add|new|saved?|number)\b/

const LABELS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bpaypal\b/, "paypal"],
  // "Buy with Pay" is an Apple Pay button whose logo is an image.
  [/\bapple pay\b|^buy with pay$/, "apple_pay"],
  [/\b(google pay|gpay)\b/, "google_pay"],
  [/\b(afterpay|clearpay)\b/, "afterpay"],
  [/\bklarna\b/, "klarna"],
  [/\bideal\b/, "ideal"],
  [/\bbancontact\b/, "bancontact"],
  [/\bbank transfer\b/, "bank_transfer"],
  [/\bmanual payment\b/, "manual"],
  [/\bcard\b/, "card"],
]

/** Hosts that only ever serve a card form. */
const CARD_FRAMES = /^https:\/\/([^/]*\.)?(braintreegateway|js\.stripe|adyen|checkout|squarecdn|squareup)\.com\//

/** The payment option a clicked control's label names, or `null`. Long text is a sentence, not a control. */
export const paymentOptionOfLabel = (label: string | null | undefined): string | null => {
  const text = (label ?? "").toLowerCase().replace(/\s+/g, " ").trim().replace(/^(credit|debit)\b/, "")
  if (text.length > 40 || NOT_A_CHOICE.test(text)) {
    return null
  }

  return LABELS.find(([pattern]) => pattern.test(text))?.[1] ?? null
}

/** The payment option a focused provider frame stands for, or `null`. PayPal's frame has no `src`. */
export const paymentOptionOfFrame = (src: string, name: string): string | null => {
  if (/paypal/i.test(name) || /^https:\/\/([^/]*\.)?paypal\.com\//.test(src)) {
    return "paypal"
  }

  return CARD_FRAMES.test(src) ? "card" : null
}

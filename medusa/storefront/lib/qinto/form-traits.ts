import { compact, type Traits } from "./mapping"

/**
 * Identity traits from a submitted form.
 *
 * Pure, and separated from the component for the reason this module exists at all: the first
 * version listed only the bare field names — `email`, `first_name`, `last_name`, `phone` — which
 * are what the *register* form uses. The checkout prefixes everything with `shipping_address.`, so
 * the highest-intent form in the funnel gave up an email address and nothing else while eight other
 * traits sat unread in the same submission. Nothing failed; the payload was just thin.
 *
 * It takes a reader rather than a `FormData` so the rules can be tested without a DOM.
 */

/**
 * Every field name that may be read, and the trait each feeds. **This is the allowlist.**
 *
 * The form is never enumerated, so a password, a card number or a token sitting in the same
 * submission cannot be picked up by accident — widening what is collected means editing this table,
 * which is the point. Candidates are tried in order and the first non-empty one wins, so a shipping
 * address beats a billing address when a form carries both.
 */
export const IDENTITY_FIELDS: Record<keyof Traits, readonly string[]> = {
  email: ["email", "shipping_address.email", "billing_address.email"],
  first_name: ["first_name", "shipping_address.first_name", "billing_address.first_name"],
  last_name: ["last_name", "shipping_address.last_name", "billing_address.last_name"],
  phone: ["phone", "shipping_address.phone", "billing_address.phone"],
  // A custom trait, not a standard key — see `Traits` in ./mapping.
  address: ["shipping_address.address_1", "billing_address.address_1", "address_1"],
  city: ["shipping_address.city", "billing_address.city", "city"],
  state: ["shipping_address.province", "billing_address.province", "province"],
  postal_code: ["shipping_address.postal_code", "billing_address.postal_code", "postal_code"],
  country: ["shipping_address.country_code", "billing_address.country_code", "country_code"],
}

export const traitsFrom = (read: (name: string) => string | undefined): Traits => {
  const pick = (names: readonly string[]): string | undefined => {
    for (const name of names) {
      const value = read(name)
      if (value !== undefined && value.trim() !== "") {
        return value.trim()
      }
    }

    return undefined
  }

  return compact(
    Object.fromEntries(
      Object.entries(IDENTITY_FIELDS).map(([trait, names]) => [trait, pick(names)])
    ) as Traits
  )
}

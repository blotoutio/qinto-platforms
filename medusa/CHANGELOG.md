# Changelog

## 0.1.4

- `AddShippingInfo` no longer fires when a storefront pre-selects a default shipping option. It
  fires inside checkout once the cart has both a delivery address and a shipping option, and again
  when the shopper switches option.
- `AddPaymentInfo` no longer fires when a checkout creates its payment session on load. It fires
  inside checkout when the shopper clicks a payment option or clicks into a provider's card form,
  and again when they switch.
- `InitiateCheckout` is always sent before either of them.
- The cart read no longer asks Medusa for payment sessions.

## 0.1.0

First release.

- Admin page under Blotout for pasting the site's Qinto URL, with a tracking on/off switch.
- Storefront capture for `PageView`, `ViewContent`, `AddToCart`, `RemoveFromCart`,
  `InitiateCheckout`, `AddShippingInfo`, `AddPaymentInfo`, `Purchase` and `CompleteRegistration`,
  derived from route changes and cart state so no product, cart or checkout component is touched.
- Configurable route matching: `ViewContent`, `InitiateCheckout` and `Purchase` are recognised from
  the path, and a storefront that does not use the Medusa starter's shapes passes `routes` to the
  component as a pattern per event or a function. The other six events never read the path.
- Traits identified from the cart, the completed order, the signed-in customer and the checkout
  address form.
- First-party `truid` cookie issued from the storefront's own server, httpOnly and SameSite=Lax,
  with a 400 day lifetime.
- One table, `qinto_connection`, holding the Qinto URL and the tracking flag. No credentials and no
  shopper data.

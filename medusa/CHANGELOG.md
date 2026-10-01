# Changelog

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

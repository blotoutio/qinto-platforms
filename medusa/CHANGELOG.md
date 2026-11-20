# Changelog

## 0.2.0

**Breaking: enter each store's first-party domain after upgrading.** The single store-wide URL is
gone. After `medusa db:migrate`, every store sends nothing until its first-party domain is entered
in Admin → Blotout.

- One first-party domain and one Tracking switch per sales channel, so a backend running several
  storefronts sends each one to its own site. The storefront is recognised by its publishable API
  key; no storefront code changes are needed beyond updating the package.
- New Blotout page: a single setup card for one storefront, and a table with an edit drawer for
  several. Sales channels that have no publishable key yet are listed too, with what to do.
- Turning tracking off now asks for confirmation, naming the store and the domain it stops sending
  to.
- Saving a store's first-party domain turns its tracking on. Clearing it stops that store.
- A publishable key linked to several sales channels uses the one with the lowest id that has a
  domain, so the choice is stable, and the page flags the shared key.
- The Admin field is now **First-party domain**. It takes the domain as the Blotout Platform shows
  it (`data.yourstore.com`) or as an https origin; `http://`, paths, queries and credentials are
  refused, and it is stored as a normalised https origin in `first_party_domain`.
- `/store/qinto/config` is now cached privately and varies by publishable key, so a CDN cannot hand
  one store's destination to another.
- Renamed `qinto_url` to `first_party_domain` in `GET /store/qinto/config` and the admin routes.
  Update the storefront and the backend together: a 0.1.x storefront reads `qinto_url` and sends
  nothing against a 0.2.0 backend.
- Removed: the storefront's `NEXT_PUBLIC_QINTO_URL`. It pinned the destination at build time and
  bypassed Admin, including the Tracking switch. Delete it from the storefront's environment; the
  storefront now always asks the backend.
- Removed: the `QINTO_URL` environment variable, the `qintoUrl` plugin option,
  `GET /admin/qinto` and `POST /admin/qinto/settings`. Replaced by `GET /admin/qinto/channels`
  and `POST /admin/qinto/channels/:id`.
- New migration, `Migration20261117120000`: creates `qinto_channel_connection` and
  `qinto_purchase_claim` (one row per order), and drops the 0.1.x `qinto_connection` table. The
  0.1.x migration is unchanged.
- Blotout mark on the page and in the sidebar, and a link to docs.blotout.io in the page header.
- The checkout identifies the shopper as soon as an email or phone is filled in, without a submit.
  Checkouts with no `<form>`, or that pay from a button, sent no traits until the order was placed,
  so a shopper who left before paying was never identified. Visible fields and the saved cart are
  both read, so an address picked from a search box is included once the storefront saves it.
  Traits only, and unchanged details are not resent.
- **Purchase is sent once per order**, whichever tab, browser or device shows the confirmation page.
  The once-only memory was per tab (`sessionStorage`), so a new tab, a restart or another device
  sent it again. It is now kept in `localStorage`, and the page's existing order read also claims
  the order (`POST /store/qinto/orders/:id/claim`, called by the storefront's context route), so
  this adds no request. Only orders of the same storefront placed in the last 24 hours can be
  claimed, so orders from before the upgrade are not re-sent. The claim waits for the tag to connect
  (a tag slower than 10 seconds sends first and claims when it connects); with no answer from the
  backend, the browser's own memory decides.
- **Checkout steps once per page.** AddShippingInfo and AddPaymentInfo were re-sent on every change
  of choice (Card, then PayPal, then Card was three AddPaymentInfo). Each is now sent once per cart
  on a page; a reload or a new tab can send it again. InitiateCheckout is now also sent when the
  checkout page is reloaded, as on Shopify; moving between its steps still is not a new one.
- A cart change made in one tab is no longer reported again as AddToCart or RemoveFromCart by
  another tab: the cart snapshot is now kept in `localStorage` too. Where storage is blocked, the
  once-only memory lasts for the life of the page instead of being lost on every navigation.

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

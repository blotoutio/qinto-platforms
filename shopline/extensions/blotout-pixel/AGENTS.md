# extensions/blotout-pixel — the SHOPLINE Pixel extension

Runs on every storefront page, in a strict sandbox, auto-activated on app install.

## There is no DOM

No `document`, no `window`, no synchronous `localStorage`. The tsconfig uses `lib: ["WebWorker"]`
rather than `DOM` precisely so reaching for one is a compile error instead of a runtime one. Don't
change that to make an import typecheck.

Storage and cookies are `api.browser.*`, and every one of them is async and can reject.

## The wire is `@blotout/qinto-sdk-browser`, run in a worker

A SHOPLINE app pixel runs in a plain Web Worker (`wpm` starts it with `new Worker(blob)`): no
`window`, no `document`. The SDK refuses to start without a `document`, so `worker-shims.ts` gives
it the two globals it needs, `window = self` and a stub `document` with an empty `cookie`. That set
was measured by running the SDK inside SHOPLINE's own unmodified `wpm`/`wpt` code, not reasoned out.

Use the SDK, don't speak the protocol by hand. The edge validates every browser frame with a strict
schema; a hand-built client kept sending `context` after the edge moved to `observed` (Qinto
`8c45fc25`, 26 Oct) and every frame was refused without a sound. The SDK owns the `/open` URL, the
frame shape, event ids, ordering and reconnects, so a protocol change reaches us as an upgrade.

- **Pinned to an exact version.** The shims depend on what the SDK touches, which is not a public
  contract. Before an upgrade, run the bundle in the worker sandbox and check it still connects:
  `configure.test.ts` covers the wire but runs in Node, not in a worker.
- **Browser apps stay off.** `q.js` cannot load in a worker; the SDK logs
  `document.createElement is not a function` once per page and carries on. App capture (`_fbp`,
  `fbclid`, …) is driven by that config, so it never runs here either.
- **The visitor is carried by hand.** The edge's cookie may not reach a worker's socket, so
  `visitor.ts` keeps what `qinto:connect` reported in localStorage and hands it back as
  `pageContext.visitor` (`uid` and `session` on `/open`), the documented route for sandboxed pages.
  A visit idle for 30 minutes is dropped, because the edge would otherwise continue it.
- **A first connect that fails is final for that page.** The SDK rejects every call after it; the
  next page tries again.

## The `enabled` setting is the first thing `configure()` checks

A disabled store opens no WebSocket, subscribes to no event, and reads no cookie or storage. That
ordering is the kill switch; anything moved above it defeats it.

## Settings arrive as strings

`enabled` is `'true'`, never `true`.

## `api.settings` is read once per page load

Config is not live. A change lands on the visitor's next navigation, and the app's UI says so.

## Never gate on consent

Read the consent state, hand it to `blotout.consent()`, and let the SDK and the edge decide. Mapping
SHOPLINE's state onto Blotout's categories is not gating. When no consent state can be found, send
nothing — an invented `false` reads as a refusal and the edge will act on it.

## Never throw at a SHOPLINE event handler

A tracking failure is not the storefront's problem. Every SDK promise is caught and reported
through `onError`. Nothing propagates out of a subscription callback.

## The mapping, and the standard eleven only

Adding or remapping an event is a decision to raise, not a guess to make. Every payload below is
what SHOPLINE's own `PixelEvents` types actually carry — verified against the frames
a live storefront sends, not against a spec.

| SHOPLINE event | Blotout event | Properties sent |
|---|---|---|
| `page_viewed` | `PageView` | `title`, `path` (the URL rides in the frame's `observed.page`) |
| `product_viewed` | `ViewContent` | `currency`, `value`, `contents[1]` |
| `product_added_to_cart` | `AddToCart` | `currency`, `value`, `contents` |
| `product_removed_from_cart` | `RemoveFromCart` | `currency`, `value`, `contents` |
| `checkout_started` | `InitiateCheckout` | `currency`, `value`, `contents` |
| `payment_info_submitted` | `AddPaymentInfo` | `currency`, `value`, `contents` |
| `checkout_completed` | `Purchase` | `currency`, `value`, `orderId` (= `eventId`), `contents`, `taxCost`, `shippingCost`, `discounts` (`[{ code }]` from `coupon`), `grossValue` (Σ line `value` × `quantity`) |
| `search_submitted` | `Search` | `search` |
| `lead` | `Lead` | `currency`, `value` (summed from the lines), `name` and `category` (flat, from the first line) |

Each line in `contents` is the standard events docs' `Content`: `id` ← `spuId`, `variantId` ←
`skuId`, `sku` ← `skuItemNo`, **`value`** ← `price` (one unit, not the line total), plus `title` and
`category`. The docs say outright that `Content.item_price` is `Content.value`. A field the docs do
not define is not sent; a destination that cannot find its field omits it in silence — `price`,
`tax` and `shipping` were all being dropped that way once. Check
https://docs.blotout.io/implementation/standard-events/ before renaming anything here.

Trait keys are snake_case (`first_name`, `last_name`, `postal_code`), the user data docs' own
spelling, and the SHOPLINE customer id goes out as the custom trait `customer_id`.

No event carries a checkout URL and none carries a discount amount or type — `coupon` is a bare code,
so `discounts` carries `code` alone.

`cart_viewed`, `collection_viewed`, `search_view_results`, `login` and `registration_completed` are
deliberately unsubscribed: sending them under an invented name would pollute a merchant's event
list. `checkout_contact_info_submitted` is subscribed as an identity source and is never sent as an
event. Both it and `payment_info_submitted` fire **late** in the one-page checkout, seconds before
the order completes, so a short look at the checkout page will miss them and conclude they never
fire. `Purchase` takes its identity from `checkout_completed.userInfo` regardless, so the conversion
carries identity even when the contact step is missed.

## `checkout_completed` carries more than `PixelEvents` declares

`userInfo` (email, phone, name, address), a `checkout` object with `subtotal_price`, `gateway` and
discount codes, and a **numeric** `customer_id`. None of it is in SHOPLINE's types. `types.ts`
widens the payload for the parts we read; treat the declaration as a floor, not a contract, and
verify against a real order before relying on a field.

`AddShippingInfo` and `Subscribe` have no SHOPLINE source at all. That is documented, not a gap to
fill.

`Search` is subscribed to `search_submitted`. On `srini-test.myshopline.com` (2 Nov 2026) it fires
when a shopper submits a full search ("Search for …"), not from the predictive dropdown, and carries
only the keyword: no currency or result list.

## Identity goes out once per session, not once per event

A signed-in visitor carries the same `login_em` and `customer_id` on every event, so identity used to
ride all of them. `identity.ts` sends the first one and then only when a trait is **new or changed**,
so the checkout's richer set (phone, name, address) and the order's `userInfo` still get through
while the plain repeats do not.

The comparison is per trait, not per object. Do not change it to whole-object equality: the
thank-you page publishes `checkout_completed` before `page_viewed`, so a poorer `{email, customer_id}`
follows the order's full identity and must be dropped, not sent as a "different" object.

What has been sent lives in the storefront's `sessionStorage` under
`blotout_shopline_identity`, stamped with the session id. A session that ages out re-asserts
identity rather than inheriting a stale claim. Read at startup **in parallel with the session** —
`Promise.all` in `index.ts` — because subscribing is already behind one await and must not go behind
two.

The trade, deliberately taken: a frame lost between the sandbox and the edge is not re-sent for the
rest of that session.

## SHOPLINE republishes the two view events when nothing has been viewed

The quantity stepper on a product page republishes `product_viewed` with the identical variant —
only while that product is already in the cart, which is what makes it look intermittent — and
a variant swatch republishes `page_viewed` after rewriting the URL to `?sku=<id>`. `subscribeAll`
gates both, dropping only an immediately repeated identity — S → M → S is two genuine views of S.

`PageView` is keyed on the title and the path with `sku` removed. Do not widen that to ignoring the
whole query: `/search?keyword=…` and `?page=2` are real navigations. Do not narrow the sent `path`
either — the event carries what SHOPLINE served, and only the comparison ignores the parameter.

The gate is a closure per `subscribeAll` call, and `subscribeAll` runs once per page load, so a
reload always reports. Nothing about it is persisted.

Do not extend that gate to the cart events. A repeated `AddToCart` of the same line is a shopper
adding it twice, which is a fact, and cart events already carry the **delta** rather than the new
total.

## `Purchase` carries `orderSeq` as both `orderId` and `eventId`

Blotout deduplicates conversions on it, so a replayed checkout must produce the same id. `event.id`
would not — it changes per delivery.

## The shipping toolchain is `sl`, not `shopline`

`shopline app dev` knows nothing about extensions — it discovers only `shopline.app.toml` and
`shopline.web.toml`. App extensions are `@shoplineos/cli`, installed here as a root devDependency
and invoked as `sl`:

```bash
sl login                                    # a partner login; interactive
cp .env.prod.example .env.prod              # then fill in SHOPLINE_APP_SECRET
pnpm --filter blotout-pixel build             # sl runs this itself, but check it first
cd extensions/blotout-pixel && sl extension push
```

The push registers the extension against the app on first run and writes `EXTENSION_ID` and
`EXTENSION_UUID` back into `.env.prod`, then prints a Partner Portal link. **The store only gets its
pixel record once a version is published there** — until then `pixel/update_config.json` answers
`500 record not found` and the app reports it.

## Three things here exist only because the CLI demands them

Change any of them and the push stops working, with an error that names none of this:

- **`shopline.pixels.extension.toml`** — the filename is matched literally, and the `type` inside it
  must read `shopline-pixels-extension`. Neither is the name the docs use in prose.
- **`locales/en.default.json`** — the push validates that a `*.default.json` locale exists before it
  will build.
- **`build/index.js`** — the zip takes exactly `locales/**/*.json`, `build/**/*.js` and the toml.
  Anything the bundle does not inline is simply absent at runtime, which is why `build` bundles.

## This code runs on every storefront page

Keep the bundle small. Add no dependency without a reason; there are none today.

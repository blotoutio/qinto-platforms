# @blotout/platform-medusa

**By [Blotout](https://blotout.io).** Connects your Medusa store to the **Blotout Platform**,
Blotout's first-party analytics and identity platform, and sends your storefront and order events
there from your own first-party domain, without an ad blocker in the way.

The package is `@blotout/platform-medusa`. In Medusa Admin it appears as **Blotout**; its runtime in
the browser is Qinto (`q.js` and `window.qinto`), which is the name the code and routes use.

Install it, paste your first-party domain in the Medusa admin, mount one component in your storefront.

One line in `medusa-config.ts`, and everything a merchant chooses — destination, on/off — is set in
the admin and stored in your database, so changing it needs no redeploy.

---

## What you get

| Event | When |
|---|---|
| `PageView` | every navigation |
| `ViewContent` | a product page |
| `AddToCart` / `RemoveFromCart` | cart changes |
| `InitiateCheckout` | every arrival at checkout and every reload of it, not each step change |
| `AddShippingInfo` / `AddPaymentInfo` | checkout steps, once per cart on a page; a reload can send them again |
| `Purchase` | order confirmation page, once per order on any tab, browser or device |
| `CompleteRegistration` | account created |

Identity (email, name, city, country, postcode, address) attaches to the shopper's profile at
checkout and on the order.

**Every event is sent from the browser**, including `Purchase`, which is keyed on the order id so a
refreshed confirmation page still counts once. Nothing is sent from your server, and your server
holds no Blotout credential — there is no column for one.

---

## 1. Install

```bash
npm install @blotout/platform-medusa
```

Add it to `medusa-config.ts`:

```ts
module.exports = defineConfig({
  // …
  plugins: ["@blotout/platform-medusa"],
})
```

That is the whole configuration. Everything else — the destination, on/off — is
set in **Admin → Blotout** and stored in your database.

> **There is no OAuth, no client secret, and no credential of any kind.** The one thing this plugin
> needs is your site's first-party domain (for example `data.yourstore.com`), which is public — it is
> already visible in the page source of any storefront that loads the collector from it. You copy it
> from the Blotout Platform and paste it in the admin. The plugin's schema holds, per sales
> channel, `first_party_domain` (stored as an https origin) and `enabled`, and no column for a
> token because nothing here ever holds one.

Run the migration and start:

```bash
npx medusa db:migrate
npm run dev
```

In production, rebuild so the admin page is bundled — `npm run dev` picks it up automatically, a
built admin does not:

```bash
npx medusa build && npx medusa start
```

> **No environment variables are required.** Nothing calls back into the store, so a backend the
> internet cannot reach (a local dev store, a private network) configures like any other.

---

## 2. Connect, in the admin

The plugin appears as **Blotout** in the sidebar. Every storefront is configured on its own: a
storefront is recognised by its publishable API key, and each key belongs to a sales channel.

**One storefront** (most stores). The page is a single card:

1. Paste your **First-party domain** and press Save. Find it in the Blotout Platform on your
   site's page. Paste it as shown (`data.yourstore.com`); `https://` is optional.
2. Saving a domain turns **Tracking** on, so the store sends straight away. Turning it off asks
   you to confirm, and keeps the domain so you can resume without re-entering it.
3. The badge reads **Sending** when it is ready.

**Several storefronts on one backend.** Give each storefront its own sales channel and publishable
key (the usual Medusa setup), and its own site in the Blotout Platform. The page then lists every
sales channel: switch tracking from the row, and click **Edit** to paste that store's first-party domain. A store
without a domain sends nothing; there is no store-wide default.

If one publishable key is linked to several sales channels with different settings, its storefront
uses the one with the lowest sales channel id that has a domain, and the page flags the shared key
so you can give each storefront its own key.

Everything is stored in your database, so changing destination or turning tracking off needs no
redeploy.
A storefront picks the change up on its next page load; tabs already open keep the previous setting
until then, and the config response is cached privately for 60 seconds.

---

## 3. Storefront

The backend half is done. Your storefront still has to say *when* a shopper viewed a product or
added to cart, because only it knows — but it works that out for itself.

Install the same package in your storefront and import from it — nothing is copied, so plugin
updates reach the capture logic through `npm update` like any other dependency. From your
storefront's root:

```bash
npm install @blotout/platform-medusa
```

Let Next compile the package's TypeScript, in `next.config.js`:

```js
const nextConfig = {
  transpilePackages: ["@blotout/platform-medusa"],
  // ...the rest of your config
}
```

Mount one component in `src/app/layout.tsx`:

```tsx
import QintoAutoCapture from "@blotout/platform-medusa/storefront/autocapture"

<body>
  <QintoAutoCapture />
  <main className="relative">{props.children}</main>
</body>
```

And add one three-line file, `src/app/api/qinto/context/route.ts`:

```ts
export { GET } from "@blotout/platform-medusa/storefront/context-route"
```

That one file has to exist for real. Next finds route handlers by scanning your filesystem, so a
route sitting in `node_modules` is invisible to the router — but what it *does* still lives in the
package and updates with it.

**That is two edits to files you already had, plus one three-line file**, and the last of it you
will ever write for this plugin. New events ship in a package update; nothing in your product, cart
or checkout code is touched, so restyling them cannot break tracking.

It reads the store's first-party domain from `GET /store/qinto/config`, so there is **no
environment variable to set**.

### How it captures without touching your pages

Three signals, none of which needs a call site:

- **Route changes** give `PageView` directly, and say when a shopper is on a product page, the
  checkout, or an order confirmation.
- **`/api/qinto/context`** — the route handler you copied — runs on your storefront's own server,
  where the `httpOnly` `_medusa_cart_id` cookie *is* readable, and hands the browser the cart,
  product or order. The browser cannot read that cookie, which is why this file exists.
- **A `PerformanceObserver`** notices when a Server Action completes. Every cart mutation in a
  Medusa storefront is one, so the component re-reads the cart and compares it to the previous
  state. The difference *is* the event: a line going 1 → 3 is `AddToCart` of 2.
- **A `submit` listener on `document`** picks up identity from any form a shopper sends —
  register, login, and each of the profile forms — without those components being touched. A
  signed-in shopper is also identified from the session on page load, which covers a returning
  visit where no form is ever submitted. Only verified identities are *aliased* (linked to a
  person profile): the signed-in customer's id and email, and the email on a placed order. A form
  submission sends traits only, because the submit may still fail and an alias is permanent.
- **A `change` listener on `document`** identifies the shopper on the checkout once an email or
  phone is filled in, whether or not the fields sit in a `<form>`. It merges the visible fields with
  the cart as last read (an address picked from a search box only exists there), so a field edit
  makes no request of its own, waits until the shopper stops editing, and sends traits only when
  they differ from the last ones sent.

### The visitor cookie

The context route also issues **`truid`** — a first-party visitor id, the same mechanism the
WooCommerce, Magento and Salesforce integrations use, under the same name.

| | |
|---|---|
| Value | UUID v4, minted once and never replaced |
| Lifetime | 400 days — the real browser maximum, not the century a cookie can ask for |
| Flags | `HttpOnly`, `SameSite=Lax`, `Secure` on https |
| Scope | widened to the domain shared with your first-party domain when there is one, host-only otherwise |

It exists because the collector's own anonymous id is set by the *collector*, which makes it third-party
until your DNS setup puts the collector on your domain. `truid` is set by your storefront's own
server, so it is first-party from the first request and stable across page loads either way.

`SameSite=Lax` rather than `Strict` on purpose: the starter's cart and auth cookies are `Lax` so they
survive the cross-site return from a redirect-based payment method, and a visitor id that did not
would be lost at exactly the moment a conversion is attributed.

> **The scope is only widened when your storefront actually sits under that domain.** A browser
> discards a cookie scoped to a domain the response did not come from, so a store at `shop.com`
> reporting to a Blotout development host (`xyz.dev.qinto.tech`) gets a host-only cookie rather
> than none at all.

> **An explicit allowlist decides what is read** — the nine identity traits, each with the field
> names that feed it, including the `shipping_address.*` names the checkout uses. The form is never
> enumerated and no other input is inspected, so a password or a card number in the same submission
> cannot be picked up by accident. Widening what is collected means editing
> `lib/qinto/form-traits.ts`, which is deliberate.

Deriving beats declaring in two ways beyond the edit count: `value` and `currency` come from the
authoritative cart rather than a recomputed variant price, and an event only fires for a mutation
that actually succeeded.

> Patching `window.fetch` looks like the obvious way to catch those Server Actions. It does not
> work — Next captures its own `fetch` reference while the framework boots, long before a component
> effect can replace the global, so the patch silently never fires. `PerformanceObserver` has no
> such ordering problem.

Route matching defaults to the Medusa Next.js starter's shapes, so `/[countryCode]/products/[handle]`,
`/[countryCode]/checkout` and `/[countryCode]/order/[id]/confirmed`. A storefront that moved them
passes `routes` to the component, as a pattern per event or a function where a pattern will not
reach. The rules live in `lib/qinto/routes.ts`, pure and unit-tested, and MERCHANT-SETUP.md has the
reference. Only `ViewContent`, `InitiateCheckout` and `Purchase` read the path at all, the other six
come from cart and customer state and never need configuring.

---

## Notes worth reading before you debug

- **Cart mutations are Server Actions.** Medusa's `lib/data/cart.ts` is `"use server"`, so nothing
  inside it can reach the browser runtime — which is why capture observes actions completing rather
  than hooking their call sites.
- **`q.js` derives a Purchase's event id from `properties.orderId`.** Do not override it, or a
  refreshed confirmation page counts the order twice.
- **Field names are exact.** A content item's price is `value`, per unit, not `price` or
  `item_price`; traits are `first_name`, `last_name` and `postal_code`, not `firstName` or `zip`
  (`address` is sent as a custom trait); `variantId` not `variant_id`; `taxCost` and
  `shippingCost`. A wrong name is never rejected: an event field is silently dropped, and a trait
  silently becomes a custom one.

---

## Configuration reference

The backend takes no plugin options and reads no environment variables. Every store's first-party
domain and Tracking switch are set in Admin, so what the Blotout page shows is the whole truth.

Nothing is encrypted at rest because nothing stored is secret: a domain is public and
a switch is a boolean.

## Troubleshooting

**The admin page shows stale behaviour after upgrading the plugin.** Medusa's dev server
pre-bundles plugin admin extensions with Vite, and the cache key does not change when only the
plugin's contents change — so the browser keeps running the previous build and can call routes that
no longer exist. Clear both caches and restart:

```bash
rm -rf node_modules/.vite .medusa
npm run dev
```

Then hard-reload the browser. This only affects development; a production `medusa build` produces a
fresh bundle each time.

**Events are not arriving.** Four things, in order: the store's first-party domain in
Admin → Blotout matches exactly what the Blotout Platform shows; that store's badge reads
**Sending**; the storefront uses the publishable key of that sales channel; and its root layout mounts the component.
`GET /store/qinto/config` with the storefront's `x-publishable-api-key` answers the first three: it
returns the domain that storefront will use (`first_party_domain`), or `{"enabled": false}`.

**The collector loads but closes its connection.** Each site in the Blotout Platform only accepts
pages on its own root domain, its subdomains and the site's allowed origins. Point each storefront
at the first-party domain of its own site, or add the storefront's origin to that site in the
Blotout Platform.

**Every page load looks like a new visitor.** The collector's *own* anonymous id is set by the
collector, so it only persists when the collector is served from your first-party domain; on a
development host (`*.dev.qinto.tech`) the browser partitions it away and mints a fresh one per page load. The plugin's `truid` cookie (below) is not
affected — it is set by your own server and is stable from the first request. Complete the DNS/CNAME
setup in the Blotout Platform so the collector is a subdomain of your store, and the two line up.

## API routes

| Route | Purpose |
|---|---|
| `GET /store/qinto/config` | a storefront reads its own first-party domain here (`first_party_domain`), chosen by its publishable key |
| `POST /store/qinto/orders/:id/claim` | the storefront's context route claims an order's Purchase; `{ first: true }` once per order, for orders of this storefront placed in the last 24 hours |
| `GET /admin/qinto/channels` | every sales channel with its domain, switch and status |
| `POST /admin/qinto/channels/:id` | set one store's first-party domain (`first_party_domain`, bare host or https origin) and/or turn its tracking on or off |

Four routes, two of them public. `/store/qinto/config` returns a domain that is already public and
nothing else — no token, because there is none to leak. The claim route returns one boolean, writes
one row per order, and answers 404 for an order of another storefront.

## License

MIT

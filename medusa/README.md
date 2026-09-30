# @blotoutio/medusa-plugin-blotout

**By [Blotout](https://blotout.io).** Connects your Medusa store to **Qinto**, Blotout's
first-party analytics and identity platform, and sends your storefront and order events there —
without an ad blocker in the way.

The package is `@blotoutio/medusa-plugin-blotout`; the service it talks to is Qinto, which is what you will
see named throughout the admin and in your Qinto dashboard.

Install it, paste your Qinto URL in the Medusa admin, mount one component in your storefront.

One line in `medusa-config.ts`, and everything a merchant chooses — destination, on/off — is set in
the admin and stored in your database, so changing it needs no redeploy.

---

## What you get

| Event | When |
|---|---|
| `PageView` | every navigation |
| `ViewContent` | a product page |
| `AddToCart` / `RemoveFromCart` | cart changes |
| `InitiateCheckout` | every arrival at checkout, including each step change |
| `AddShippingInfo` / `AddPaymentInfo` | checkout steps |
| `Purchase` | order confirmation page |
| `CompleteRegistration` | account created |

Identity (email, name, city, country, postcode, address) attaches to the shopper's profile at
checkout and on the order.

**Every event is sent from the browser**, including `Purchase`, which is keyed on the order id so a
refreshed confirmation page still counts once. Nothing is sent from your server, and your server
holds no Qinto credential — there is no column for one.

---

## 1. Install

```bash
npm install @blotoutio/medusa-plugin-blotout
```

Add it to `medusa-config.ts`:

```ts
module.exports = defineConfig({
  // …
  admin: {
    // Required. Without it the Blotout admin page will not render — see the note below.
    vite: () => ({ resolve: { dedupe: ["react", "react-dom"] } }),
  },
  plugins: ["@blotoutio/medusa-plugin-blotout"],
})
```

That is the whole configuration. Everything else — the destination, on/off — is
set in **Admin → Blotout** and stored in your database.

> **There is no OAuth, no client secret, and no credential of any kind.** The one thing this plugin
> needs is your site's Qinto URL, which is a public delivery host — it is already visible in the page
> source of any site running Qinto. You copy it from the Qinto portal and paste it in the admin.
> The plugin's schema has two meaningful columns, `qinto_url` and `enabled`, and no column for a
> token because nothing here ever holds one.

> **Why the `admin.vite` line is not optional.** Any plugin that ships admin UI imports `react`.
> Medusa's admin bundler pre-bundles React but does not deduplicate it, so with pnpm — or any
> install that does not hoist — that import can resolve to a *second* copy of React inside the
> plugin. Hooks then get a null dispatcher and the page dies with
> `Cannot read properties of null (reading 'useState')`, which looks like a bug in the plugin and
> is not. One line of `dedupe` fixes it. If you already set `admin.vite`, merge the `dedupe` into
> what you have rather than replacing it.

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

The plugin appears as **Blotout** in the sidebar. Open it:

1. Paste your **Qinto URL** and press Save. Find it in the Qinto portal under
   **Developer tools**, on your site's page.
2. Leave **Tracking** on. The switch stops sending without losing the destination, so you can pause
   and resume without re-entering anything.
3. The badge reads **Sending events** when it is ready.

Everything is stored in your database, so changing destination or turning tracking off needs no
redeploy.
A storefront picks the change up on its next page load; tabs already open keep the previous setting
until then, and the config response is cached for 60 seconds.

---

## 3. Storefront

The backend half is done. Your storefront still has to say *when* a shopper viewed a product or
added to cart, because only it knows — but it works that out for itself.

Install the same package in your storefront and import from it — nothing is copied, so plugin
updates reach the capture logic through `npm update` like any other dependency. From your
storefront's root:

```bash
npm install @blotoutio/medusa-plugin-blotout
```

Let Next compile the package's TypeScript, in `next.config.js`:

```js
const nextConfig = {
  transpilePackages: ["@blotoutio/medusa-plugin-blotout"],
  // ...the rest of your config
}
```

Mount one component in `src/app/layout.tsx`:

```tsx
import QintoAutoCapture from "@blotoutio/medusa-plugin-blotout/storefront/autocapture"

<body>
  <QintoAutoCapture />
  <main className="relative">{props.children}</main>
</body>
```

And add one three-line file, `src/app/api/qinto/context/route.ts`:

```ts
export { GET } from "@blotoutio/medusa-plugin-blotout/storefront/context-route"
```

That one file has to exist for real. Next finds route handlers by scanning your filesystem, so a
route sitting in `node_modules` is invisible to the router — but what it *does* still lives in the
package and updates with it.

**That is two edits to files you already had, plus one three-line file**, and the last of it you
will ever write for this plugin. New events ship in a package update; nothing in your product, cart
or checkout code is touched, so restyling them cannot break tracking.

It reads the Qinto URL from `GET /store/qinto/config`, so there is **no environment variable to
set** — if you would rather pin it, set `NEXT_PUBLIC_QINTO_URL` and it wins.

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
  visit where no form is ever submitted.

### The visitor cookie

The context route also issues **`truid`** — a first-party visitor id, the same mechanism the
WooCommerce, Magento and Salesforce integrations use, under the same name.

| | |
|---|---|
| Value | UUID v4, minted once and never replaced |
| Lifetime | 400 days — the real browser maximum, not the century a cookie can ask for |
| Flags | `HttpOnly`, `SameSite=Lax`, `Secure` on https |
| Scope | widened to the domain shared with your Qinto host when there is one, host-only otherwise |

It exists because Qinto's own anonymous id is set by the *collector*, which makes it third-party
until your DNS setup puts the collector on your domain. `truid` is set by your storefront's own
server, so it is first-party from the first request and stable across page loads either way.

`SameSite=Lax` rather than `Strict` on purpose: the starter's cart and auth cookies are `Lax` so they
survive the cross-site return from a redirect-based payment method, and a visitor id that did not
would be lost at exactly the moment a conversion is attributed.

> **The scope is only widened when your storefront actually sits under that domain.** A browser
> discards a cookie scoped to a domain the response did not come from, so a store at `shop.com`
> reporting to `xyz.dev.qinto.tech` gets a host-only cookie rather than none at all.

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

The assumed shape is the Medusa Next.js starter: the `@lib/*` / `@modules/*` aliases are its, and
route matching expects `/[countryCode]/products/[handle]` and
`/[countryCode]/order/[id]/confirmed`. On a different storefront, keep the plugin and rewrite the
component — the event payload builders in `lib/qinto/mapping.ts` are framework-free and still apply.

Identity (email, name, city, country, postcode, address) attaches to the shopper's profile at
checkout and on the order.

**Every event is sent from the browser**, including `Purchase`, which is keyed on the order id so a
refreshed confirmation page still counts once. Nothing is sent from your server, and your server
holds no Qinto credential — there is no column for one.

---

## Notes worth reading before you debug

- **Cart mutations are Server Actions.** Medusa's `lib/data/cart.ts` is `"use server"`, so nothing
  inside it can reach the browser runtime — which is why capture observes actions completing rather
  than hooking their call sites.
- **`q.js` derives a Purchase's event id from `properties.orderId`.** Do not override it, or a
  refreshed confirmation page counts the order twice.
- **Field names are exact.** `item_price` not `price`; `variantId` not `variant_id`; `taxCost` and
  `shippingCost`. A wrong name is dropped silently rather than rejected.
- **This is not the EdgeTag SDK.** `@blotoutio/edgetag-sdk-js` speaks a different protocol and its
  `/init` call gets `403 path not allowed` from Qinto. Use the files in `storefront/`.

---

## Configuration reference

Everything below is optional. Plugin options win over environment variables, and anything set in
the admin wins over both.

| Option | Env fallback | Meaning |
|---|---|---|

| `qintoUrl` | `QINTO_URL` | fallback before a site is chosen in the admin |

Nothing is encrypted at rest because nothing stored is secret: the destination is a public host and
the switch is a boolean.

**One thing to know about `qintoUrl`.** It is a *fallback*, not a default: a value set here keeps
applying even after you disconnect in the admin. The admin page says so when the destination is
coming from configuration. To stop sending entirely, use the tracking switch, or remove the option
and restart.

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

**Events are not arriving.** Three things, in order: the destination in Admin → Blotout matches
exactly what the Qinto portal shows; the badge reads **Sending events**; and your storefront's root
layout mounts the component. `GET /store/qinto/config` on your backend answers the first two — it
returns the URL the storefront will use, or `{"enabled": false}`.

**Every page load looks like a new visitor.** Qinto's *own* anonymous id is set by the collector, so
it only persists when the collector is served from your domain; on a `*.qinto.tech` host the browser
partitions it away and mints a fresh one per page load. The plugin's `truid` cookie (below) is not
affected — it is set by your own server and is stable from the first request. Complete the DNS/CNAME
setup in the Qinto portal so the collector is a subdomain of your store, and the two line up.

## API routes

| Route | Purpose |
|---|---|
| `GET /store/qinto/config` | the storefront reads its Qinto URL here |
| `GET /admin/qinto` | connection status |
| `POST /admin/qinto/settings` | set the Qinto URL, or turn tracking on and off |

Three routes, and only one of them is public. `/store/qinto/config` returns a URL that is already
public and nothing else — no token, because there is none to leak.

## License

MIT

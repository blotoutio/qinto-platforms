# Setting up @blotout/platform-medusa for MedusaJS

This gets a MedusaJS store sending events to Qinto.

## What you need

MedusaJS 2.21.0 or newer, Node 20.19+ or 22.12+, and a Next.js 14 or 15 storefront on the App Router.
`COOKIE_SECRET` has to be set on the backend and every Medusa install already has one.

Three of the nine events are recognised from the URL, and they default to the Medusa starter's
shapes. If your product, checkout and order pages live somewhere else, you configure them in one
prop. See [Custom storefront routes](#custom-storefront-routes) at the end.

## Backend

```bash
npm install @blotout/platform-medusa
```

Register it in `medusa-config.ts`.

```ts
module.exports = defineConfig({
  // ...your existing config
  admin: {
    vite: () => ({ resolve: { dedupe: ["react", "react-dom"] } }),
  },
  plugins: ["@blotout/platform-medusa"],
})
```

Don't skip the `admin.vite` block. Any plugin with admin UI imports react, and Medusa's admin bundler
pre-bundles react without deduping it, so with pnpm or any install that doesn't hoist you can end up
with a second copy of react inside the plugin. Hooks then get a null dispatcher and the admin page
dies with `Cannot read properties of null (reading 'useState')`. It looks like a broken plugin but it
isn't.

```bash
npx medusa db:migrate
npm run dev
```

That creates one table, `qinto_connection`, holding the Qinto URL and an on/off flag. No shopper data
goes in it.

## Storefront

Nothing gets copied into your source tree. The storefront installs the same package and imports from
it, so fixes reach you through `npm update`.

```bash
npm install @blotout/platform-medusa
```

The package ships TypeScript source so you can read and debug it, which means Next has to be told to
compile it. In `next.config.js`:

```js
const nextConfig = {
  transpilePackages: ["@blotout/platform-medusa"],
  // ...the rest of your config
}
```

Mount the component in `src/app/layout.tsx`. It goes in the root layout because Next keeps that
mounted across navigations and the component needs to remember what the cart looked like a moment
ago.

```tsx
import QintoAutoCapture from "@blotout/platform-medusa/storefront/autocapture"

<body>
  <QintoAutoCapture />
  <main className="relative">{props.children}</main>
</body>
```

Then add one file, `src/app/api/qinto/context/route.ts`.

```ts
export { GET } from "@blotout/platform-medusa/storefront/context-route"
```

It issues the first-party `truid` cookie.

That's the whole storefront change. Two edits to files you already had plus one three-line file. None
of your product, cart or checkout components get touched, so restyling them can't break tracking.

## Connect

Open the site in the Qinto portal, go to Developer tools and copy the site's Qinto URL. Then in Medusa
Admin go to Blotout, paste it and press Save.

The badge reads "Sending events" once both halves are live. The Tracking switch pauses sending without
losing the URL.

There's nothing to configure on the storefront. It fetches the URL from the backend at runtime, so the
merchant can change it later without a redeploy. If you'd rather pin it, set `NEXT_PUBLIC_QINTO_URL`
and it wins.

## Check it works

Start both apps and open the storefront. In the Qinto portal go to Analytics, then Real time, and
press Start. It doesn't stream until you do.

Load a page, open a product, add it to the cart and go to checkout. You should see `PageView`,
`ViewContent`, `AddToCart` and `InitiateCheckout` come through in that order.

## What gets captured

| Event | Fires when |
|---|---|
| `PageView` | Every route change, including client-side navigation |
| `ViewContent` | A product page opens |
| `AddToCart` | A line is added or its quantity goes up |
| `RemoveFromCart` | A line is removed or its quantity goes down |
| `InitiateCheckout` | A shopper reaches checkout from another page, every time, but not when moving between steps inside checkout |
| `AddShippingInfo` | A shipping method is chosen |
| `AddPaymentInfo` | A payment method is chosen |
| `Purchase` | The order confirmation page renders |
| `CompleteRegistration` | A new account is created |

Traits get identified from the cart, the completed order, the signed-in customer and the checkout
address form, so email, first and last name, phone, address, city, state, postal code and country
where they're present.

The `truid` cookie is a random UUID set from your storefront's own server, httpOnly, SameSite=Lax,
Secure over HTTPS, 400 day lifetime. JavaScript can't read it and it doesn't go to anyone else.

It's scoped to your registrable domain, so `shop.com`, `www.shop.com` and `checkout.shop.com` all
share one id and a shopper moving between them stays a single visitor. Country suffixes are handled,
so a store on `shop.co.uk` gets `.shop.co.uk` and never `.co.uk`, which browsers refuse. On localhost
or an IP the cookie stays host-only, because neither can carry a domain scope.

If your suffix isn't one we recognise, or you want a narrower scope, set `QINTO_COOKIE_DOMAIN` on the
storefront and it's used as given. It has to start with a dot and your storefront has to sit under it.

Ask whoever runs your Qinto account to confirm the Medusa tag's `cookieMapKey` is set to `truid`,
otherwise the cookie gets issued and ignored.

## If something doesn't work

**Admin page is blank, or the console says `Cannot read properties of null (reading 'useState')`.**
The `admin.vite` dedupe block is missing. Add it and restart. If it still fails, delete
`node_modules/.vite` and hard refresh, because Vite caches hard and a stale cache survives a restart.

**Nothing in the real-time logger.** Check you pressed Start. Check the admin badge says "Sending
events" and that Tracking is on. In the browser console check `window.qinto` exists, and if it's
undefined the component isn't mounted. Then open `/api/qinto/context?kind=cart` directly. A 404 means
the route file is missing, and a 500 means the storefront can't reach the backend, so check
`NEXT_PUBLIC_MEDUSA_BACKEND_URL`.

**`AddToCart` never fires but `PageView` does.** Almost always the context route, so check the 404
above.

## Custom storefront routes

Six of the nine events come from cart and customer state, so they work whatever your URLs look like.
The other three are recognised from the path, and these are the shapes assumed by default.

| Event | Default path |
|---|---|
| `ViewContent` | `/[countryCode]/products/[handle]` |
| `InitiateCheckout` | `/[countryCode]/checkout` |
| `Purchase` | `/[countryCode]/order/[id]/confirmed` |

If you kept those you don't need this section. A storefront with no country prefix is handled
automatically. If you renamed them, pass `routes` to the component and the three come back.

```tsx
<QintoAutoCapture
  routes={{
    product: "wiper-blades/:make/:model",
    checkout: "shop/checkout",
    order: "shop/order/:id",
  }}
/>
```

`:name` takes one segment and `*` takes everything left. Matching is a prefix, so `"shop/checkout"`
also matches `/shop/checkout/payment`, which is what you want when checkout steps live under the same
path.

When a product pattern captures more than one segment they're joined with `-`, so
`/wiper-blades/toyota/corolla` looks up the handle `toyota-corolla`. The same applies to an order id.

If your paths don't fit a pattern, pass a function instead. It gets the path segments with any
country prefix already removed, and returns the handle or id to look up, or `null` for no match.

```tsx
routes={{
  product: (segments) =>
    segments[0] === "p" && segments[1] ? segments[1].split("--")[0] : null,
}}
```

Set an entry to `false` if your storefront has no such page, and that event stops firing rather than
matching something it shouldn't.

### The country prefix

By default any two-letter first segment is read as a country code and skipped. If your storefront has
no country prefix and a real two-letter page, such as `/hr/jobs`, say so or that page will be
misread.

```tsx
routes={{ countryPrefix: false }}
// or, for a storefront using locale codes
routes={{ countryPrefix: (segment) => segment.includes("-") }}
```

## Updating and removing

```bash
npm update @blotout/platform-medusa   # both apps
npx medusa db:migrate                         # backend only
```

Keep both apps on the same version. Migrations are additive.

To remove it, drop it from `plugins[]` on the backend and uninstall. The `qinto_connection` table
stays until you drop it yourself, so an accidental uninstall doesn't lose the merchant's connection.
On the storefront remove the `transpilePackages` entry, the mount and its import, delete
`src/app/api/qinto/`, then uninstall.

Issues: <https://github.com/blotoutio/qinto-platforms/issues>

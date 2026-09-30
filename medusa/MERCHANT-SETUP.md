# Setting up medusa-plugin-blotout for MedusaJS

This gets a MedusaJS store sending events to Qinto.

## What you need

MedusaJS 2.21.0 or newer, Node 20.19+ or 22.12+, and a Next.js 14 or 15 storefront on the App Router.
`COOKIE_SECRET` has to be set on the backend and every Medusa install already has one.

The capture component reads the Medusa starter's URL shape, so `/[countryCode]/products/[handle]`,
`/[countryCode]/checkout` and `/[countryCode]/order/[id]/confirmed`. If you kept those paths it works
as is. If you renamed them, read [Custom storefront routes](#custom-storefront-routes) at the end.

## Backend

```bash
npm install @blotoutio/medusa-plugin-blotout
```

Register it in `medusa-config.ts`.

```ts
module.exports = defineConfig({
  // ...your existing config
  admin: {
    vite: () => ({ resolve: { dedupe: ["react", "react-dom"] } }),
  },
  plugins: ["@blotoutio/medusa-plugin-blotout"],
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
npm install @blotoutio/medusa-plugin-blotout
```

The package ships TypeScript source so you can read and debug it, which means Next has to be told to
compile it. In `next.config.js`:

```js
const nextConfig = {
  transpilePackages: ["@blotoutio/medusa-plugin-blotout"],
  // ...the rest of your config
}
```

Mount the component in `src/app/layout.tsx`. It goes in the root layout because Next keeps that
mounted across navigations and the component needs to remember what the cart looked like a moment
ago.

```tsx
import QintoAutoCapture from "@blotoutio/medusa-plugin-blotout/storefront/autocapture"

<body>
  <QintoAutoCapture />
  <main className="relative">{props.children}</main>
</body>
```

Then add one file, `src/app/api/qinto/context/route.ts`.

```ts
export { GET } from "@blotoutio/medusa-plugin-blotout/storefront/context-route"
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

The component works out products, checkout and order confirmation from the URL.

| Page | Expected path |
|---|---|
| Product | `/[countryCode]/products/[handle]` |
| Checkout | `/[countryCode]/checkout` |
| Order confirmation | `/[countryCode]/order/[id]/confirmed` |

A storefront with no country prefix is handled automatically. But if you renamed these segments, say
`/shop/[handle]` instead of `/products/[handle]`, then `ViewContent`, `InitiateCheckout` and
`Purchase` won't fire. `PageView`, `AddToCart` and `RemoveFromCart` still will, because those come
from cart state and not from the URL.

Tell us if that's your setup. Making the mapping configurable is easy and we'd rather do that than
have you fork the component.

## Updating and removing

```bash
npm update @blotoutio/medusa-plugin-blotout   # both apps
npx medusa db:migrate                         # backend only
```

Keep both apps on the same version. Migrations are additive.

To remove it, drop it from `plugins[]` on the backend and uninstall. The `qinto_connection` table
stays until you drop it yourself, so an accidental uninstall doesn't lose the merchant's connection.
On the storefront remove the `transpilePackages` entry, the mount and its import, delete
`src/app/api/qinto/`, then uninstall.

Issues: <https://github.com/blotoutio/qinto-platforms/issues>

# web — the Vite React SPA

Runs inside the SHOPLINE Admin iframe. Renders from `/api/status` and holds nothing.

## This bundle holds no secrets and no tokens

It never sees one, never stores one, and has nothing to leak. If a screen seems to need a
credential, the backend needs a route instead.

## `/api/status` decides the screen; nothing here does

There is no client-side router and no local screen state that could drift from the server's view.
The one exception is which team the merchant just clicked "create a site" under, which the server
cannot know until the site exists.

## Host chrome comes from App Bridge actions

`Modal`, `Message`, `Loading`, `SaveBar`. Don't hand-roll a modal or a toast: one rendered inside
our iframe would be clipped by it and would not dim the Admin behind it.

## The package is `@shoplineos/app-bridge`

`@shoplinedev/appbridge` is abandoned — last release 2024-03 — and has no
`shared.authenticatedFetch`. It must not come back.

`lib/app-bridge.ts` carries one `as unknown as transport` cast, and it is upstream's bug, not ours:
`createApp` returns `localOrigin?: string` while every consumer declares it required. Keep the cast
at that one boundary rather than relaxing `exactOptionalPropertyTypes` for our code.

## Every backend call goes through `lib/api.ts`

It attaches the session token via `shared.authenticatedFetch`, and it turns a reauthorization header
into a top-level redirect. A bare `fetch` skips both.

## Blotout's consent screen cannot render inside the Admin iframe

Connecting is always a top-level redirect, through `openTopLevel`. Rendering it in place shows the
merchant a blank box.

## Blotout's palette and type live in `src/styles.css`

Tokens lifted from the Blotout platform's own `app.css`, so the two surfaces look like one product.
SHOPLINE prescribes no component library for an app's body — only for the Checkout UI Customizer —
so there is nothing to fight and no framework earns its weight for four screens.

## Say what is actually true, not what is reassuring

The screens are written to be honest about three things in particular, and a change that softens
any of them is a regression:

- The kill switch takes effect on each visitor's **next page load**, not instantly.
- When SHOPLINE has not accepted the last change, the storefront **may still be sending**.
- A site on a development URL gives visitors **no persistent id**, so returning visitors look new.

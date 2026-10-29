# Blotout for SHOPLINE

A SHOPLINE public app that connects a merchant's store to the Blotout platform and turns on
first-party event tracking on their storefront.

## Three runtimes, three rulebooks

The constraints differ enough that confusing them produces real bugs, so each has its own file.

| Directory | Runtime | Its rules |
|---|---|---|
| `app/` | Hono on Cloudflare Workers | `app/AGENTS.md` |
| `web/` | Vite React SPA inside the SHOPLINE Admin iframe | `web/AGENTS.md` |
| `extensions/blotout-pixel/` | SHOPLINE Pixel strict sandbox, on every storefront page | `extensions/blotout-pixel/AGENTS.md` |
| `extensions/blotout-theme/` | SHOPLINE theme app extension, injecting a merchant's own snippet | `extensions/blotout-theme/AGENTS.md` |

## "Session" means three unrelated things here

This is the most likely serious bug in the repo. Keep them apart:

- **The SHOPLINE session token** — a short-lived HS256 JWT the Admin iframe hands the SPA, sent on
  every API call. It proves *who is looking at the app right now*.
- **The `shopline_sessions` row** — the store's OAuth access token, used to call the Admin API. It
  proves *the store installed us*. It expires (~10h) and is refreshed by app credentials.
- **The Blotout grant** — `qinto_connections`, the merchant's `qoa_`/`qor_` pair. It proves *a Blotout
  user authorized us for their teams*.

A function that takes "the session" must say which one.

## A token never crosses into the browser

Any runtime, any reason, including redacted and including dev. No route returns one, no log prints
one, no response body carries one.

## Never widen the SHOPLINE access scopes without a decision

We ship exactly `read_pixels`, `write_pixels` and `read_store_information` (for `merchants/shop.json`).
Over-requesting is penalized at app review (review standard §3.2), and every extra scope is a bigger blast radius on a stolen token.

## Before finishing, run `pnpm full-check`

`format` → `typecheck` → `db:check` → `test:coverage`, stopping at the first failure. It is part of
"done", not a separate chore. E2E is deliberately outside it: the things worth checking there — does
the sandbox socket carry the cookie, did the pixel actually fire — cannot be asserted from CI.

## Don't create git branches unless asked

## Comment policy

Delete a comment unless removing it would let a maintainer introduce a bug because of a non-local
constraint the code cannot express. No comment restates the line below it, and no comment narrates
history ("previously we…").

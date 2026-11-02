# Blotout for SHOPLINE

A SHOPLINE public app that connects a merchant's store to the [Blotout](https://blotout.io) platform and
turns on first-party event tracking on their storefront.

- **`AGENTS.md`** — the invariants. There is one per runtime: `app/`, `web/`,
  `extensions/blotout-pixel/`, `extensions/blotout-theme/`.

## The shape of it

```
SHOPLINE Admin (iframe)
   └─ web/ SPA ──session token──▶ app/ Worker (Hono) ──▶ D1
                                        ├──▶ SHOPLINE Admin API (pixel config, shop info)
                                        └──▶ Blotout platform API (teams, sites, DNS, deploy)

Storefront page
   └─ SHOPLINE Pixel sandbox (auto-activated on install)
        └─ extensions/blotout-pixel ──WebSocket──▶ wss://<deliveryHost>/open
```

Three runtimes, three sets of constraints. The pixel has no DOM, the Worker must never hand a token
to the browser, and the SPA must never hold one.

## Getting set up

```bash
pnpm install
cp app/.dev.vars.example app/.dev.vars     # then fill it in — see the comments in the file
cp shopline.app.production.toml shopline.app.dev.toml
pnpm --filter app db:migrate:local
pnpm --filter web build                    # the Worker serves web/dist as its assets
pnpm dev                                   # `shopline app dev -c dev`: tunnel + install on the dev store
```

To run the Worker alone, without the SHOPLINE tunnel:

```bash
pnpm --filter app dev                      # wrangler dev on :3457
pnpm --filter web preview:screens          # every screen, with the API stubbed, on :4321
```

## App configuration

There are three SHOPLINE apps, one per config, and the CLI picks a config with `-c`:

- **`shopline.app.production.toml`**: the public *Blotout* app behind `shopline.blotout.io`,
  committed. `appKey` stays empty until the app exists on SHOPLINE. Push a change to it with
  `shopline app config push -c production`.
- **`shopline.app.sandbox.toml`**: the *[Sandbox] Blotout* app behind `shopline-sandbox.qinto.tech`,
  committed. Push a change to it with `shopline app config push -c sandbox`.
- **`shopline.app.dev.toml`**: the dev app, local, gitignored. Never point a deployed Worker at it.
  `pnpm dev`, `pnpm dev:reset`, `pnpm config:use` and `pnpm config:push` use it, and
  `shopline app dev` rewrites its URLs with each run's tunnel, so the committed files never change. `shopline app build` has no `-c` flag and uses whichever config
  the CLI last saved for this directory. Run `pnpm config:use` once so that default is `dev`.

## Releasing

Releases go out from GitHub: **Actions → Release → Run workflow**, the same form as solutions'
Release. Release to `sandbox`, test on the sandbox store, then run the same release name against
`production`.

| Input | What it does |
|---|---|
| **App** = `shopline` | Lint, typecheck, `db:check`, tests, build the SPA, apply D1 migrations, deploy the Worker, tag `shopline-<release>-<type>` |
| **SHOPLINE App** = `shopline` | `sl extension push` for the pixel and the theme extension |
| **Type** | `sandbox` or `production` |
| **Release name** | Run title and tag |

Leave a dropdown on *Select* to skip it.

| | Sandbox | Production |
|---|---|---|
| SHOPLINE app | *[Sandbox] Blotout* | *Blotout* |
| Worker | `blotout-shopline-sandbox`, `shopline-sandbox.qinto.tech` | `blotout-shopline`, `shopline.blotout.io` |
| D1 | `blotout-shopline-sandbox` | `blotout-shopline` |
| Qinto | `api.qinto.tech` | `qinto-api.blotout.io` |
| Wrangler config | `app/wrangler.sandbox.jsonc` | `app/wrangler.production.jsonc` |
| GitHub environment | `shopline-sandbox` | `shopline-production` |

`app/wrangler.jsonc` is for local `wrangler dev` and the tests only. Wrangler configs don't share
values, so a binding or var changed in one of the three has to be changed in the others too.

An extension push lands as a **draft**. Publish the new version in the SHOPLINE Partner Portal; the
run summary links to it.

### What a release reads

Each GitHub environment (`shopline-sandbox`, `shopline-production`) holds three secrets and nothing
else: `CLOUDFLARE_APP_ACCOUNT_ID`, `CLOUDFLARE_APP_API_TOKEN` and `SHOPLINE_APP_SECRET`. Everything
else is committed:

- the app key and URL, from `shopline.app.<type>.toml`
- the D1 database, from `app/wrangler.<type>.jsonc`
- each extension's id and uuid, from `extensions/registrations.json`

The Worker's own secrets (`SHOPLINE_APP_SECRET`, `QINTO_CLIENT_ID`, `QINTO_CLIENT_SECRET`,
`TOKEN_KEK`) are set once on the Worker, never by a release.

### Setting up a target, once

1. Create the SHOPLINE app in the Partner Portal. Put its key and URL in `shopline.app.<type>.toml`
   and its key in `SHOPLINE_APP_KEY` in `app/wrangler.<type>.jsonc`.
2. `wrangler d1 create <database_name>`, and put the id in `app/wrangler.<type>.jsonc`.
3. `wrangler secret put <NAME> --config wrangler.<type>.jsonc` for each of the four Worker secrets.
   `TOKEN_KEK` must never change afterwards: no stored token decrypts under a different one.
4. Register each extension: fill its `.env.prod` with the new app's key, secret, `PARTNER_ID` and an
   `EXTENSION_TITLE` (the name it gets on SHOPLINE), leave the ids out, and run `sl extension push`
   in its folder. The push writes `EXTENSION_ID` and `EXTENSION_UUID` back into `.env.prod`; copy
   them into `extensions/registrations.json`.
5. Create the `shopline-<type>` GitHub environment with the three secrets.

Commit the files from steps 1, 2 and 4. A release refuses to run while any of those values is empty.

### From a laptop

The same steps by hand, if GitHub is unavailable:

```bash
pnpm --filter web build
pnpm --filter app db:migrate:sandbox       # or db:migrate:production
pnpm --filter app deploy:sandbox           # or deploy:production
```

Roll the Worker back with `wrangler rollback --config wrangler.<type>.jsonc`. D1 migrations are not
rolled back.

## Before you call anything done

```bash
pnpm full-check
```

`format` → `typecheck` → `db:check` → `test:coverage`, stopping at the first failure. Coverage is
enforced: 100% on `app/src` and the pixel, 80% on `web/src`.

E2E is deliberately outside that chain. The things worth checking there — whether the sandbox socket
carries the cookie, whether the pixel actually fired — cannot be asserted from CI.

## Scopes

**SHOPLINE**: `read_pixels`, `write_pixels`, `read_store_information`. Nothing else. The last one
reads `merchants/shop.json` for the store name and primary domain. Over-requesting is penalized at app
review, and every extra scope widens the blast radius of a stolen token.

**Blotout**: `profile`, `team:read`, `domain:write`, `offline_access`.

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
cp shopline.app.toml shopline.app.dev.toml
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

There are two SHOPLINE app configs, and the CLI picks one with `-c`:

- **`shopline.app.toml`**: production, committed. `appKey`, `appUrl` and `appCallbackUrlList` stay
  empty until there is a production app on SHOPLINE. The callback is `<appUrl>/api/auth/callback`.
- **`shopline.app.dev.toml`**: local, gitignored. `pnpm dev`, `pnpm dev:reset`, `pnpm config:use`
  and `pnpm config:push` use it, and `shopline app dev` rewrites its URLs with each run's tunnel, so
  the production file never changes. `shopline app build` has no `-c` flag and uses whichever config
  the CLI last saved for this directory. Run `pnpm config:use` once so that default is `dev`.

## Deploying the Worker

`app/wrangler.jsonc` has two environments: the top level is production (`blotout-shopline`) and
`env.dev` is a deployed dev Worker (`blotout-shopline-dev`) with its own D1 database. Production
points at Qinto production (`qinto-api.blotout.io`, `platform.blotout.io`) and dev at the Qinto
sandbox (`api.qinto.tech`, `portal.qinto.tech`). Production leaves `SHOPLINE_APP_KEY` empty until
there is a production app, and local `wrangler dev` takes the dev values from `app/.dev.vars`.

```bash
pnpm --filter app deploy                   # production
pnpm --filter app db:migrate:remote

pnpm --filter app deploy:dev               # dev
pnpm --filter app db:migrate:dev
```

Before the first deploy of either, put the `database_id` from `wrangler d1 create <database_name>`
into its block and set the four secrets with `wrangler secret put <NAME>` (add `--env dev` for dev).
Wrangler does not inherit vars, databases or secrets into an environment, so a value changed at the
top level has to be changed in `env.dev` too.

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

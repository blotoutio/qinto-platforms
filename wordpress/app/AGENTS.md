# app — the WordPress broker (Hono on Cloudflare Workers)

The one Qinto OAuth client for every WordPress install. Owns D1 and every Qinto token.

## Routes

| Route | Auth | Does |
|---|---|---|
| `POST /register` | rate limit (IP) | mints the install's secret, once |
| `POST /connect` | signed, unverified allowed | proves site ownership (every login), returns `startUrl` |
| `GET /oauth/start` | live `state` | names the site, links to Qinto's consent screen |
| `GET /oauth/callback` | one-time `state` | stores the grant, returns to the pinned URL |
| `GET /sites` · `POST /sites` | signed | list teams and sites · create a managed site |
| `GET /dns` · `POST /dns/check` · `POST /dns/share` | signed | DNS records, recheck, email them (3/min per install) |
| `POST /deploy` | signed | deploy a site |
| `POST /select-site` | signed | install `blotout-consent`, settings, allow the WP origin, store the host |
| `PUT /destination` | signed | own domain or Qinto URL; only the printed host changes |
| `GET /status` | signed | what the settings page shows |
| `POST /disconnect` | signed | revoke the grant (refresh token), delete the install |
| `POST /heartbeat` | signed | the plugin's daily check-in; dates `last_seen_at` |

## A signed call

Headers `X-Blotout-Registration`, `X-Blotout-Ts` (unix seconds), `X-Blotout-Nonce` (16–64 of
`[A-Za-z0-9_-]`) and `X-Blotout-Sig` = hex `HMAC-SHA256(secret, message)` where `message` is

```
v1\n<registrationId>\n<ts>\n<nonce>\n<stored shopId>\n<METHOD>\n<path?query>\n<hex sha256(body)>
```

The shop is the stored one, never a header. ±5 minutes; each nonce once.

A refused call answers `401` with a reason: `clock_skew`, `unknown_registration`, `replay` or
`unauthorized`. The plugin drops its secret only on `unknown_registration`.

## Identity comes from the signature only

`requireSignature` sets the registration. No route takes a registration id from a query or a body,
and `select-site` takes the WordPress origin from the stored `shopId`.

## An install is locked to its selected site

Once `/select-site` succeeds, DNS, deploy, select and create act only on that site
(`services/site-scope.ts`, `409 site_locked`). Changing site is disconnect, then connect.

## WordPress never gets a host that does not resolve

Qinto's `/snippet` can name the custom domain before its DNS is verified. `services/provision.ts`
then checks `/dns` and stores the Qinto URL instead while `valid` is false.

## Only one request refreshes a grant

`refresh_lease_until` is a compare-and-set lease. A request that loses it waits for the winner's
token, then answers `503 busy`; it never presents the refresh token and never marks the grant
revoked. A reconnect revokes the grant it replaces.

## Tokens are encrypted, bound to their row

Every stored secret goes through `crypto/secret.ts` with an AAD of `<table>:<id>:<column>`. Never
reuse an IV; `encryptSecret` makes one per call.

## Only `invalid_grant` means the grant is gone

Then mark it revoked and surface `qinto_grant_revoked`. Any other refresh failure (5xx, network,
another error code) keeps the grant, releases the lease and answers `503 qinto_unavailable`; Qinto
hands back the same successor if the first attempt did rotate it.

## Silent installs are forgotten

The hourly cron rotates idle grants, but not for an install whose last signed call is older than
60 days. Those grants are revoked and the install deleted.

## Migrations are additive

`pnpm db:generate` writes to `app/drizzle/migrations`; read the SQL, commit it. `pnpm db:check` fails on
drift, and the tests run against the committed SQL.

## Deploys

GitHub Actions > Release, App `wordpress`, type `sandbox` or `production`. It runs the checks,
applies the migrations from `migrations_dir` in `wrangler.<type>.jsonc`, deploys and tags. Each
target needs the `wordpress-<type>` GitHub environment with `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN`.

## Secrets

`QINTO_CLIENT_ID`, `QINTO_CLIENT_SECRET`, `TOKEN_KEK`, set with
`wrangler secret put`. The sandbox and production D1 ids are empty until the databases exist.

# app — Hono on Cloudflare Workers

The backend. Owns both OAuth systems, D1, and every token this app holds.

## A Drizzle schema change is a generated migration you read before committing

`pnpm db:generate`, then read the SQL. Never `drizzle-kit push`. `pnpm db:check` fails the build
when `schema.ts` and the committed migrations disagree, so a schema edit with no migration cannot
ship — and the test suite runs against the committed SQL, not against `schema.ts`.

## SQLite has no ALTER COLUMN

A column type or constraint change makes drizzle-kit rebuild the whole table — create, copy, drop,
rename. On `shopline_sessions` or `qinto_connections`, which hold encrypted tokens, rehearse that
against a seeded local D1 before committing it.

## Timestamps are `timestamp_ms` columns with `$defaultFn` / `$onUpdateFn`

Never SQL date arithmetic in a default. The generated migration then has no `unixepoch()` to reason
about, and a test can inject a clock.

## Tokens are written encrypted and returned by no route

Not redacted, not in dev, not in a log line. Every stored credential goes through
`crypto/secret.ts`; a new column holding one without it is a bug.

The SHOPLINE access token is **not permanent** — the dev store issued a ten-hour one. `loadSession`
refreshes it; nothing else reads `access_token_enc`.

## Never reuse an AES-GCM IV

`encryptSecret` generates one per call. There is no code path that supplies, caches or derives it,
and there must not be: one reused IV under a single key breaks the cipher outright.

The AAD binds each ciphertext to `<table>:<primary key>:<column>`, so a database write cannot move
one store's token onto another store. A new encrypted column needs its own AAD.

## A failed Blotout refresh means the grant is gone

Mark it revoked and surface it. Never retry a rotated refresh token — replaying one revokes the
whole grant server-side, so the second attempt makes things worse.

`BlotoutNotConnectedError` and `BlotoutGrantRevokedError` are different states with different copy:
"connect" versus "reconnect". Do not collapse them.

## `GET /api/status` is the only endpoint that decides which screen the app shows

Add a field to it rather than a sibling status route. The SPA renders from it and nothing else.

## Every store-scoped route goes behind `requireSession`

The handle comes from the verified session token and from nowhere else — never a query parameter,
never a body. Exactly four routes are exempt, each with its own proof of origin, and
`test/auth-surface.test.ts` is the inventory. It exists because `/api/status` once shipped without
its guard.

## The kill switch has two flags for a reason

`trackingEnabled` is the merchant's intent; `pushedEnabled` is what SHOPLINE last accepted. Write
`pushedEnabled` only on a successful push, and never render "off" on the strength of a failed one.

Anything that invalidates the current selection — disconnect, change-site — pushes `enabled=false`
**first**, while there is still a selection to push against.

## Reach for WebCrypto and `fetch` before a node builtin

There is no `nodejs_compat` flag on this Worker and no runtime dependency beyond Hono and Drizzle.
`shopline-api-js` is deliberately not used: its OAuth calls go through `axios`, its JWT
verification through `jsonwebtoken`, its HMAC through `crypto-js`. `shopline/crypto.ts` reproduces
those three, and each function records which upstream detail it is matching — the encodings have to
agree byte for byte or every token fails.

## The SHOPLINE Admin API version is one exported constant

`API_VERSION` in `config.ts`.

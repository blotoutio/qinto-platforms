# Blotout Consent for WordPress

- `app/` — the broker Worker. `pnpm install`, then `cp app/.dev.vars.example app/.dev.vars`,
  `pnpm --filter app db:migrate:local` and `pnpm --filter app dev`. Migrations live in
  `app/drizzle/migrations`. Deploy from GitHub Actions > Release (App `wordpress`).
- `plugin/` — the WordPress plugin. `pnpm plugin:install`, then `pnpm plugin:test` and `pnpm plugin:lint`.
  Point a test site at a local broker with the `blotout_consent_broker_url` filter.

See `AGENTS.md` and `app/AGENTS.md`.

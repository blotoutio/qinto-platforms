# Blotout Consent for WordPress

The broker and the WordPress plugin that put the Blotout consent banner on a WordPress site through Qinto.

| Directory | Runtime | Its rules |
|---|---|---|
| `app/` | Hono on Cloudflare Workers, D1 | `app/AGENTS.md` |
| `plugin/` | WordPress plugin, PHP 7.4+ | `plugin/AGENTS.md` |

## WordPress never holds a Qinto token

The plugin stores the host it prints and its own per-install HMAC secret, nothing else. Every Qinto
token lives in the broker, encrypted. No route returns one and no log prints one.

## The signing contract is shared by two languages

`app/src/services/signature.ts` (`canonicalMessage`) and the plugin's `RequestSigner.php` must agree
byte for byte. Change both in the same commit, and keep the test vectors in step.

## Never widen the Qinto scopes without a decision

`QINTO_SCOPES` in `app/src/config.ts`. Each one is a bigger blast radius for a stolen grant.

## Before finishing, run `pnpm full-check`, plus `pnpm plugin:test` and `pnpm plugin:lint` for the plugin

`format` → `typecheck` → `db:check` → `test:coverage` (100% lines, branches and functions). The plugin
checks run PHPUnit on PHP 7.4 and 8.2 and PHPCS (WPCS + PHPCompatibility) in Docker; run
`pnpm plugin:install` once first.


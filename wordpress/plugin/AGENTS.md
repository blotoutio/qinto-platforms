# Blotout Consent plugin

PHP 7.4+, WordPress 5.8+. `src/` is PSR-4 under `Blotout\Consent`, loaded by `src/autoload.php`;
Composer is for development only and `vendor/` never ships.

## WordPress stores a host, never a token

`Options` holds the delivery host, the picked site's labels, and the broker registration (id, secret,
and the shop id it was registered with, autoload off). Every Qinto call goes through the broker.

## `q.js` loads once per page

The snippet prints whenever `Options::qinto_host()` has a host. It is Qinto's own snippet, which does
nothing when `window.qinto` already exists, so another plugin that loads the same site's `q.js` (for
example a tag plugin set to a Qinto URL) never causes a second load: whichever runs first wins.

## The registration is dropped only when the broker says `unknown_registration`

Any other `401` (`clock_skew`, a bad signature) keeps it. Disconnect keeps it too unless the broker
confirms. `Broker/Heartbeat` checks in daily; the broker revokes an install silent for 60 days.

## Two outputs are pinned byte for byte

- `Storefront/ConsentModeV2` prints `tests/fixtures/consent-mode.html`, then its own `RESTORE`
  script. The script is fenced from `phpcbf`, which would re-indent it.
- `Storefront/QintoSnippet` must match Qinto's `snippetTag()` (`tests/fixtures/qinto-snippet.html`).

## Signing matches the broker

`Broker/RequestSigner` signs the stored shop id, method, path with query and body hash exactly as
`app/src/services/signature.ts` checks them. `tests/Unit/RequestSignerTest.php` holds the vectors.

## No `register_setting` on `blotout_consent_qinto_settings`

Its sanitize callback would run on every `update_option` of that option, including the wizard's, and
silently drop keys. The consent form saves through `admin-post.php?action=blotout_save_consent`.

## The banner is switched on in Qinto, not here

The consent app's `STATUS` and `CONFIG` are app-owned variables only its Qinto panel writes, so a new
site shows nothing until the admin turns it on there. The page cannot tell whether it is on, so it
never says the banner is live; the final screen shows only the configuration and links to that
panel ("Edit banner in Qinto", `bannerSettingsUrl` from `/status`).

## The admin page is a focused wizard

Connect → Choose site (→ DNS for a new site) → configuration. `views/page.php` renders each
screen; `assets/admin.js` fills the site chooser. Consent settings (`views/consent-settings.php`)
are always open and appear only once setup is done. Broker 5xx errors go
out of `admin-ajax` as 200 with `success:false`, because proxies such as Cloudflare replace a 5xx
body and the slug would be lost.

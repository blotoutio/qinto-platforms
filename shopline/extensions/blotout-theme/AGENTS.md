# extensions/blotout-theme — the theme app extension

One App Embed Block, `target: head`, holding a merchant's own tracking snippet. It exists because
the pixel sandbox has no DOM, so a pasted GTM or Meta snippet cannot run there — a theme app
extension is the only surface on SHOPLINE that can.

## This is not gated by the app's tracking switch, on purpose

SHOPLINE already gives the merchant a switch for it: an App Embed Block is off until they turn it on
in **Theme settings → App embeds**. A second flag of ours would be two switches for one thing, and
the merchant would have to guess which one is winning. Do not add one.

It also means this block is unrelated to Blotout tracking in both directions: Blotout keeps working with
the block off, and the block keeps working with Blotout's kill switch off.

## The merchant has to turn it on themselves

There is no API to activate an App Embed Block — SHOPLINE's own docs say "Merchants need to activate
them from Theme settings > App embeds in the theme editor". `web/src/components/AppEmbedNote.tsx` is
the instruction, and it links to the store's theme page rather than the editor: the editor URL
carries a theme id this app has no scope to read.

## The structure is the CLI's, not ours

`.shopline-cli.yml` with `EXTENSION_TYPE: THEME_APP_EXTENSION` is what makes `sl` recognise the
directory — `getExtensionType()` answers `themeAppExtension` because of that file alone. Blocks live
in `blocks/*.html` with their schema in a `{{#schema}}` tag.

## Labels are plain strings, not `t:` keys

Pushed as `t:` keys with `i18n/en.schema.json`, the theme editor showed the raw keys prefixed with
the extension UUID instead of the text. SHOPLINE's extension examples use plain strings, so the
schema does too.

## `html`, not `text`

The setting is SHOPLINE's `html` control — "a multi-line text input box that accepts HTML". `text` is
a single line and would be useless for a snippet.

## The output is deliberately unescaped

`{{{ }}}` — a snippet that arrives escaped renders as visible text on every page of the storefront
instead of running, which is the most embarrassing possible failure. This is the one thing here that
has never been rendered by SHOPLINE, so check it on the first publish: the snippet either executes
or shows up as markup, and there is no middle state to miss.

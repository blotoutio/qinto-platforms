/**
 * The first-party visitor cookie.
 *
 * Qinto's own anonymous id is set by the collector, so it is only first-party once the collector is
 * served from the merchant's own domain. Until then the browser partitions it away and every page
 * load looks like a new visitor. This cookie is set by the *storefront's* server instead, so it is
 * first-party from the first request, and it is what the edge pins identity to.
 *
 * It is the same mechanism the WooCommerce, Magento and Salesforce integrations use, under the same
 * name — the platform already accepts `truid` as a tag's `cookieMapKey`, alongside `_shopify_y` for
 * Shopify — so no server-side change is needed to consume it.
 *
 * Pure and framework-free so the rules below can be tested without a request.
 */

export const TRUID_COOKIE = "truid"

/**
 * Chrome caps cookie lifetime at 400 days and silently truncates anything longer, so asking for the
 * hundred years the WordPress plugin requests would buy nothing. This is the real maximum.
 */
export const TRUID_MAX_AGE_SECONDS = 400 * 24 * 60 * 60

/** A v4 UUID, matching the format the other platform integrations write. */
export const newTruid = (): string => globalThis.crypto.randomUUID()

/**
 * Second-level labels that are public suffixes under a two-letter country TLD. `shop.co.uk` must
 * widen to `.shop.co.uk` and never to `.co.uk`, which no browser would accept, leaving the visitor
 * with no cookie at all. This list is not the full Public Suffix List, so `QINTO_COOKIE_DOMAIN`
 * exists for anything it misses.
 */
const SECOND_LEVEL_SUFFIXES = new Set([
  "ac", "co", "com", "edu", "firm", "gen", "go", "gov", "govt", "ind", "ltd", "me", "mil", "ne",
  "net", "nom", "or", "org", "plc", "sch", "web",
])

const isIpLiteral = (host: string): boolean =>
  host.startsWith("[") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)

/**
 * The registrable domain for a host: the label the merchant actually owns, plus its suffix.
 *
 * `www.shop.com` and `shop.com` both give `shop.com`. `checkout.shop.co.uk` gives `shop.co.uk`,
 * because `co` under a two-letter TLD is a public suffix rather than a name anyone registers.
 */
export const registrableDomain = (host: string): string | null => {
  const labels = host.split(".").filter(Boolean)
  if (labels.length < 2) {
    return null
  }

  const tld = labels[labels.length - 1]
  const second = labels[labels.length - 2]
  const suffixLength = tld.length === 2 && SECOND_LEVEL_SUFFIXES.has(second) ? 2 : 1

  // The host is the public suffix itself, so there is no registrable name to scope to.
  if (labels.length <= suffixLength) {
    return null
  }

  return labels.slice(labels.length - suffixLength - 1).join(".")
}

/**
 * The domain the cookie should be scoped to, or `undefined` for a host-only cookie.
 *
 * Scoped to the storefront's own registrable domain so every subdomain shares one id: a shopper who
 * lands on `shop.com`, browses `www.shop.com` and pays on `checkout.shop.com` stays one visitor
 * rather than three. It also means the id is already in place when the merchant later points Qinto
 * at a host on their own domain, with no second cookie and no migration.
 *
 * Deriving this from the request host rather than the Qinto URL is what makes it work before any DNS
 * setup. A domain taken from the collector's host is refused by the browser whenever the storefront
 * does not sit under it, which on a store reporting to `xyz.dev.qinto.tech` is always.
 *
 * `undefined` is returned for hosts that cannot carry a domain scope at all: `localhost`, IP
 * literals, and a bare public suffix. Those keep a host-only cookie, which is still first-party and
 * still persistent.
 *
 * `QINTO_COOKIE_DOMAIN` overrides the derivation entirely, for a suffix the list above does not know
 * or a merchant who wants a narrower scope. It is used as given, so it must start with a dot and the
 * storefront must sit under it.
 */
export const cookieDomainFor = (
  requestHost: string | null | undefined,
  override?: string | null
): string | undefined => {
  if (override) {
    return override
  }

  if (!requestHost) {
    return undefined
  }

  const host = requestHost.toLowerCase().split(":")[0]
  if (!host || host === "localhost" || host.endsWith(".localhost") || isIpLiteral(host)) {
    return undefined
  }

  const registrable = registrableDomain(host)

  return registrable === null ? undefined : `.${registrable}`
}

/**
 * Whether the cookie may carry `Secure`.
 *
 * A `Secure` cookie is ignored on plain http, which would mean no id at all on a local dev store, so
 * it is set whenever the request is https and omitted otherwise.
 */
export const isSecureRequest = (proto: string | null | undefined, host: string | null | undefined): boolean => {
  if (proto) {
    return proto.split(",")[0]?.trim() === "https"
  }

  const name = (host ?? "").toLowerCase().split(":")[0]

  return name !== "localhost" && name !== "127.0.0.1" && name !== "[::1]"
}

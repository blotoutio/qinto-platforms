/**
 * A store's first-party domain is the host the Blotout Platform serves its collector from, for
 * example `data.yourstore.com`. It ends up in a script tag on the storefront (`<origin>/q.js`),
 * so anything that is not exactly a host (or an https origin) is refused here rather than stored
 * and silently trimmed later.
 *
 * The Blotout Platform shows the domain without a scheme, so a bare host is accepted and https is
 * assumed; `http://` is refused. What is stored is the normalised https origin, so Admin always
 * shows the value the storefront actually uses.
 */
const MAX_LENGTH = 253
const HTTPS = "https://"

export const firstPartyOriginOrNull = (value: string): string | null => {
  const trimmed = value.trim()

  if (!trimmed || trimmed.length > MAX_LENGTH + HTTPS.length) {
    return null
  }

  const withScheme = trimmed.includes("://") ? trimmed : `${HTTPS}${trimmed}`

  try {
    const url = new URL(withScheme)
    const bareRoot = url.pathname.replace(/\/+$/, "") === ""

    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !bareRoot ||
      url.search ||
      url.hash ||
      !url.hostname.includes(".")
    ) {
      return null
    }

    return url.origin
  } catch {
    return null
  }
}

export const INVALID_FIRST_PARTY_DOMAIN =
  "Enter the site's first-party domain exactly as the Blotout Platform shows it, e.g. data.yourstore.com (no path)."

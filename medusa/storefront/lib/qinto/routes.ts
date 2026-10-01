/**
 * Which URLs mean "a product", "the checkout" and "the order confirmation".
 *
 * Three events are recognised from the path rather than from cart state, so a storefront that
 * renames those paths loses them while the rest keep working. The Medusa starter's shapes are the
 * defaults here, and a merchant who moved them passes `routes` to the component instead of forking
 * it.
 *
 * Pure and framework-free so the rules below can be tested without a router.
 */

/** A route is a pattern, a function for shapes a pattern cannot express, or `false` to disable. */
export type Matcher<T> = string | false | ((segments: string[], pathname: string) => T)

export type RouteConfig = {
  /** Yields the product handle to look up. Default `"products/:handle"`. */
  product?: Matcher<string | null | undefined>
  /** Whether this path is the checkout. Default `"checkout"`. */
  checkout?: Matcher<boolean>
  /** Yields the order id. Default `"order/:id/confirmed"`. */
  order?: Matcher<string | null | undefined>
  /**
   * How the leading country segment is recognised, or `false` for a storefront without one.
   * Default: any two-letter segment, which is what the starter emits.
   */
  countryPrefix?: boolean | ((segment: string) => boolean)
}

export const DEFAULT_ROUTES = {
  product: "products/:handle",
  checkout: "checkout",
  order: "order/:id/confirmed",
} as const

/**
 * Matches a pattern against the head of a path, returning its named parts.
 *
 * `:name` takes one segment, `*` takes everything left. Matching is a prefix: `"checkout"` matches
 * `/checkout` and `/checkout/payment` alike, because the starter walks its steps underneath the
 * same path and both are still the checkout.
 */
export const matchPattern = (
  pattern: string,
  segments: string[]
): Record<string, string> | null => {
  const parts = pattern.split("/").filter(Boolean)
  if (parts.length === 0) {
    return null
  }

  const params: Record<string, string> = {}

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]

    if (part === "*") {
      const rest = segments.slice(i)

      return rest.length === 0 ? null : { ...params, "*": rest.join("/") }
    }

    const segment = segments[i]
    if (segment === undefined || segment === "") {
      return null
    }

    if (part.startsWith(":")) {
      params[part.slice(1)] = segment
      continue
    }

    if (part.toLowerCase() !== segment.toLowerCase()) {
      return null
    }
  }

  return params
}

/**
 * The identifier a matched pattern stands for.
 *
 * One captured part is the identifier. Several are joined with `-`, which is how a Medusa handle
 * usually reads when a storefront spreads it over segments, as in `wiper-blades/toyota/corolla`
 * standing for `toyota-corolla`. A pattern that captures nothing identifies no particular thing,
 * so it yields `null` and the lookup is skipped.
 */
const identifierOf = (params: Record<string, string>): string | null => {
  const values = Object.values(params)

  return values.length === 0 ? null : values.join("-")
}

const resolve = <T,>(
  matcher: Matcher<T> | undefined,
  fallback: string,
  segments: string[],
  pathname: string,
  fromParams: (params: Record<string, string>) => T,
  empty: T
): T => {
  if (matcher === false) {
    return empty
  }

  if (typeof matcher === "function") {
    return matcher(segments, pathname)
  }

  const params = matchPattern(matcher ?? fallback, segments)

  return params === null ? empty : fromParams(params)
}

/** Splits off the leading country segment, if this storefront has one. */
export const splitCountry = (
  segments: string[],
  countryPrefix?: boolean | ((segment: string) => segment is string) | ((segment: string) => boolean)
): { country: string | null; rest: string[] } => {
  const first = segments[0]
  if (first === undefined || countryPrefix === false) {
    return { country: null, rest: segments }
  }

  const matches =
    typeof countryPrefix === "function" ? countryPrefix(first) : /^[a-z]{2}$/i.test(first)

  return matches ? { country: first, rest: segments.slice(1) } : { country: null, rest: segments }
}

export const productHandleOf = (
  routes: RouteConfig | undefined,
  segments: string[],
  pathname: string
): string | null =>
  resolve(routes?.product, DEFAULT_ROUTES.product, segments, pathname, identifierOf, null) ?? null

export const isCheckoutPath = (
  routes: RouteConfig | undefined,
  segments: string[],
  pathname: string
): boolean => resolve(routes?.checkout, DEFAULT_ROUTES.checkout, segments, pathname, () => true, false)

export const orderIdOfPath = (
  routes: RouteConfig | undefined,
  segments: string[],
  pathname: string
): string | null =>
  resolve(routes?.order, DEFAULT_ROUTES.order, segments, pathname, identifierOf, null) ?? null

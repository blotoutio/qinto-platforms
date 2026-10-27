import { NextResponse } from "next/server"
import { cookies, headers as requestHeaders } from "next/headers"
import {
  TRUID_COOKIE,
  TRUID_MAX_AGE_SECONDS,
  cookieDomainFor,
  isSecureRequest,
  newTruid,
} from "../../../../lib/qinto/truid"
import {
  CART_FIELDS,
  CUSTOMER_FIELDS,
  ORDER_FIELDS,
  isCartId,
  isOrderId,
  productFields,
  projectCart,
  projectCustomer,
  projectOrder,
  projectProduct,
} from "../../../../lib/qinto/context"

/**
 * The bridge that makes zero-wiring capture possible.
 *
 * The browser cannot read `_medusa_cart_id` — the starter sets it `httpOnly` — so it can never
 * fetch its own cart, and every cart mutation happens inside a Server Action where
 * `window.qinto` does not exist. That combination is what used to force a `track()` call into
 * eleven separate components.
 *
 * This route closes it. It runs on the storefront's own server, where the cookie *is* readable,
 * and hands the browser back the objects it needs to derive every event by itself. Adding a file
 * is not the same as editing eleven: nothing here changes a line of a merchant's existing code.
 *
 * It is deliberately read-only and returns nothing a shopper could not already see on the page —
 * and of that, only the fields tracking reads. See `lib/qinto/context` for both halves of that.
 */

const BACKEND =
  process.env.MEDUSA_BACKEND_URL ||
  process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
  "http://localhost:9000"

const KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY || ""

const headers = (token?: string): Record<string, string> => ({
  accept: "application/json",
  ...(KEY ? { "x-publishable-api-key": KEY } : {}),
  ...(token ? { authorization: `Bearer ${token}` } : {}),
})

/** Never throws, never returns a rejected promise — a failure here must not break a page. */
const get = async <T,>(path: string, token?: string): Promise<T | null> => {
  try {
    const response = await fetch(`${BACKEND}${path}`, {
      headers: headers(token),
      cache: "no-store",
    })

    return response.ok ? ((await response.json()) as T) : null
  } catch {
    return null
  }
}

/**
 * Region lookup, cached for the life of the server process.
 *
 * A product's `calculated_price` is only present when a region is supplied, and the storefront is
 * region-scoped by the country code in the URL. Without this, every ViewContent would carry
 * `value: undefined` and be silently useless to every ad platform.
 */
let regionsCache: { at: number; byCountry: Record<string, string>; fallback: string | null } | null =
  null

const regionIdFor = async (countryCode?: string | null): Promise<string | null> => {
  const fresh = regionsCache !== null && Date.now() - regionsCache.at < 5 * 60 * 1000

  if (!fresh) {
    const body = await get<{ regions?: { id: string; countries?: { iso_2: string }[] }[] }>(
      "/store/regions"
    )

    const byCountry: Record<string, string> = {}
    for (const region of body?.regions ?? []) {
      for (const country of region.countries ?? []) {
        byCountry[country.iso_2.toLowerCase()] = region.id
      }
    }

    regionsCache = { at: Date.now(), byCountry, fallback: body?.regions?.[0]?.id ?? null }
  }

  // Falls back to the store's first region rather than giving up. A country that maps to no
  // region is normal — a shopper browsing from outside the countries the merchant ships to —
  // and a price from the wrong region is still a better ViewContent than none at all.
  return (
    (countryCode ? regionsCache?.byCountry[countryCode.toLowerCase()] : null) ??
    regionsCache?.fallback ??
    null
  )
}

/**
 * Issues the first-party visitor cookie, once.
 *
 * This route is the only server surface the plugin owns in a merchant's storefront, and it is hit on
 * the first page load, so it is where the cookie is minted. An existing value is never replaced —
 * re-issuing would reset the visitor on every request and defeat the entire point.
 *
 * The value travels only in the cookie, never in a response body. Qinto reads it from the cookie, and
 * nothing in the browser needs it, so echoing it would only hand an `httpOnly` value to any script on
 * the page.
 */
const issueTruid = async (): Promise<void> => {
  const jar = await cookies()

  if (jar.get(TRUID_COOKIE)?.value) {
    return
  }

  const head = await requestHeaders()
  const host = head.get("host")
  const truid = newTruid()

  try {
    jar.set(TRUID_COOKIE, truid, {
      maxAge: TRUID_MAX_AGE_SECONDS,
      path: "/",
      httpOnly: true,
      secure: isSecureRequest(head.get("x-forwarded-proto"), host),
      // `lax`, not `strict`: the storefront's own cart and auth cookies use `lax` so they survive
      // the cross-site return from a redirect-based payment method, and a visitor id that did not
      // would be lost at exactly the moment a conversion is attributed.
      sameSite: "lax",
      ...(() => {
        const domain = cookieDomainFor(host, process.env.QINTO_COOKIE_DOMAIN)

        return domain === undefined ? {} : { domain }
      })(),
    })
  } catch {
    // Setting a cookie can throw if the response has already been committed. An un-set cookie costs
    // this visitor their id; a thrown route costs them the page.
  }
}

export const dynamic = "force-dynamic"

export const GET = async (request: Request) => {
  // Never cached, and never served to another origin: this reflects one shopper's own session.
  const noStore = { "cache-control": "no-store" }

  try {
    const url = new URL(request.url)
    const kind = url.searchParams.get("kind")
    const jar = await cookies()
    const token = jar.get("_medusa_jwt")?.value
    await issueTruid()

    if (kind === "cart") {
      const cartId = jar.get("_medusa_cart_id")?.value
      if (!isCartId(cartId)) {
        // Not an error: a first-time visitor has no cart. One shape for the client to handle.
        return NextResponse.json({ cart: null }, { headers: noStore })
      }

      const body = await get<{ cart: unknown }>(
        `/store/carts/${encodeURIComponent(cartId)}?fields=${encodeURIComponent(CART_FIELDS)}`,
        token
      )

      return NextResponse.json({ cart: projectCart(body?.cart) }, { headers: noStore })
    }

    if (kind === "product") {
      const handle = url.searchParams.get("handle")
      if (!handle) {
        return NextResponse.json({ product: null }, { headers: noStore })
      }

      const regionId = await regionIdFor(url.searchParams.get("country"))

      // `calculated_price` is only *askable* alongside a region — Medusa answers the whole
      // request with `Missing required pricing context` otherwise, losing the product too. So
      // the field is requested only when a region resolved, and a priceless ViewContent is
      // preferred over none.
      const query = new URLSearchParams({ handle, fields: productFields(regionId !== null) })
      if (regionId) {
        query.set("region_id", regionId)
      }

      const body = await get<{ products?: unknown[] }>(`/store/products?${query.toString()}`, token)

      return NextResponse.json(
        { product: projectProduct(body?.products?.[0]) },
        { headers: noStore }
      )
    }

    if (kind === "customer") {
      // No token means a guest, which is the normal case and not an error. One shape to handle.
      if (!token) {
        return NextResponse.json({ customer: null }, { headers: noStore })
      }

      const body = await get<{ customer: unknown }>(
        `/store/customers/me?fields=${encodeURIComponent(CUSTOMER_FIELDS)}`,
        token
      )

      return NextResponse.json({ customer: projectCustomer(body?.customer) }, { headers: noStore })
    }

    if (kind === "order") {
      const id = url.searchParams.get("id")
      if (!isOrderId(id)) {
        return NextResponse.json({ order: null }, { headers: noStore })
      }

      const body = await get<{ order: unknown }>(
        `/store/orders/${encodeURIComponent(id)}?fields=${encodeURIComponent(ORDER_FIELDS)}`,
        token
      )

      return NextResponse.json({ order: projectOrder(body?.order) }, { headers: noStore })
    }

    return NextResponse.json({ error: "unknown kind" }, { status: 400, headers: noStore })
  } catch {
    // Same contract as the rest of the kit: unconfigured or broken is a no-op, never a 500 on a
    // route a shopper's page is calling.
    return NextResponse.json({}, { headers: noStore })
  }
}

"use client"

import { usePathname, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useRef, useState } from "react"
import { getQintoUrl, identify, setQintoUrl, track } from "../../lib/qinto/client"
import {
  cartEvent,
  cartTraits,
  compact,
  customerTraits,
  orderIdOf,
  orderTraits,
  purchase,
  viewContent,
  type Traits,
} from "../../lib/qinto/mapping"
import { NO_CART, diffEvents, snapshotOf, type Snapshot } from "../../lib/qinto/cart-diff"
import { traitsFrom } from "../../lib/qinto/form-traits"
import type { HttpTypes } from "@medusajs/types"

/**
 * The whole funnel, from one mount.
 *
 * Mounted once in `app/layout.tsx`; nothing else in the storefront is touched, ever. The previous
 * kit put a `track()` call into eleven components because the browser could not see a cart —
 * `_medusa_cart_id` is `httpOnly` and every mutation runs inside a Server Action. Both are
 * routed around here: `/api/qinto/context` reads the cookie on the storefront's own server, and
 * React dispatches Server Actions through `fetch`, so their completion is observable.
 *
 * Every event is therefore *derived* rather than *declared*. The cost is one small same-origin
 * request per mutation; the gain is that a merchant who restyles their product page, renames a
 * component or upgrades the starter does not silently lose tracking.
 */

const BACKEND = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL || "http://localhost:9000"
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY || ""

/** Mirrors `qinto-analytics.tsx` — see the note there on why the URL is serialised, not spliced. */
const loader = (qintoUrl: string) => {
  const src = JSON.stringify(new URL("/q.js", qintoUrl).toString())

  return `
(function(w,d,u,g){if(g in w){var o=w[g];
if(!(o&&o._q))console.error("window."+g+" is already in use");return}
var t={_q:1,q:[]};
Object.defineProperty(w,g,{value:new Proxy(t,{get:function(o,n){
if(typeof n!="string"||n=="then"||n=="ready"||n=="config"||n in o)return o[n];
return o[n]=function(){var a=arguments;var p=new Promise(function(res,rej){o.q.push([n,a,res,rej])});p.catch(function(){});return p}}}),writable:true,enumerable:true,configurable:true});
var s=d.createElement("script");s.async=true;s.src=u;s.dataset.qintoGlobal=g;
d.head.appendChild(s)})(window,document,${src},"qinto");
`
}

/* ------------------------------------------------------------------ once-only bookkeeping */

/**
 * Survives a reload, so a refreshed confirmation page cannot re-send a Purchase and a refreshed
 * cart page cannot re-send its lines as fresh adds. Wrapped because storage throws in a private
 * window, and losing dedupe is better than losing the page.
 */
const SENT_KEY = "qinto_sent_v1"
const CART_KEY = "qinto_cart_v1"

/**
 * Whether the previous route was already the checkout.
 *
 * Kept in storage rather than a ref so it survives a reload: refreshing the payment step is not
 * arriving at the checkout, and a ref would forget that and report it as one.
 */
const ON_CHECKOUT_KEY = "qinto_on_checkout_v1"

const readStore = <T,>(key: string, fallback: T): T => {
  try {
    const raw = sessionStorage.getItem(key)

    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

const writeStore = (key: string, value: unknown): void => {
  try {
    sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private window, or storage disabled. Dedupe degrades to per-render; nothing else breaks.
  }
}

const once = (key: string, run: () => void): void => {
  const sent = readStore<string[]>(SENT_KEY, [])
  if (sent.includes(key)) {
    return
  }

  // Recorded *before* sending. A throw inside `run` must not leave the key unrecorded, or a
  // remount would retry it forever; `track` is non-throwing anyway, so this only ever helps.
  writeStore(SENT_KEY, [...sent.slice(-200), key])
  run()
}

/* ------------------------------------------------------------------ cart snapshots */

/**
 * The diff lives in `lib/qinto/cart-diff` — pure, framework-free and unit-tested.
 *
 * It returns events rather than sending them, so the rules about what counts as an add, a removal
 * or a starting position can be asserted without a browser. This component only forwards them.
 */

/* ------------------------------------------------------------------ the component */

const context = async <T,>(query: string): Promise<T | null> => {
  try {
    const response = await fetch(`/api/qinto/context?${query}`, { cache: "no-store" })

    return response.ok ? ((await response.json()) as T) : null
  } catch {
    return null
  }
}

const Capture = () => {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const lastPageView = useRef<string | null>(null)
  const busy = useRef(false)

  /** Re-reads the cart and emits whatever changed. Serialised: overlapping reads double-count. */
  const syncCart = async (): Promise<HttpTypes.StoreCart | null> => {
    if (busy.current) {
      return null
    }

    busy.current = true
    try {
      const body = await context<{ cart: HttpTypes.StoreCart | null }>("kind=cart")
      const cart = body?.cart ?? null

      if (cart === null) {
        // Recorded rather than ignored: this is the observation that lets the next sync report the
        // first add instead of treating it as a starting position.
        writeStore(CART_KEY, NO_CART)

        return null
      }

      const next = snapshotOf(cart)
      for (const event of diffEvents(cart, readStore<Snapshot | null>(CART_KEY, null), next)) {
        track(event.name, event.properties)
      }
      writeStore(CART_KEY, next)

      return cart
    } finally {
      busy.current = false
    }
  }

  // PageView, and the route-derived events.
  useEffect(() => {
    const query = searchParams.toString()
    const url = query === "" ? pathname : `${pathname}?${query}`
    if (url === lastPageView.current) {
      return
    }

    lastPageView.current = url

    // Deferred one macrotask so `document.title` is the new route's, not the previous one's:
    // this effect can run before Next has applied the new route's metadata.
    //
    // **A timer, not `requestAnimationFrame`.** rAF does not run while the tab is in the
    // background, so a product opened in a new tab sent every other event and no PageView — and
    // an earlier version also cancelled the frame on cleanup, which React 18 StrictMode's
    // mount/cleanup/mount turned into *never* sending one. Timers run in hidden tabs, throttled
    // but reliable, and the ordering guarantee is the same.
    setTimeout(() => {
      track("PageView", { path: url, title: document.title })
    }, 0)

    const segments = pathname.split("/").filter(Boolean)
    const country = /^[a-z]{2}$/i.test(segments[0] ?? "") ? segments[0] : null
    const rest = country === null ? segments : segments.slice(1)

    /**
     * Did this navigation *enter* the checkout, rather than move around inside it?
     *
     * The starter walks its steps by changing `?step=` on the same path, so a route change alone
     * says nothing. What matters is the transition: checkout reached from somewhere that was not
     * checkout. Recorded for every route, not just checkout, or leaving and returning would look
     * like staying.
     */
    const onCheckout = rest[0] === "checkout"
    const wasOnCheckout = readStore<boolean>(ON_CHECKOUT_KEY, false)
    const enteredCheckout = onCheckout && !wasOnCheckout
    writeStore(ON_CHECKOUT_KEY, onCheckout)

    void (async () => {
      if (rest[0] === "products" && rest[1]) {
        const body = await context<{ product: HttpTypes.StoreProduct | null }>(
          `kind=product&handle=${encodeURIComponent(rest[1])}${country ? `&country=${country}` : ""}`
        )
        const product = body?.product ?? null
        if (product !== null) {
          // Not run through `once`: revisiting a product later in the same session is a real
          // second view. The pathname guard above is what stops a re-render duplicating it.
          track(
            "ViewContent",
            viewContent(
              product,
              product.variants?.[0] ?? undefined,
              product.variants?.[0]?.calculated_price?.currency_code
            )
          )
        }

        // Deliberately falls through to the cart sync below. Returning here meant a product page
        // never recorded the cart state, so a first add had no prior observation to diff against
        // and was reported as a starting position instead of an add.
      }

      // `/order/<id>/confirmed` — the conversion.
      else if (rest[0] === "order" && rest[1] && rest[2] === "confirmed") {
        const body = await context<{ order: HttpTypes.StoreOrder | null }>(
          `kind=order&id=${encodeURIComponent(rest[1])}`
        )
        const order = body?.order ?? null
        if (order !== null) {
          once(`Purchase:${orderIdOf(order)}`, () => {
            identify(orderTraits(order))
            track("Purchase", purchase(order))
          })
        }

        // The cart is gone once an order exists; clearing the snapshot stops the next cart
        // being diffed against a dead one and reported as a pile of removals.
        writeStore(CART_KEY, null)

        return
      }

      const cart = await syncCart()

      // Fired once per *arrival* at the checkout, and again every time the shopper comes back.
      //
      // Not run through `once()`: returning to checkout later is a real second initiation and
      // should count. What is filtered out is movement *within* the checkout — address → delivery →
      // payment → review are four route changes and one initiation.
      if (cart !== null && enteredCheckout && (cart.items ?? []).length > 0) {
        identify(cartTraits(cart))
        track("InitiateCheckout", cartEvent(cart))
      }
    })()
  }, [pathname, searchParams])

  /**
   * Identifies a signed-in shopper, once per session per customer.
   *
   * This is the reliable half of identity: it works on a returning visit where no form is ever
   * submitted, and it reads the customer Medusa itself resolved from the session rather than
   * whatever was typed into a field. The form listener below covers the other half — the moment of
   * signing up or signing in, before any of this is true yet.
   */
  useEffect(() => {
    void (async () => {
      const body = await context<{ customer: HttpTypes.StoreCustomer | null }>("kind=customer")
      const customer = body?.customer ?? null
      if (customer === null) {
        return
      }

      const traits = customerTraits(customer)
      if (Object.keys(traits).length > 0) {
        once(`identify:${customer.id}`, () => identify(traits, customer.id))
      }
    })()
  }, [pathname])

  /**
   * Identity from any form a shopper submits — register, login, and each of the profile forms.
   *
   * One capture-phase listener on `document`, so it sees submissions from components this plugin
   * never touches. That is what keeps login and registration working with no storefront edit.
   *
   * **Only these four field names are ever read.** The form is not enumerated and no other input is
   * inspected, so a password, a card number or a token in the same form cannot be picked up by
   * accident — adding a field to this list is the only way to widen what is collected, which is
   * deliberate. `FormData` is read from a clone-free snapshot at submit time; nothing is stored.
   */
  useEffect(() => {
    const onSubmit = (event: Event) => {
      const form = event.target
      if (!(form instanceof HTMLFormElement)) {
        return
      }

      try {
        const data = new FormData(form)
        const traits = traitsFrom((name) => {
          const value = data.get(name)

          return typeof value === "string" ? value : undefined
        })

        if (Object.keys(traits).length === 0) {
          return
        }

        identify(traits)

        // A form that asks for a name *and* a password is a sign-up; one that asks for a password
        // alone is a sign-in, and a profile form has no password at all. Keyed on the email so a
        // failed first attempt and its retry count once.
        const hasPassword = form.querySelector('input[type="password"]') !== null
        const hasName = traits.firstName !== undefined || traits.lastName !== undefined

        if (hasPassword && hasName) {
          once(`CompleteRegistration:${traits.email ?? "anonymous"}`, () =>
            track("CompleteRegistration")
          )
        }
      } catch {
        // A form that FormData refuses is not a reason to break a shopper's sign-in.
      }
    }

    // Capture phase: a submit handler that calls `preventDefault` — which every Server Action form
    // effectively does — would otherwise stop this from ever running.
    document.addEventListener("submit", onSubmit, true)

    return () => document.removeEventListener("submit", onSubmit, true)
  }, [])

  /**
   * Detects a completed Server Action, and re-reads the cart.
   *
   * **Not by patching `window.fetch`.** That was the first attempt and it silently never fired:
   * Next's runtime captures its own reference to `fetch` while the framework boots, long before a
   * component effect can replace the global, so the patch observes nothing. Verified against the
   * running store — a successful add-to-cart produced no interception at all.
   *
   * `PerformanceObserver` has no such ordering problem: it reports every resource the page fetched
   * regardless of who issued it or when we started listening. A Server Action is a `fetch` to the
   * page's own URL, which is what is matched here. RSC prefetches share that shape and will cause
   * an occasional extra read — harmless, because an unchanged cart diffs to no events.
   */
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null

    const settle = () => {
      if (timer !== null) {
        clearTimeout(timer)
      }
      // Coalesced: one interaction can fire several actions, and the cart is only settled after
      // the last of them.
      timer = setTimeout(() => void syncCart(), 250)
    }

    let observer: PerformanceObserver | null = null
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const resource = entry as PerformanceResourceTiming
          if (resource.initiatorType !== "fetch" && resource.initiatorType !== "xmlhttprequest") {
            continue
          }

          // Same path as the page itself → a Server Action or an RSC round trip, either of which
          // may have changed the cart. Compared on pathname so a query string cannot hide it.
          try {
            if (new URL(resource.name).pathname === window.location.pathname) {
              settle()

              return
            }
          } catch {
            // A relative or opaque entry name — nothing to match on.
          }
        }
      })

      observer.observe({ type: "resource", buffered: true })
    } catch {
      // No PerformanceObserver (or the entry type is unsupported). The route-change sync below
      // still covers every navigation, so tracking degrades rather than stops.
    }

    return () => {
      observer?.disconnect()
      if (timer !== null) {
        clearTimeout(timer)
      }
    }
  }, [])

  return null
}

const QintoAutoCapture = () => {
  const [ready, setReady] = useState(getQintoUrl() !== null)
  const injected = useRef(false)

  useEffect(() => {
    if (getQintoUrl() !== null) {
      setReady(true)

      return
    }

    void fetch(`${BACKEND}/store/qinto/config`, {
      headers: PUBLISHABLE_KEY ? { "x-publishable-api-key": PUBLISHABLE_KEY } : {},
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((config: { enabled?: boolean; qinto_url?: string } | null) => {
        if (config?.enabled && config.qinto_url) {
          setQintoUrl(config.qinto_url)
          setReady(true)
        }
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const url = getQintoUrl()
    if (!ready || injected.current || url === null) {
      return
    }

    injected.current = true

    let snippet: string
    try {
      snippet = loader(url)
    } catch {
      return
    }

    const script = document.createElement("script")
    script.id = "qinto-loader"
    script.textContent = snippet
    document.head.appendChild(script)
  }, [ready])

  if (!ready) {
    return null
  }

  return (
    <Suspense fallback={null}>
      <Capture />
    </Suspense>
  )
}

export default QintoAutoCapture

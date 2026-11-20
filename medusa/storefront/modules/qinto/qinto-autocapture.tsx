"use client"

import { usePathname, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useRef, useState } from "react"
import { identify, tagReady, track } from "../../lib/qinto/client"
import {
  cartEvent,
  cartTraits,
  compact,
  customerAliases,
  customerTraits,
  orderTraits,
  purchase,
  viewContent,
  type Traits,
} from "../../lib/qinto/mapping"
import {
  NO_CART,
  asSnapshot,
  diffEvents,
  reportChoice,
  shippingChoice,
  snapshotOf,
  type CheckoutState,
} from "../../lib/qinto/cart-diff"
import { purchaseAction, remember } from "../../lib/qinto/dedupe"
import { paymentOptionOfFrame, paymentOptionOfLabel } from "../../lib/qinto/payment-option"
import { filledIdentity, IDENTITY_NAMES, traitsFrom } from "../../lib/qinto/form-traits"
import {
  isCheckoutPath,
  orderIdOfPath,
  productHandleOf,
  splitCountry,
  type RouteConfig,
} from "../../lib/qinto/routes"
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

/**
 * The collector's loader snippet. The script URL is built with `URL` and serialised with
 * `JSON.stringify` rather than spliced in as text, so a stored value can never break out of the
 * string literal.
 */
const loader = (firstPartyOrigin: string) => {
  const src = JSON.stringify(new URL("/q.js", firstPartyOrigin).toString())

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

/** The cart as last seen, in every tab, so one tab's add is not reported again by another. */
const CART_KEY = "qinto_cart_v1"

/** Orders whose Purchase this browser has sent, in every tab and after a restart. */
const PURCHASED_KEY = "qinto_purchased_v1"

/** How long a Purchase sent before the tag connected keeps waiting for it, to claim the order. */
const LATE_CLAIM_MS = 60_000

/** Fingerprint of the checkout details last identified, so unchanged details are not resent. */
const FILLED_KEY = "qinto_filled_v1"

// Long enough that tabbing through the address fields sends one identify, not one per field.
const FILLED_DELAY_MS = 1500

/** The first non-empty value of any field with this name, inside a `<form>` or not. */
const fieldValue = (name: string): string | undefined =>
  Array.from(document.getElementsByName(name), (el) => (el as HTMLInputElement).value).find(
    (value) => typeof value === "string" && value.trim() !== ""
  )

const PAYMENT_CONTROLS = '[role="tab"], [role="radio"], input[type="radio"], button'

const onCheckoutNow = (routes: RouteConfig | undefined): boolean => {
  const pathname = window.location.pathname
  const { rest } = splitCountry(pathname.split("/").filter(Boolean), routes?.countryPrefix)

  return isCheckoutPath(routes, rest, pathname)
}

/** The visible name of a payment control. */
const labelOf = (control: Element): string | null => {
  if (control instanceof HTMLInputElement) {
    return control.labels?.[0]?.textContent ?? null
  }

  const named = document.getElementById(control.getAttribute("aria-labelledby") ?? "")

  return control.getAttribute("aria-label") ?? named?.textContent ?? control.textContent
}

/** Whether a person acted in the last few seconds; `true` where the browser cannot say. */
const shopperActed = (): boolean =>
  (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive ?? true

/**
 * Where values go when storage throws (blocked, or a private mode that refuses it): dedupe still
 * holds for the life of the page, across its client-side navigations, instead of per render.
 */
const memory = new Map<string, unknown>()

const read = <T,>(area: () => Storage, key: string, fallback: T): T => {
  try {
    const raw = area().getItem(key)

    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return memory.has(key) ? (memory.get(key) as T) : fallback
  }
}

const write = (area: () => Storage, key: string, value: unknown): void => {
  try {
    area().setItem(key, JSON.stringify(value))
  } catch {
    memory.set(key, value)
  }
}

const readStore = <T,>(key: string, fallback: T): T => read(() => sessionStorage, key, fallback)
const writeStore = (key: string, value: unknown): void => write(() => sessionStorage, key, value)

/**
 * `localStorage`: shared by every tab of this browser and kept after a restart. Used for what must
 * happen once per order or cart, not once per tab. Same fallbacks as above.
 */
const readShared = <T,>(key: string, fallback: T): T => read(() => localStorage, key, fallback)
const writeShared = (key: string, value: unknown): void => write(() => localStorage, key, value)

/** Whether this browser already sent this order's Purchase, in any tab or an older version's. */
const purchased = (key: string): boolean => {
  const shared = readShared<unknown>(PURCHASED_KEY, [])

  return (Array.isArray(shared) && shared.includes(key)) || readStore<string[]>(SENT_KEY, []).includes(key)
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

const Capture = ({ routes }: { routes?: RouteConfig }) => {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const lastPageView = useRef<string | null>(null)
  const busy = useRef(false)
  // Traits of the cart as last read, so a field edit needs no request of its own.
  const savedTraits = useRef<Traits>({})
  // The shipping and payment steps already reported for this cart. Per page on purpose: a reload or
  // a new tab may report them again, but switching options on the same page does not.
  const reportedSteps = useRef<CheckoutState | null>(null)
  // Whether the previous route of this page was the checkout. A ref, not storage, on purpose: a
  // reload of the checkout is a new InitiateCheckout, as on Shopify.
  const wasOnCheckout = useRef(false)

  // Read through a ref so the listeners registered once below always see the current routes.
  const routesRef = useRef(routes)
  routesRef.current = routes

  /** Sends a checkout step's event once per cart per page, and only while the shopper is in the checkout. */
  const reportStep = (
    cart: HttpTypes.StoreCart | null,
    step: "shipping" | "payment",
    choice: string,
    event: string
  ): void => {
    if (cart === null || (cart.items ?? []).length === 0 || !onCheckoutNow(routesRef.current)) {
      return
    }

    const next = reportChoice(cart, reportedSteps.current, step, choice)
    if (next !== null) {
      reportedSteps.current = next
      track(event, cartEvent(cart))
    }
  }

  const reportShipping = (cart: HttpTypes.StoreCart | null): void =>
    reportStep(cart, "shipping", cart === null ? "" : shippingChoice(cart), "AddShippingInfo")

  /**
   * Identifies the shopper from the checkout as soon as the details are filled in, no submit needed.
   *
   * Many checkouts have no `<form>` and pay from a button, and an address picked from a search box
   * never reaches an input, so the visible fields are merged over the cart as last read. Every save
   * is a Server Action that re-reads the cart, so that copy is current without a request here. Traits
   * only, no alias: nothing is verified until the order exists.
   */
  const identifyFilled = (): void => {
    if (!onCheckoutNow(routesRef.current)) {
      return
    }

    const next = filledIdentity(savedTraits.current, traitsFrom(fieldValue), readStore(FILLED_KEY, ""))
    if (next !== null) {
      writeStore(FILLED_KEY, next.key)
      identify(next.traits)
    }
  }

  /** Re-reads the cart and emits whatever changed. Serialised: overlapping reads double-count. */
  const syncCart = async (): Promise<HttpTypes.StoreCart | null> => {
    if (busy.current) {
      return null
    }

    busy.current = true
    try {
      const body = await context<{ cart: HttpTypes.StoreCart | null }>("kind=cart")
      const cart = body?.cart ?? null
      savedTraits.current = cart === null ? {} : cartTraits(cart)

      if (cart === null) {
        // Recorded rather than ignored: this is the observation that lets the next sync report the
        // first add instead of treating it as a starting position.
        writeShared(CART_KEY, { ...NO_CART, at: Date.now() })

        return null
      }

      const next = snapshotOf(cart)
      for (const event of diffEvents(cart, asSnapshot(readShared<unknown>(CART_KEY, null)), next)) {
        track(event.name, event.properties)
      }
      writeShared(CART_KEY, { ...next, at: Date.now() })

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
    const { country, rest } = splitCountry(segments, routes?.countryPrefix)

    /**
     * Did this navigation *enter* the checkout, rather than move around inside it?
     *
     * The starter walks its steps by changing `?step=` on the same path, so a route change alone
     * says nothing. What matters is the transition: checkout reached from somewhere that was not
     * checkout, or the checkout page loaded afresh (a reload, a new tab). Recorded for every route,
     * not just checkout, or leaving and returning would look like staying.
     */
    const onCheckout = isCheckoutPath(routes, rest, pathname)
    const enteredCheckout = onCheckout && !wasOnCheckout.current
    wasOnCheckout.current = onCheckout

    void (async () => {
      const productHandle = productHandleOf(routes, rest, pathname)
      const confirmedOrderId = productHandle === null ? orderIdOfPath(routes, rest, pathname) : null

      if (productHandle !== null) {
        const body = await context<{ product: HttpTypes.StoreProduct | null }>(
          `kind=product&handle=${encodeURIComponent(productHandle)}${country ? `&country=${country}` : ""}`
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

      // `/order/<id>/confirmed` — the conversion. Sent once per order, whichever tab, browser or
      // device shows this page.
      else if (confirmedOrderId !== null) {
        // The cart is gone once an order exists; clearing the snapshot stops the next cart
        // being diffed against a dead one and reported as a pile of removals.
        writeShared(CART_KEY, null)

        const key = `Purchase:${confirmedOrderId}`
        if (purchased(key)) {
          return
        }

        // The backend claim rides on the order read this page makes anyway. It is only asked for
        // once the tag can send, so a blocked or failed tag never spends it.
        const read = `kind=order&id=${encodeURIComponent(confirmedOrderId)}`
        const ready = await tagReady()
        const body = await context<{ order: HttpTypes.StoreOrder | null; first?: boolean | null }>(
          ready ? `${read}&claim=1` : read
        )
        const order = body?.order ?? null
        if (order === null) {
          return
        }

        // Re-read after the wait: another view may have marked it meanwhile. Only a view without a
        // claim answer defers to that mark; the claim's winner sends regardless (see purchaseAction).
        const action = purchaseAction(body?.first, purchased(key))
        writeShared(PURCHASED_KEY, remember(readShared<unknown>(PURCHASED_KEY, []), key))
        if (action === "send") {
          // A placed order is a verified identity, so its email is aliased as well as sent as a
          // trait — one of the three moments (login, sign-up, order) an alias is safe to send.
          identify(orderTraits(order), { alias: [order.email] })
          track("Purchase", purchase(order))

          // Sent unclaimed because the tag was slow: claim once it connects, so other devices skip.
          // A blocked tag never connects, so it never claims and another device can still send.
          if (!ready) {
            void tagReady(LATE_CLAIM_MS).then((late) => (late ? context(`${read}&claim=1`) : null))
          }
        }

        return
      }

      const cart = await syncCart()

      // Fired once per *arrival* at the checkout (including a reload of it), and again every time the
      // shopper comes back.
      //
      // Not run through `once()`: returning to checkout later is a real second initiation and
      // should count. What is filtered out is movement *within* the checkout — address → delivery →
      // payment → review are four route changes and one initiation.
      if (cart !== null && enteredCheckout && (cart.items ?? []).length > 0) {
        identify(cartTraits(cart))
        track("InitiateCheckout", cartEvent(cart))
      }

      reportShipping(cart)
    })()
  }, [pathname, searchParams, routes])

  /**
   * Identifies a signed-in shopper, once per session per customer.
   *
   * This is the reliable half of identity: it works on a returning visit where no form is ever
   * submitted, and it reads the customer Medusa itself resolved from the session rather than
   * whatever was typed into a field. The form listener below covers the other half — the moment of
   * signing up or signing in, before any of this is true yet.
   *
   * Because Medusa has verified the session, this is where the browser is linked to the person:
   * the email and then the customer id are aliased, after the identify has landed — email first, so a
   * shopper who checked out as a guest joins that person rather than splitting off a new one (see
   * `customerAliases`). The form
   * listener sends traits only, never an alias.
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
        once(`identify:${customer.id}`, () =>
          identify(traits, { alias: customerAliases(customer) })
        )
      }
    })()
  }, [pathname])

  /**
   * Identity from any form a shopper submits — register, login, and each of the profile forms.
   *
   * One capture-phase listener on `document`, so it sees submissions from components this plugin
   * never touches. That is what keeps login and registration working with no storefront edit.
   *
   * **Only the field names in `IDENTITY_FIELDS` (`lib/qinto/form-traits`) are ever read.** The form
   * is not enumerated and no other input is inspected, so a password, a card number or a token in the
   * same form cannot be picked up by accident — adding a field to that table is the only way to widen
   * what is collected, which is deliberate. `FormData` is read from a clone-free snapshot at submit time; nothing is stored.
   */
  useEffect(() => {
    const onSubmit = (event: Event) => {
      const form = event.target
      if (!(form instanceof HTMLFormElement)) {
        return
      }

      // The checkout's own fields go through the same check as a field edit, so a save sends nothing twice.
      if (onCheckoutNow(routesRef.current)) {
        identifyFilled()
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

        // Traits only, deliberately no alias: this runs before the submit has succeeded, so the
        // email may be mistyped, rejected or someone else's, and an alias cannot be taken back.
        // The verified identity is aliased once Medusa resolves the customer or the order.
        identify(traits)

        // A form that asks for a name *and* a password is a sign-up; one that asks for a password
        // alone is a sign-in, and a profile form has no password at all. Keyed on the email so a
        // failed first attempt and its retry count once.
        const hasPassword = form.querySelector('input[type="password"]') !== null
        const hasName = traits.first_name !== undefined || traits.last_name !== undefined

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

  // A text field fires `change` when the shopper leaves it, so nothing is read per keystroke.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null

    const onChange = (event: Event) => {
      const name = (event.target as HTMLInputElement | null)?.name
      if (name === undefined || !IDENTITY_NAMES.has(name)) {
        return
      }

      if (timer !== null) {
        clearTimeout(timer)
      }
      timer = setTimeout(identifyFilled, FILLED_DELAY_MS)
    }

    document.addEventListener("change", onChange, true)

    return () => {
      document.removeEventListener("change", onChange, true)
      if (timer !== null) {
        clearTimeout(timer)
      }
    }
  }, [])

  /** AddPaymentInfo: a real click on a payment option, or focus moving into a provider's card form. */
  useEffect(() => {
    const report = async (option: string | null): Promise<void> => {
      if (option === null || !onCheckoutNow(routesRef.current)) {
        return
      }

      const cart = (await context<{ cart: HttpTypes.StoreCart | null }>("kind=cart"))?.cart ?? null
      savedTraits.current = cart === null ? {} : cartTraits(cart)
      reportStep(cart, "payment", option, "AddPaymentInfo")
    }

    const onClick = (event: Event) => {
      const control =
        event.isTrusted && event.target instanceof Element ? event.target.closest(PAYMENT_CONTROLS) : null
      if (control !== null) {
        void report(paymentOptionOfLabel(labelOf(control)))
      }
    }

    // Deferred: `activeElement` only points at the frame once the blur has finished.
    const onBlur = () =>
      setTimeout(() => {
        const frame = document.activeElement
        if (frame instanceof HTMLIFrameElement && shopperActed()) {
          void report(paymentOptionOfFrame(frame.src, frame.name))
        }
      }, 0)

    document.addEventListener("click", onClick, true)
    window.addEventListener("blur", onBlur)

    return () => {
      document.removeEventListener("click", onClick, true)
      window.removeEventListener("blur", onBlur)
    }
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
      timer = setTimeout(
        () =>
          void syncCart().then((cart) => {
            reportShipping(cart)
            // A saved address (say, picked from a search box) is only visible here.
            if (cart !== null) {
              identifyFilled()
            }
          }),
        250
      )
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

const QintoAutoCapture = ({ routes }: { routes?: RouteConfig } = {}) => {
  // The store's first-party domain, as the https origin the backend reports for this storefront's
  // publishable key. The backend is the only source, so Admin → Blotout is always the whole truth.
  const [origin, setOrigin] = useState<string | null>(null)
  const injected = useRef(false)

  useEffect(() => {
    void fetch(`${BACKEND}/store/qinto/config`, {
      headers: PUBLISHABLE_KEY ? { "x-publishable-api-key": PUBLISHABLE_KEY } : {},
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((config: { enabled?: boolean; first_party_domain?: string } | null) => {
        if (config?.enabled && config.first_party_domain) {
          setOrigin(config.first_party_domain)
        }
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (injected.current || origin === null) {
      return
    }

    injected.current = true

    let snippet: string
    try {
      snippet = loader(origin)
    } catch {
      return
    }

    const script = document.createElement("script")
    script.id = "qinto-loader"
    script.textContent = snippet
    document.head.appendChild(script)
  }, [origin])

  if (origin === null) {
    return null
  }

  return (
    <Suspense fallback={null}>
      <Capture routes={routes} />
    </Suspense>
  )
}

export default QintoAutoCapture

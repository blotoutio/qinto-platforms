import type { MedusaStoreRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { qintoService } from "../../../../lib/service"

/**
 * The storefront's configuration, served publicly.
 *
 * A storefront asks the backend where to send events rather than carrying its own environment
 * variable, so a merchant can connect, switch or pause a store from Admin without a redeploy.
 * Everything here is already public: the first-party domain is visible in the page source of any
 * storefront that loads the collector from it.
 *
 * **Per storefront.** Medusa runs its publishable-key middleware on every `/store` route, so by
 * the time this runs `publishable_key_context` holds the sales channels behind the caller's key.
 * The key is sent by the storefront's browser and its server alike, which is why it, and not the
 * Origin header, decides.
 *
 * Returns `enabled: false` rather than a 404 when the store is not configured, so the storefront
 * has one shape to handle instead of two.
 */
export const GET = async (req: MedusaStoreRequest, res: MedusaResponse) => {
  // The answer differs per storefront, so a shared cache must never hand one store's destination
  // to another.
  res.setHeader("Cache-Control", "private, max-age=60")
  // Appended, not set: Medusa's CORS middleware has already added `Vary: Origin`.
  res.vary("x-publishable-api-key")

  try {
    const destination = await qintoService(req.scope).resolveFor(
      req.publishable_key_context?.sales_channel_ids ?? []
    )

    // `firstPartyDomain` is already null whenever the store is off.
    res.json({ enabled: destination.enabled, first_party_domain: destination.firstPartyDomain })
  } catch (error: unknown) {
    // A storefront calls this on every page load. Answering "off" costs analytics; a 500 here
    // would show up in the merchant's error monitoring as a failing store endpoint. The cause is
    // logged so "tracking stopped" is never silent on the server.
    const reason = error instanceof Error ? error.message : String(error)

    req.scope
      .resolve(ContainerRegistrationKeys.LOGGER)
      .error(`Blotout: could not resolve the first-party domain for a storefront: ${reason}`)
    res.json({ enabled: false, first_party_domain: null })
  }
}

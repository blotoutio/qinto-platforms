import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { INVALID_FIRST_PARTY_DOMAIN, firstPartyOriginOrNull } from "../../../../../lib/url"
import { qintoService } from "../../../../../lib/service"

/**
 * Sets one store's first-party domain and/or its Tracking switch.
 *
 * `first_party_domain` takes a bare host such as `data.yourstore.com` or an https origin, and is
 * stored as the https origin. Saving a domain also turns the store's tracking on; a body with only
 * `enabled` never changes the domain. `first_party_domain: null` clears it, which stops the store.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const salesChannelId = req.params.id
  const body = (req.body ?? {}) as Record<string, unknown>
  const { first_party_domain: firstPartyDomain, enabled } = body

  if (firstPartyDomain === undefined && enabled === undefined) {
    res.status(400).json({ message: "Send first_party_domain, enabled, or both." })

    return
  }

  // An empty string clears the domain, the same as null. Anything else must be a bare host or an
  // https origin, and the normalised https origin is what gets stored.
  let origin: string | null | undefined

  if (firstPartyDomain === null || firstPartyDomain === "") {
    origin = null
  } else if (firstPartyDomain !== undefined) {
    origin = typeof firstPartyDomain === "string" ? firstPartyOriginOrNull(firstPartyDomain) : null

    if (origin === null) {
      res.status(400).json({ message: INVALID_FIRST_PARTY_DOMAIN })

      return
    }
  }

  if (enabled !== undefined && typeof enabled !== "boolean") {
    res.status(400).json({ message: "enabled must be true or false." })

    return
  }

  const salesChannels = req.scope.resolve(Modules.SALES_CHANNEL)
  const [channel] = await salesChannels.listSalesChannels({ id: salesChannelId })

  if (!channel) {
    res.status(404).json({ message: `Sales channel ${salesChannelId} was not found.` })

    return
  }

  const saved = await qintoService(req.scope).saveChannelRow(salesChannelId, {
    ...(origin !== undefined ? { first_party_domain: origin } : {}),
    ...(typeof enabled === "boolean" ? { enabled } : {}),
  })

  res.json(saved)
}

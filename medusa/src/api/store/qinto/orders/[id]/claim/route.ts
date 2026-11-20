import type { MedusaStoreRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { claimability, isOrderId, type ClaimOrder } from "../../../../../../lib/purchase-claim"
import { qintoService } from "../../../../../../lib/service"

/**
 * Claims the Purchase for an order, so it is sent once whichever tab, browser or device shows the
 * confirmation page. Called by the storefront's context route as part of the order read the page
 * already makes, never directly by the browser.
 *
 * `{ first: true }` only for the first claim of a recent order of this storefront. Errors are a
 * 500, which the storefront reads as "no answer" and falls back to the browser's own memory.
 */
export const POST = async (req: MedusaStoreRequest, res: MedusaResponse) => {
  res.setHeader("Cache-Control", "no-store")

  const id = req.params.id
  if (!isOrderId(id)) {
    res.status(400).json({ first: false })

    return
  }

  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "order",
      fields: ["id", "created_at", "sales_channel_id"],
      filters: { id },
    })

    const verdict = claimability(
      data[0] as ClaimOrder | undefined,
      req.publishable_key_context?.sales_channel_ids ?? [],
      Date.now()
    )

    if (verdict === "not_found" || verdict === "other_store") {
      // The same answer for both, so a key cannot probe another storefront's order ids.
      res.status(404).json({ first: false })

      return
    }

    res.json({ first: verdict === "claimable" ? await qintoService(req.scope).claimPurchase(id) : false })
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error)

    req.scope
      .resolve(ContainerRegistrationKeys.LOGGER)
      .error(`Blotout: could not claim the Purchase for an order: ${reason}`)
    res.status(500).json({ first: null })
  }
}

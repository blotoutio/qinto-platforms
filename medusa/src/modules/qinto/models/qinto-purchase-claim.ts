import { model } from "@medusajs/framework/utils"

/**
 * One row per order whose Purchase a storefront has sent.
 *
 * The unique `order_id` is the whole mechanism: the first confirmation page view inserts the row
 * and sends the Purchase; every later view (another tab, browser or device) finds it and does not.
 * A table of its own rather than `order.metadata`, so the claim is atomic across server instances
 * without a lock and the merchant's order data is never touched.
 */
export const QintoPurchaseClaim = model.define("qinto_purchase_claim", {
  id: model.id({ prefix: "qpc" }).primaryKey(),
  order_id: model.text().unique(),
})

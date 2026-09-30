import { model } from "@medusajs/framework/utils"

/**
 * Where this store sends its events, and whether it sends them at all.
 *
 * A single row — a store reports to one Qinto site or to none — so the service
 * pins `id` to a known constant rather than generating one.
 *
 * Two columns, and both are public. `qinto_url` is the site's delivery host,
 * which is visible in the page source of any site running Qinto, and `enabled`
 * is a switch. There is no token here, no credential and no shopper data,
 * because every event is sent from the browser, which needs none of those.
 */
export const QintoConnection = model.define("qinto_connection", {
  id: model.id().primaryKey(),

  /** The site's delivery host, copied from the Qinto portal. */
  qinto_url: model.text().nullable(),

  /** Kill switch. Tracking stops without losing the configured destination. */
  enabled: model.boolean().default(true),
})

import { model } from "@medusajs/framework/utils"

/**
 * Where one storefront sends its events: the first-party domain for a sales
 * channel, and its switch.
 *
 * A Medusa store that runs several storefronts (one per country or domain) gives each one its own
 * sales channel and publishable API key. Every store API request carries that key, and Medusa
 * resolves it to the channel before the route runs, so the channel is the natural, unspoofable
 * thing to key the destination on. A store with one storefront simply has one row.
 *
 * Public values only: no credential and no shopper data. A first-party domain is public.
 */
export const QintoChannelConnection = model.define("qinto_channel_connection", {
  id: model.id({ prefix: "qcc" }).primaryKey(),

  /** The Medusa sales channel this destination belongs to. One row per channel. */
  sales_channel_id: model.text().unique(),

  /**
   * The store's first-party domain, stored as an https origin (`https://data.yourstore.com`).
   * Null means the store sends nothing.
   */
  first_party_domain: model.text().nullable(),

  /** This store's Tracking switch. Off keeps the domain but stops sending. */
  enabled: model.boolean().default(true),
})

import { MedusaService } from "@medusajs/framework/utils"
import {
  pickDestination,
  rowPatch,
  type ChannelRow,
  type Destination,
  type RowChange,
} from "../../lib/destinations"
import { QintoChannelConnection } from "./models/qinto-channel-connection"
import { QintoPurchaseClaim } from "./models/qinto-purchase-claim"

/**
 * Storage for per-storefront destinations: one row per sales channel.
 *
 * Every store is configured on its own, from Admin. There is deliberately no store-wide default,
 * no master switch, and no environment variable or plugin option: a store with no domain sends
 * nothing, so what Admin shows is always the whole truth.
 */
class QintoModuleService extends MedusaService({ QintoChannelConnection, QintoPurchaseClaim }) {
  async listChannelRows(salesChannelIds?: string[]): Promise<ChannelRow[]> {
    const rows = await this.listQintoChannelConnections(
      salesChannelIds ? { sales_channel_id: salesChannelIds } : {}
    )

    return rows.map((r) => ({
      sales_channel_id: r.sales_channel_id,
      first_party_domain: r.first_party_domain,
      enabled: r.enabled,
    }))
  }

  /**
   * Creates or updates one store's row. Saving a first-party domain also turns that store's
   * tracking on; see `rowPatch` for the exact rule.
   */
  async saveChannelRow(salesChannelId: string, data: RowChange): Promise<ChannelRow> {
    const patch = rowPatch(data)
    const find = async () =>
      (await this.listQintoChannelConnections({ sales_channel_id: salesChannelId }))[0]
    const update = async (id: string) =>
      (await this.updateQintoChannelConnections([{ id, ...patch }]))[0]

    const existing = await find()
    let saved: Awaited<ReturnType<typeof update>>

    if (existing) {
      saved = await update(existing.id)
    } else {
      try {
        const [created] = await this.createQintoChannelConnections([
          { sales_channel_id: salesChannelId, ...patch },
        ])
        saved = created
      } catch (error) {
        // Two first saves for the same store raced and the other one created the row: the unique
        // index refused ours, so apply this change to that row instead of failing the request.
        const raced = await find()

        if (!raced) {
          throw error
        }

        saved = await update(raced.id)
      }
    }

    return {
      sales_channel_id: saved.sales_channel_id,
      first_party_domain: saved.first_party_domain,
      enabled: saved.enabled,
    }
  }

  /**
   * Claims the Purchase for an order: `true` for the first caller only, `false` for every other,
   * including one that raced it. The unique index on `order_id` decides a race, not a read.
   */
  async claimPurchase(orderId: string): Promise<boolean> {
    const claimed = async () =>
      (await this.listQintoPurchaseClaims({ order_id: orderId }, { take: 1 })).length > 0

    if (await claimed()) {
      return false
    }

    try {
      await this.createQintoPurchaseClaims([{ order_id: orderId }])

      return true
    } catch (error) {
      // Refused by the unique index: another view claimed it between the read and the insert.
      if (await claimed()) {
        return false
      }

      throw error
    }
  }

  /** Where a storefront whose key spans these sales channels should send its events. */
  async resolveFor(salesChannelIds: string[]): Promise<Destination> {
    if (!salesChannelIds.length) {
      return pickDestination([], [])
    }

    return pickDestination(salesChannelIds, await this.listChannelRows(salesChannelIds))
  }
}

export default QintoModuleService

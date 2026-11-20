import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { conflictsFor, storeState, type KeyLink } from "../../../../lib/destinations"
import { qintoService } from "../../../../lib/service"

type ChannelNode = {
  id: string
  name: string
  publishable_api_keys?: ({ id: string; title: string; revoked_at?: Date | string | null } | null)[]
}

type KeyNode = {
  title: string
  revoked_at?: Date | string | null
  sales_channels_link?: ({ sales_channel_id: string } | null)[]
}

const isLive = (key: { revoked_at?: Date | string | null } | null): boolean =>
  key !== null && (!key.revoked_at || new Date(key.revoked_at) > new Date())

/**
 * Every sales channel and what its storefront is doing, for the Blotout page.
 *
 * All channels are listed, including ones no storefront can reach yet (no publishable key), so a
 * merchant adding a site sees it here straight away and is told what is missing.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const [{ data: channels }, { data: keys }, rows] = await Promise.all([
    query.graph({
      entity: "sales_channel",
      fields: ["id", "name", "publishable_api_keys.id", "publishable_api_keys.title", "publishable_api_keys.revoked_at"],
    }),
    query.graph({
      entity: "api_key",
      fields: ["title", "revoked_at", "sales_channels_link.sales_channel_id"],
      filters: { type: "publishable" },
    }),
    qintoService(req.scope).listChannelRows(),
  ])

  const keyLinks: KeyLink[] = (keys as KeyNode[]).filter(isLive).map((k) => ({
    title: k.title,
    salesChannelIds: (k.sales_channels_link ?? [])
      .map((l) => l?.sales_channel_id)
      .filter((id): id is string => Boolean(id)),
  }))

  const stores = (channels as ChannelNode[]).map((channel) => {
    const row = rows.find((r) => r.sales_channel_id === channel.id)
    const liveKeys = (channel.publishable_api_keys ?? []).filter(isLive)

    return {
      sales_channel_id: channel.id,
      name: channel.name,
      publishable_keys: liveKeys.map((k) => k?.title ?? ""),
      first_party_domain: row?.first_party_domain ?? null,
      enabled: row?.enabled ?? true,
      state: storeState(row, liveKeys.length > 0),
      conflicts: conflictsFor(channel.id, keyLinks, rows),
    }
  })

  res.json({ stores })
}

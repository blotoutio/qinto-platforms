import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { qintoService } from "../../../../lib/service"

/**
 * Parsed rather than pattern-matched: this value ends up in a script tag on the storefront, so
 * anything that is not a real absolute https URL is refused here rather than later.
 */
const httpsUrlOrNull = (value: string): URL | null => {
  try {
    const parsed = new URL(value.trim())

    return parsed.protocol === "https:" ? parsed : null
  } catch {
    return null
  }
}

/**
 * Merchant-editable settings: where events go, and whether they go at all.
 *
 * There is no credential here to protect. Events are sent by the browser, which needs none — the
 * Qinto URL is public, and is already visible in the page source of any site running Qinto.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service = qintoService(req.scope)
  const body = (req.body ?? {}) as Record<string, unknown>
  const { qinto_url: qintoUrl, enabled } = body

  if (qintoUrl !== undefined && qintoUrl !== null) {
    if (typeof qintoUrl !== "string") {
      res.status(400).json({ message: "qinto_url must be a string or null." })

      return
    }

    if (httpsUrlOrNull(qintoUrl) === null) {
      res.status(400).json({
        message: "qinto_url must be an absolute https URL, e.g. https://abc.dev.qinto.tech",
      })

      return
    }
  }

  if (enabled !== undefined && typeof enabled !== "boolean") {
    res.status(400).json({ message: "enabled must be a boolean." })

    return
  }

  if (qintoUrl !== undefined) {
    await service.setQintoUrl(typeof qintoUrl === "string" ? qintoUrl.trim() : null)
  }

  if (typeof enabled === "boolean") {
    await service.saveConnection({ enabled })
  }

  const settings = await service.getSettings()

  res.json({
    enabled: settings.enabled,
    qinto_url: settings.qintoUrl,
  })
}

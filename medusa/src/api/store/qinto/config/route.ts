import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { qintoService } from "../../../../lib/service"

/**
 * The storefront's configuration, served publicly.
 *
 * This is what removes the last piece of developer work from an install: a storefront can ask the
 * backend where to send events rather than carrying its own environment variable that has to be
 * kept in step with the admin. Everything here is already public — the Qinto URL is visible in the
 * page source of any site running Qinto. The Qinto token is deliberately **not** included.
 *
 * Returns `enabled: false` rather than a 404 when unconfigured, so the storefront has one shape to
 * handle instead of two.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  // Safe to cache briefly: it changes only when a merchant reconnects or switches site.
  res.setHeader("Cache-Control", "public, max-age=60")

  try {
    const settings = await qintoService(req.scope).getSettings()
    const ready = settings.enabled && settings.qintoUrl !== null

    res.json({
      enabled: ready,
      qinto_url: ready ? settings.qintoUrl : null,
    })
  } catch {
    // A storefront calls this on every page load. Answering "off" costs analytics; a 500 here
    // would show up in the merchant's error monitoring as a failing store endpoint.
    res.json({ enabled: false, qinto_url: null })
  }
}

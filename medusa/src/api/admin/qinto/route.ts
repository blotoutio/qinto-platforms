import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { qintoService } from "../../../lib/service"

/**
 * What the admin page renders from.
 *
 * Returns no credential, because the store holds none: the browser sends the
 * events and needs only a public URL to do it.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const settings = await qintoService(req.scope).getSettings()

  res.json({
    enabled: settings.enabled,
    qinto_url: settings.qintoUrl,
    qinto_url_source: settings.qintoUrlSource,
    /** Everything the integration needs: somewhere to send, and the switch on. */
    ready: settings.enabled && settings.qintoUrl !== null,
  })
}

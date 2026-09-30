import type { MedusaContainer } from "@medusajs/framework"
import { QINTO_MODULE } from "../modules/qinto"
import type QintoModuleService from "../modules/qinto/service"

/**
 * Resolves the module service.
 *
 * Its own file so the API routes can reach the module service without importing one another.
 */
export const qintoService = (container: MedusaContainer): QintoModuleService =>
  container.resolve(QINTO_MODULE)

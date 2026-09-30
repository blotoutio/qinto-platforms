import { Module } from "@medusajs/framework/utils"
import QintoModuleService from "./service"

export const QINTO_MODULE = "qinto"

export default Module(QINTO_MODULE, {
  service: QintoModuleService,
})

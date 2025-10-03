
import AbandonedCartsService from "./service"
import { Module } from "@medusajs/framework/utils"

export const ABANDONED_CARTS_MODULE = "abandoned_carts"

export default Module(ABANDONED_CARTS_MODULE, {
  service: AbandonedCartsService,
})

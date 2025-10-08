import { Module } from "@medusajs/framework/utils";
import RfmModuleService from "./service";

export const RFM_MODULE = "rfm";

export default Module(RFM_MODULE, {
  service: RfmModuleService
});

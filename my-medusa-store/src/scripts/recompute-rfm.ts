import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import RfmModuleService from "../modules/rfm/service";
import { RFM_MODULE } from "../modules/rfm";

export default async function run({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const service = container.resolve<RfmModuleService>(RFM_MODULE);

  logger.info("[rfm] Triggering manual recompute...");
  const summary = await service.recomputeAll();
  logger.info("[rfm] Done", summary);
}

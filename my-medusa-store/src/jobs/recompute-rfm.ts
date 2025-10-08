import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import RfmModuleService, {
  RecomputeSummary
} from "../modules/rfm/service";
import { RFM_MODULE } from "../modules/rfm";

export default async function recomputeRfmScores(
  container: MedusaContainer
) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const service = container.resolve<RfmModuleService>(RFM_MODULE);

  const startedAt = Date.now();
  logger.info("[rfm] Starting scheduled recompute...");

  let summary: RecomputeSummary | null = null;

  try {
    summary = await service.recomputeAll();
    const durationMs = Date.now() - startedAt;
    logger.info(
      `[rfm] Recompute completed in ${durationMs}ms`,
      summary
    );
  } catch (error) {
    logger.error("[rfm] Recompute failed", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  }

  return summary;
}

export const config = {
  name: "recompute-rfm-scores",
  schedule: "0 2 * * *" // Daily at 02:00 UTC
};

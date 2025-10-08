import type { MedusaContainer } from "@medusajs/framework/types";
import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import RfmModuleService, { RecomputeSummary } from "../modules/rfm/service";
import { RFM_MODULE } from "../modules/rfm";

type MaybeExecArgs =
  | MedusaContainer
  | (ExecArgs & { container: MedusaContainer })
  | { container: MedusaContainer };

function resolveContainer(input: MaybeExecArgs): MedusaContainer {
  if (
    input &&
    typeof input === "object" &&
    "resolve" in input &&
    typeof (input as any).resolve === "function"
  ) {
    return input as MedusaContainer;
  }
  if (
    input &&
    typeof input === "object" &&
    "container" in input &&
    input.container &&
    typeof (input.container as any).resolve === "function"
  ) {
    return input.container as MedusaContainer;
  }
  throw new Error("Unable to resolve Medusa container");
}

export default async function recomputeRfmScores(
  input: MaybeExecArgs
) {
  const container = resolveContainer(input);
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

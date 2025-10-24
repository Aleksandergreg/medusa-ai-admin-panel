import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import AssistantModuleService from "../../../../../modules/assistant/service";
import { getActorId } from "../../../../../modules/assistant/utils/auth-helpers";

export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const actorId = getActorId(req);
  if (!actorId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const assistantService =
    req.scope.resolve<AssistantModuleService>("assistant");

  const metrics = await assistantService.getAgentNpsMetrics();

  return res.json(metrics);
}

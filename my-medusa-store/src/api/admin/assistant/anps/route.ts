import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import AssistantModuleService from "../../../../modules/assistant/service";
import { getActorId } from "../../../../modules/assistant/utils/auth-helpers";

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

  const limitParam = Number(req.query?.limit);
  const limit =
    Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 100
      ? Math.floor(limitParam)
      : 20;

  const extractTaskLabel = (value: unknown): string | undefined => {
    if (Array.isArray(value)) {
      return value.length ? extractTaskLabel(value[0]) : undefined;
    }
    if (typeof value !== "string") {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
  };

  const taskLabel =
    extractTaskLabel(req.query?.taskLabel) ??
    extractTaskLabel((req.query as Record<string, unknown>)?.task_label);

  const rows = await assistantService.listRecentAgentNps(limit, {
    ...(taskLabel ? { taskLabel } : {}),
  });

  return res.json({
    rows: rows.map((row) => ({
      id: row.id,
      created_at: row.created_at.toISOString(),
      agent_id: row.agent_id,
      agent_version: row.agent_version,
      session_id: row.session_id,
      user_id: row.user_id,
      score: row.score,
      task_label: row.task_label,
      operation_id: row.operation_id,
      tools_used: row.tools_used,
      duration_ms: row.duration_ms,
      error_flag: row.error_flag,
      error_summary: row.error_summary,
      user_permission: row.user_permission,
      client_metadata: row.client_metadata,
    })),
  });
}

import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import AssistantModuleService from "../../../../modules/assistant/service";
import {
  normalizeClientMetadata,
  sanitizeClientMetadata,
  sanitizeToolUsage,
} from "../../../../modules/assistant/lib/anps";

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const assistantService =
    req.scope.resolve<AssistantModuleService>("assistant");

  const limitParam = Number(req.query?.limit);
  const limit =
    Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 100
      ? Math.floor(limitParam)
      : 20;

  const rows = await assistantService.listRecentAgentNps(limit);

  console.info(
    JSON.stringify({
      event: "agent_nps.raw_fetch",
      limit,
      returned: rows.length,
    })
  );

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

type AgentNpsRequestBody = {
  score?: unknown;
  sessionId?: unknown;
  session_id?: unknown;
  agentId?: unknown;
  agent_id?: unknown;
  agentVersion?: unknown;
  agent_version?: unknown;
  userId?: unknown;
  user_id?: unknown;
  taskLabel?: unknown;
  task_label?: unknown;
  operationId?: unknown;
  operation_id?: unknown;
  toolsUsed?: unknown;
  tools_used?: unknown;
  durationMs?: unknown;
  duration_ms?: unknown;
  errorFlag?: unknown;
  error_flag?: unknown;
  errorSummary?: unknown;
  error_summary?: unknown;
  userPermission?: unknown;
  user_permission?: unknown;
  clientMetadata?: unknown;
  client_metadata?: unknown;
};

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const assistantService =
    req.scope.resolve<AssistantModuleService>("assistant");

  const body = (req.body ?? {}) as AgentNpsRequestBody;
  const recordBody = body as Record<string, unknown>;

  const pick = (camel: string, snake: string): unknown => {
    const camelValue = recordBody[camel];
    return camelValue !== undefined ? camelValue : recordBody[snake];
  };

  const parseBoolean = (value: unknown): boolean | undefined => {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const v = value.trim().toLowerCase();
      if (v === "true") return true;
      if (v === "false") return false;
    }
    if (typeof value === "number") {
      if (value === 1) return true;
      if (value === 0) return false;
    }
    return undefined;
  };

  const scoreValue = pick("score", "score");
  const sessionValue = pick("sessionId", "session_id");
  const agentValue = pick("agentId", "agent_id");

  try {
    const agentVersionRaw = pick("agentVersion", "agent_version");
    const userIdRaw = pick("userId", "user_id");
    const taskLabelRaw = pick("taskLabel", "task_label");
    const operationIdRaw = pick("operationId", "operation_id");
    const toolsUsedRaw = pick("toolsUsed", "tools_used");
    const durationRaw = pick("durationMs", "duration_ms");
    const errorSummaryRaw = pick("errorSummary", "error_summary");
    const clientMetadataRaw = pick("clientMetadata", "client_metadata");

    const errorFlag = (() => {
      const raw = pick("errorFlag", "error_flag");
      const parsed = parseBoolean(raw);
      return parsed ?? false;
    })();

    const userPermission = (() => {
      const raw = pick("userPermission", "user_permission");
      const parsed = parseBoolean(raw);
      return parsed ?? false;
    })();

    const sanitizedTools = sanitizeToolUsage(toolsUsedRaw);
    const normalizedMetadata = normalizeClientMetadata(clientMetadataRaw);
    const sanitizedMetadata = sanitizeClientMetadata(normalizedMetadata);

    const result = await assistantService.recordAgentNps({
      agentId: typeof agentValue === "string" ? agentValue : "",
      sessionId: typeof sessionValue === "string" ? sessionValue : "",
      score:
        typeof scoreValue === "number"
          ? scoreValue
          : Number(scoreValue),
      agentVersion:
        typeof agentVersionRaw === "string" ? agentVersionRaw : undefined,
      userId: typeof userIdRaw === "string" ? userIdRaw : undefined,
      taskLabel: typeof taskLabelRaw === "string" ? taskLabelRaw : undefined,
      operationId:
        typeof operationIdRaw === "string" ? operationIdRaw : undefined,
      toolsUsed: sanitizedTools.length ? sanitizedTools : undefined,
      durationMs:
        typeof durationRaw === "number"
          ? durationRaw
          : (() => {
              const parsed = Number(durationRaw);
              return Number.isFinite(parsed) ? parsed : undefined;
            })(),
      errorFlag,
      errorSummary:
        typeof errorSummaryRaw === "string" ? errorSummaryRaw : undefined,
      userPermission,
      clientMetadata: sanitizedMetadata ?? undefined,
    });

    console.info(
      JSON.stringify({
        event: "agent_nps.submit",
        id: result.id,
      })
    );

    return res.json({ ok: true, id: result.id });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to record ANPS";
    console.warn(
      JSON.stringify({
        event: "agent_nps.submit_failed",
        message,
      })
    );
    return res.status(400).json({ ok: false, message });
  }
}

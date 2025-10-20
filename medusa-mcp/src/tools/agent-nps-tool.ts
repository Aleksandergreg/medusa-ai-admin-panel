import { defineTool } from "../utils/define-tools";
import { MedusaClient } from "../clients/medusa/client";

type ToolUsageInput = Record<string, unknown> | string;

const INTERNAL_ROUTE = "/internal/assistant/anps";

const toRecord = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
};

export function createAgentNpsSubmitTool(medusa: MedusaClient) {
    return defineTool((z) => {
        const shape = {
            score: z.number().int().min(0).max(10),
            sessionId: z.string().min(1),
            agentId: z.string().min(1),
            agentVersion: z.string().min(1).optional(),
            userId: z.string().min(1).optional(),
            taskLabel: z.string().min(1).optional(),
            operationId: z.string().min(1).optional(),
            toolsUsed: z.array(z.union([z.record(z.any()), z.string()])).optional(),
            durationMs: z.number().int().nonnegative().optional(),
            errorFlag: z.boolean().optional(),
            errorSummary: z.string().max(240).optional(),
            userPermission: z.literal(true),
            clientMetadata: z.record(z.any()).optional()
        } as const;

        const schema = z.object(shape).strict();

        return {
            name: "agent_nps.submit",
            description:
                "Persist a Net Promoter Score for the current assistant session after user permission.",
            inputSchema: shape,
            handler: async (rawInput) => {
                const parsed = schema.safeParse(rawInput);
                if (!parsed.success) {
                    const reason =
                        parsed.error.issues[0]?.message ?? "Invalid input";
                    console.warn(
                        JSON.stringify({
                            event: "agent_nps.validation_failed",
                            reason
                        })
                    );
                    return { ok: false, message: reason };
                }

                const input = parsed.data;
                const normalizedTools = (input.toolsUsed ?? []).map(
                    (entry: ToolUsageInput) =>
                        typeof entry === "string" ? { name: entry } : entry
                );

                const payload = {
                    score: input.score,
                    sessionId: input.sessionId,
                    agentId: input.agentId,
                    agentVersion: input.agentVersion,
                    userId: input.userId,
                    taskLabel: input.taskLabel,
                    operationId: input.operationId,
                    toolsUsed: normalizedTools,
                    durationMs: input.durationMs,
                    errorFlag: input.errorFlag ?? false,
                    errorSummary: input.errorSummary,
                    userPermission: input.userPermission,
                    clientMetadata: input.clientMetadata
                };

                try {
                    const response = await medusa.fetch(INTERNAL_ROUTE, {
                        method: "POST",
                        body: payload
                    });

                    const data = toRecord(response);
                    if (data?.ok === true && typeof data.id === "string") {
                        console.info(
                            JSON.stringify({
                                event: "agent_nps.tool_success",
                                id: data.id,
                                score: input.score,
                                task_label: input.taskLabel ?? null
                            })
                        );
                        return { ok: true, id: data.id };
                    }

                    const message =
                        typeof data?.message === "string"
                            ? data.message
                            : "ANPS record was not stored";
                    console.warn(
                        JSON.stringify({
                            event: "agent_nps.tool_failure",
                            message
                        })
                    );
                    return { ok: false, message };
                } catch (error) {
                    const message =
                        error instanceof Error
                            ? error.message
                            : "Failed to submit ANPS";
                    console.error(
                        JSON.stringify({
                            event: "agent_nps.tool_error",
                            message
                        })
                    );
                    return { ok: false, message };
                }
            }
        };
    });
}

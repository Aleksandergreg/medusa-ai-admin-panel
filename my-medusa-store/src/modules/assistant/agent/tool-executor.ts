import { withToolLogging } from "../../../lib/metrics/store";
import { JSONValue, MCPResult, extractToolJsonPayload } from "../lib/utils";
import { collectGroundTruthNumbers } from "../analysis/validation";
import { summarizePayload, AssistantSummary } from "../analysis/aggregators";
import { validationManager } from "../lib/validation-manager";

export type ExecuteOutcome = {
  result?: unknown;
  payload?: JSONValue;
  truth?: Record<string, number>;
  summary?: AssistantSummary;
  error?: Record<string, unknown>;
  validationRequest?: {
    id: string;
    operationId: string;
    method: string;
    path: string;
    args: Record<string, unknown>;
  };
};

function needsValidation(
  toolName: string,
  args: Record<string, unknown>
): boolean {
  if (toolName !== "openapi.execute") {
    return false;
  }

  const operationId = args.operationId as string | undefined;
  if (!operationId) {
    return false;
  }

  // Check if operation starts with destructive method patterns
  const destructivePatterns = [/^Admin(Post|Delete)/i, /^Store(Post|Delete)/i];

  return destructivePatterns.some((pattern) => pattern.test(operationId));
}

function extractOperationDetails(args: Record<string, unknown>): {
  operationId: string;
  method: string;
  path: string;
} {
  const operationId = args.operationId as string;

  // Extract method from operationId (e.g., AdminPostPromotions -> POST)
  const methodMatch = operationId.match(/Admin(Post|Delete|Put|Patch)/i);
  const method = methodMatch ? methodMatch[1].toUpperCase() : "POST";

  // Simple path extraction (this could be improved with actual operation lookup)
  const path = `/admin/${operationId
    .replace(/^Admin(Post|Delete|Put|Patch)/i, "")
    .toLowerCase()}`;

  return { operationId, method, path };
}

export async function executeTool(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mcp: any;
  toolName: string;
  args: Record<string, unknown>;
}): Promise<ExecuteOutcome> {
  const { mcp, toolName, args } = params;

  // Check if this operation needs validation
  if (needsValidation(toolName, args)) {
    const details = extractOperationDetails(args);
    const { request } = validationManager.createValidationRequest(
      details.operationId,
      details.method,
      details.path,
      args
    );

    console.log(`   ⚠️  Operation requires validation: ${details.operationId}`);
    console.log(`   Waiting for user approval...`);

    // Return early with validation request
    return {
      validationRequest: {
        id: request.id,
        operationId: request.operationId,
        method: request.method,
        path: request.path,
        args: request.args,
      },
    };
  }

  try {
    const result = await withToolLogging(toolName, args, async () => {
      return mcp.callTool(toolName, args);
    });

    const payload = extractToolJsonPayload(result);
    const truth = collectGroundTruthNumbers(payload);
    const summary = summarizePayload(payload);

    if (summary) {
      const resultObj = result as MCPResult;
      const textEntry = {
        type: "text" as const,
        text: JSON.stringify({ assistant_summary: summary }),
      };
      if (Array.isArray(resultObj?.content)) {
        resultObj.content.unshift(textEntry);
      } else if (resultObj) {
        (resultObj as unknown as { content: unknown[] }).content = [textEntry];
      }
    }

    return { result, payload, truth, summary };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`   Tool ${toolName} failed: ${message}`);

    const toolError: Record<string, unknown> = {
      error: true,
      message,
    };

    const maybeCode = (error as { code?: unknown })?.code;
    if (typeof maybeCode === "number" || typeof maybeCode === "string") {
      toolError.code = maybeCode;
    }

    const maybeData = (error as { data?: unknown })?.data;
    if (maybeData !== undefined) {
      toolError.data = maybeData;
    }

    const maybeResult = (error as { result?: unknown })?.result;
    if (maybeResult !== undefined) {
      toolError.result = maybeResult;
    }

    return { error: toolError };
  }
}

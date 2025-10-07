import { withToolLogging } from "../../../lib/metrics/store";
import { JSONValue, MCPResult, extractToolJsonPayload } from "../lib/utils";
import { collectGroundTruthNumbers } from "../analysis/validation";
import { summarizePayload, AssistantSummary } from "../analysis/aggregators";

export type ExecuteOutcome = {
  result?: unknown;
  payload?: JSONValue;
  truth?: Record<string, number>;
  summary?: AssistantSummary;
  error?: Record<string, unknown>;
};

export async function executeTool(params: {
  mcp: any;
  toolName: string;
  args: Record<string, unknown>;
}): Promise<ExecuteOutcome> {
  const { mcp, toolName, args } = params;

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
        resultObj.content.push(textEntry);
      } else if (resultObj) {
        (resultObj as any).content = [textEntry];
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


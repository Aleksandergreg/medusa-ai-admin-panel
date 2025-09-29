import { MedusaService } from "@medusajs/framework/utils";
import { getMcp } from "../../lib/mcp/manager";
import { metricsStore, withToolLogging } from "../../lib/metrics/store";
import { ChartType, HistoryEntry, McpTool, InitialOperation } from "./lib/types";
import {
  extractToolJsonPayload,
  normalizeToolArgs,
  ensureMarkdownMinimum,
} from "./lib/utils";
import { buildChartFromAnswer, buildChartFromLatestTool } from "./charts";
import { planNextStepWithGemini } from "./agent/planner";
import { collectGroundTruthNumbers } from "./analysis/validation";
import { summarizePayload } from "./analysis/aggregators";
import { MCPResult } from "./lib/utils";
import { AssistantModuleOptions, DEFAULT_ASSISTANT_OPTIONS } from "./config";

type AskInput = {
  prompt: string;
  wantsChart?: boolean;
  chartType?: ChartType;
  chartTitle?: string;
  onCancel?: (cancel: () => void) => void;
};

class AssistantModuleService extends MedusaService({}) {
  private readonly config: AssistantModuleOptions;

  constructor(container: unknown, options: AssistantModuleOptions = DEFAULT_ASSISTANT_OPTIONS) {
    super(container, options);
    this.config = { ...DEFAULT_ASSISTANT_OPTIONS, ...options };
  }

  async ask(input: AskInput): Promise<{
    answer?: string;
    chart: unknown | null;
    data: unknown | null;
    history: HistoryEntry[];
  }> {
    const prompt = input.prompt?.trim();
    if (!prompt) {
      throw new Error("Missing prompt");
    }

    const wantsChart = Boolean(input.wantsChart);
    const chartType: ChartType = input.chartType === "line" ? "line" : "bar";
    const chartTitle =
      typeof input.chartTitle === "string" ? input.chartTitle : undefined;

    const mcp = await getMcp();
    const tools = await mcp.listTools();
    const availableTools: McpTool[] = (tools.tools ?? []) as McpTool[];

    let initialOperations: InitialOperation[] = [];
    const hasOpenApiSearch = availableTools.some(
      (tool) => tool.name === "openapi.search"
    );
    if (hasOpenApiSearch) {
      try {
        const rawSuggestions = await mcp.callTool("openapi.search", {
          query: prompt,
          limit: 8,
        });
        const suggestionPayload = extractToolJsonPayload(rawSuggestions);
        if (Array.isArray(suggestionPayload)) {
          initialOperations = suggestionPayload
            .map((item): InitialOperation | null => {
              if (!item || typeof item !== "object") {
                return null;
              }
              const obj = item as Record<string, unknown>;
              const operationId = obj.operationId ?? obj.operation_id ?? obj.id;
              const method = obj.method ?? obj.httpMethod ?? obj.verb;
              const path = obj.path ?? obj.url ?? obj.endpoint;
              if (
                typeof operationId !== "string" ||
                typeof method !== "string" ||
                typeof path !== "string"
              ) {
                return null;
              }
              return {
                operationId,
                method,
                path,
                summary:
                  typeof obj.summary === "string" ? obj.summary : undefined,
                tags: Array.isArray(obj.tags)
                  ? (obj.tags as unknown[])
                      .filter((tag) => typeof tag === "string")
                      .map((tag) => tag as string)
                  : undefined,
              } satisfies InitialOperation;
            })
            .filter((op): op is InitialOperation => Boolean(op));
        }
      } catch (error) {
        console.warn("Failed to pre-load openapi.search suggestions", error);
      }
    }

    const history: HistoryEntry[] = [];

    const turnId = metricsStore.startAssistantTurn({ user: prompt });

    let isCancelled = false;
    if (typeof input.onCancel === "function") {
      input.onCancel(() => {
        isCancelled = true;
      });
    }
    for (let step = 0; step < this.config.maxSteps; step++) {
        if (isCancelled) {
         throw new Error("Request was cancelled by the client.");
      }
      console.log(`
--- AGENT LOOP: STEP ${step + 1} ---`);
      const plan = await planNextStepWithGemini(
        prompt,
        availableTools,
        history,
        this.config.modelName,
        wantsChart,
        chartType,
        initialOperations,
        this.config
      );

      if (plan.action === "final_answer") {
        metricsStore.endAssistantTurn(turnId, plan.answer ?? "");

        const t = metricsStore.getLastTurn?.();
        const grounded = t?.groundedNumbers ?? {};
        for (const [label, value] of Object.entries(grounded)) {
          if (typeof value === "number") {
            metricsStore.autoValidateFromAnswer(turnId, label, value, 0);
          }
        }

        const latestPayload = extractToolJsonPayload(
          history[history.length - 1]?.tool_result
        );
        const chart = wantsChart
          ? buildChartFromAnswer(plan.answer, chartType, chartTitle) ||
            buildChartFromLatestTool(history, chartType, chartTitle) ||
            null
          : null;

        const formattedAnswer = ensureMarkdownMinimum(plan.answer ?? "");
        return {
          answer: formattedAnswer,
          chart,
          data: latestPayload ?? null,
          history,
        };
      }

      if (plan.action === "call_tool" && plan.tool_name && plan.tool_args) {
        console.log(` 🧠 AI wants to call tool: ${plan.tool_name}`);
        console.log(`   With args: ${JSON.stringify(plan.tool_args)}`);

        
        metricsStore.noteToolUsed(turnId, plan.tool_name);

        const normalizedArgs = normalizeToolArgs(plan.tool_args);

        if (JSON.stringify(normalizedArgs) !== JSON.stringify(plan.tool_args)) {
          console.log(`   Normalized args: ${JSON.stringify(normalizedArgs)}`);
        }

        let result: unknown;
        try {
          result = await withToolLogging(
            plan.tool_name,
            normalizedArgs,
            async () => {
              return mcp.callTool(
                plan.tool_name!,
                normalizedArgs as Record<string, unknown>
              );
            }
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          console.warn(`   Tool ${plan.tool_name} failed: ${message}`);

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

          history.push({
            tool_name: plan.tool_name,
            tool_args: normalizedArgs,
            tool_result: toolError,
          });

          continue;
        }

        console.log(
          `   Tool Result: ${JSON.stringify(result).substring(0, 200)}...`
        );

        const payload = extractToolJsonPayload(result);
        const truth = collectGroundTruthNumbers(payload);
        if (truth) {
          metricsStore.provideGroundTruth(turnId, truth);
        }

        const summary = summarizePayload(payload);
        if (summary) {
          const summaryNumbers: Record<string, number> = {};

          for (const aggregate of summary.aggregates) {
            for (const entry of aggregate.counts) {
              summaryNumbers[`${aggregate.path}:${entry.value}`] = entry.count;
            }
            summaryNumbers[`${aggregate.path}:__total__`] = aggregate.total;
          }

          if (Object.keys(summaryNumbers).length) {
            metricsStore.provideGroundTruth(turnId, summaryNumbers);
          }

          const resultObj = result as MCPResult;
          const textEntry = {
            type: "text" as const,
            text: JSON.stringify({ assistant_summary: summary }),
          };
          if (Array.isArray(resultObj?.content)) {
            resultObj.content.unshift(textEntry);
          } else if (resultObj) {
            resultObj.content = [textEntry];
          }
        }

        history.push({
          tool_name: plan.tool_name,
          tool_args: normalizedArgs,
          tool_result: result,
        });

        if (summary) {
          history.push({
            tool_name: "assistant.summary",
            tool_args: { source_tool: plan.tool_name },
            tool_result: { assistant_summary: summary },
          });
        }
      } else {
        throw new Error("AI returned an invalid plan. Cannot proceed.");
      }
    }

    metricsStore.endAssistantTurn(turnId, "[aborted: max steps exceeded]");
    throw new Error(
      "The agent could not complete the request within the maximum number of steps."
    );
  }
}

export default AssistantModuleService;

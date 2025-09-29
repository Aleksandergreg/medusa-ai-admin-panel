import { getMcp } from "../../../lib/mcp/manager";
import { metricsStore, withToolLogging } from "../../../lib/metrics/store";
import { planNextStepWithGemini } from "./planner";
import { buildChartFromAnswer, buildChartFromLatestTool } from "../charts";
import { collectGroundTruthNumbers } from "../analysis/validation";
import { summarizePayload } from "../analysis/aggregators";
import {
  extractToolJsonPayload,
  normalizeToolArgs,
  ensureMarkdownMinimum,
  MCPResult,
} from "../lib/utils";
import {
  ChartType,
  HistoryEntry,
  InitialOperation,
  McpTool,
} from "../lib/types";
import { AssistantModuleOptions } from "../config";
import { preloadOpenApiSuggestions } from "./preload";

type AskInput = {
  prompt: string;
  wantsChart?: boolean;
  chartType?: ChartType;
  chartTitle?: string;
  onCancel?: (cancel: () => void) => void;
};

export async function askAgent(
  input: AskInput,
  options: { config: AssistantModuleOptions }
): Promise<{
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
  const chartTitle = typeof input.chartTitle === "string" ? input.chartTitle : undefined;

  const mcp = await getMcp();
  const tools = await mcp.listTools();
  const availableTools: McpTool[] = (tools.tools ?? []) as McpTool[];

  const initialOperations: InitialOperation[] = await preloadOpenApiSuggestions(
    prompt,
    mcp,
    availableTools
  );

  const history: HistoryEntry[] = [];

  const turnId = metricsStore.startAssistantTurn({ user: prompt });

  let isCancelled = false;
  if (typeof input.onCancel === "function") {
    input.onCancel(() => {
      isCancelled = true;
    });
  }

  for (let step = 0; step < options.config.maxSteps; step++) {
    if (isCancelled) {
      throw new Error("Request was cancelled by the client.");
    }
    console.log(`\n--- AGENT LOOP: STEP ${step + 1} ---`);

    const plan = await planNextStepWithGemini(
      prompt,
      availableTools,
      history,
      options.config.modelName,
      wantsChart,
      chartType,
      initialOperations,
      options.config
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
        const message = error instanceof Error ? error.message : String(error);
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
          (resultObj as any).content = [textEntry];
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


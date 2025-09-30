import { getMcp } from "../../../lib/mcp/manager";
import { metricsStore } from "../../../lib/metrics/store";
import { planNextStepWithGemini } from "./planner";
import { buildChartFromAnswer, buildChartFromLatestTool } from "../charts";
import {
  extractToolJsonPayload,
  normalizeToolArgs,
  ensureMarkdownMinimum,
} from "../lib/utils";
import {
  ChartType,
  HistoryEntry,
  InitialOperation,
  McpTool,
} from "../lib/types";
import { AssistantModuleOptions } from "../config";
import { preloadOpenApiSuggestions } from "./preload";
import { executeTool } from "./tool-executor";

type AskInput = {
  prompt: string;
  history?: HistoryEntry[];
  wantsChart?: boolean;
  chartType?: ChartType;
  chartTitle?: string;
  onCancel?: (cancel: () => void) => void;
};

type NormalizedPlan =
  | {
      action: "final_answer";
      answer?: string;
      raw: any;
    }
  | {
      action: "call_tool";
      tool_name: string;
      tool_args: unknown;
      raw: any;
    };

const FALLBACK_MESSAGE = ensureMarkdownMinimum(
  "I'm sorry, I couldn't complete that request. Please try rephrasing your question."
);

function normalizeAction(action: unknown): "final_answer" | "call_tool" | null {
  if (typeof action !== "string") {
    return null;
  }

  const snake = action
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();

  switch (snake) {
    case "final_answer":
    case "finalanswer":
    case "final_answer_step":
    case "answer":
    case "respond":
      return "final_answer";
    case "call_tool":
    case "calltool":
    case "tool_call":
    case "toolcall":
    case "use_tool":
    case "tool":
      return "call_tool";
    default:
      return null;
  }
}

function coerceAnswer(rawPlan: any): string | undefined {
  const candidates = [
    rawPlan?.answer,
    rawPlan?.response,
    rawPlan?.final_answer,
    rawPlan?.final,
    rawPlan?.message,
    rawPlan?.text,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length) {
      return candidate;
    }
  }

  return undefined;
}

function normalizePlan(plan: any): NormalizedPlan | null {
  if (!plan || typeof plan !== "object") {
    return null;
  }

  const action =
    normalizeAction(plan.action) ??
    normalizeAction(plan.intent) ??
    normalizeAction(plan.type);

  if (!action) {
    return null;
  }

  if (action === "final_answer") {
    return {
      action,
      answer: coerceAnswer(plan),
      raw: plan,
    };
  }

  const toolNameCandidate =
    plan.tool_name ?? plan.toolName ?? plan.tool ?? plan.name;

  if (typeof toolNameCandidate !== "string" || !toolNameCandidate.trim()) {
    return null;
  }

  const toolArgsCandidate =
    plan.tool_args ?? plan.toolArgs ?? plan.arguments ?? plan.args ?? {};

  return {
    action: "call_tool",
    tool_name: toolNameCandidate,
    tool_args: toolArgsCandidate,
    raw: plan,
  };
}

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
  const chartTitle =
    typeof input.chartTitle === "string" ? input.chartTitle : undefined;

  const mcp = await getMcp();
  const tools = await mcp.listTools();
  const availableTools: McpTool[] = (tools.tools ?? []) as McpTool[];

  const initialOperations: InitialOperation[] = await preloadOpenApiSuggestions(
    prompt,
    mcp,
    availableTools
  );

  const history: HistoryEntry[] = [...(input.history || [])];

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

    const rawPlan = await planNextStepWithGemini(
      prompt,
      availableTools,
      history,
      options.config.modelName,
      wantsChart,
      chartType,
      initialOperations,
      options.config
    );

    const plan = normalizePlan(rawPlan);

    if (!plan) {
      console.warn("Planner returned an unrecognized plan", rawPlan);
      metricsStore.endAssistantTurn(turnId, FALLBACK_MESSAGE);
      return {
        answer: FALLBACK_MESSAGE,
        chart: null,
        data: null,
        history,
      };
    }

    if (plan.action === "final_answer") {
      const finalAnswer =
        plan.answer && plan.answer.trim().length ? plan.answer : FALLBACK_MESSAGE;
      metricsStore.endAssistantTurn(turnId, finalAnswer);

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
        ? buildChartFromAnswer(finalAnswer, chartType, chartTitle) ||
          buildChartFromLatestTool(history, chartType, chartTitle) ||
          null
        : null;

      const formattedAnswer = ensureMarkdownMinimum(finalAnswer);
      return {
        answer: formattedAnswer,
        chart,
        data: latestPayload ?? null,
        history,
      };
    }

    if (plan.action === "call_tool" && plan.tool_name && plan.tool_args) {
      console.log(`  AI wants to call tool: ${plan.tool_name}`);
      console.log(`   With args: ${JSON.stringify(plan.tool_args)}`);

      metricsStore.noteToolUsed(turnId, plan.tool_name);

      const normalizedArgs = normalizeToolArgs(plan.tool_args);
      if (JSON.stringify(normalizedArgs) !== JSON.stringify(plan.tool_args)) {
        console.log(`   Normalized args: ${JSON.stringify(normalizedArgs)}`);
      }

      const outcome = await executeTool({
        mcp,
        toolName: plan.tool_name!,
        args: normalizedArgs as Record<string, unknown>,
      });

      if (outcome.error) {
        history.push({
          tool_name: plan.tool_name,
          tool_args: normalizedArgs,
          tool_result: outcome.error,
        });
        continue;
      }

      const result = outcome.result;
      console.log(
        `   Tool Result: ${JSON.stringify(result).substring(0, 200)}...`
      );

      if (outcome.truth) {
        metricsStore.provideGroundTruth(turnId, outcome.truth);
      }

      if (outcome.summary) {
        const summaryNumbers: Record<string, number> = {};
        for (const aggregate of outcome.summary.aggregates) {
          for (const entry of aggregate.counts) {
            summaryNumbers[`${aggregate.path}:${entry.value}`] = entry.count;
          }
          summaryNumbers[`${aggregate.path}:__total__`] = aggregate.total;
        }
        if (Object.keys(summaryNumbers).length) {
          metricsStore.provideGroundTruth(turnId, summaryNumbers);
        }
      }

      history.push({
        tool_name: plan.tool_name,
        tool_args: normalizedArgs,
        tool_result: result,
      });

      if (outcome.summary) {
        history.push({
          tool_name: "assistant.summary",
          tool_args: { source_tool: plan.tool_name },
          tool_result: { assistant_summary: outcome.summary },
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

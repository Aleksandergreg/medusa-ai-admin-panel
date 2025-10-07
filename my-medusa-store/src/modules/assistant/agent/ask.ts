import { getMcp } from "../../../lib/mcp/manager";
import { metricsStore } from "../../../lib/metrics/store";
import { planNextStepWithGemini } from "./planner";
import {
  extractToolJsonPayload,
  normalizeToolArgs,
  ensureMarkdownMinimum,
} from "../lib/utils";
import { FALLBACK_MESSAGE, normalizePlan } from "../lib/plan-normalizer";
import { HistoryEntry, InitialOperation, McpTool } from "../lib/types";
import { AssistantModuleOptions } from "../config";
import { preloadOpenApiSuggestions } from "./preload";
import { executeTool } from "./tool-executor";

type AskInput = {
  prompt: string;
  history?: HistoryEntry[];
  onCancel?: (cancel: () => void) => void;
};

export async function askAgent(
  input: AskInput,
  options: { config: AssistantModuleOptions }
): Promise<{
  answer?: string;
  data: unknown | null;
  history: HistoryEntry[];
}> {
  const prompt = input.prompt?.trim();
  if (!prompt) {
    throw new Error("Missing prompt");
  }

  const mcp = await getMcp();
  const tools = await mcp.listTools();
  const availableTools: McpTool[] = (tools.tools ?? []) as McpTool[];

  const initialOperations: InitialOperation[] = await preloadOpenApiSuggestions(
    prompt,
    mcp,
    availableTools
  );

  const history: HistoryEntry[] = [...(input.history || [])];
  const successfulCallCache = new Map<string, HistoryEntry>();

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
      initialOperations,
      options.config
    );

    const plan = normalizePlan(rawPlan);

    if (!plan) {
      console.warn("Planner returned an unrecognized plan", rawPlan);
      metricsStore.endAssistantTurn(turnId, FALLBACK_MESSAGE);
      return {
        answer: FALLBACK_MESSAGE,
        data: null,
        history,
      };
    }

    if (plan.action === "final_answer") {
      const chosenAnswer =
        plan.answer && plan.answer.trim().length
          ? plan.answer
          : FALLBACK_MESSAGE;

      metricsStore.endAssistantTurn(turnId, chosenAnswer);

      const t = metricsStore.getLastTurn?.();
      const grounded = t?.groundedNumbers ?? {};
      for (const [label, value] of Object.entries(grounded)) {
        if (typeof value === "number") {
          metricsStore.autoValidateFromAnswer(turnId, label, value, 0);
        }
      }

      const latestPayload = findLatestPayload(history);

      const formattedAnswer = ensureMarkdownMinimum(chosenAnswer);
      return {
        answer: formattedAnswer,
        data: latestPayload ?? null,
        history,
      };
    }

    if (plan.action === "call_tool" && plan.tool_name && plan.tool_args) {
      console.log(`  AI wants to call tool: ${plan.tool_name}`);
      console.log(`   With args: ${JSON.stringify(plan.tool_args)}`);

      const normalizedArgs = normalizeToolArgs(plan.tool_args);
      if (JSON.stringify(normalizedArgs) !== JSON.stringify(plan.tool_args)) {
        console.log(`   Normalized args: ${JSON.stringify(normalizedArgs)}`);
      }

      const callKey = createToolCallKey(plan.tool_name, normalizedArgs);
      const isMutatingExecuteCall =
        plan.tool_name === "openapi.execute" &&
        normalizedArgs !== null &&
        typeof normalizedArgs === "object" &&
        !Array.isArray(normalizedArgs) &&
        "body" in (normalizedArgs as Record<string, unknown>);
      const previousSuccess = isMutatingExecuteCall
        ? successfulCallCache.get(callKey)
        : undefined;

      if (previousSuccess) {
        console.log(
          "   Duplicate tool call detected; reusing prior successful result."
        );
        history.push({
          tool_name: "assistant.note",
          tool_args: {
            reason: "duplicate_tool_call",
            tool_name: plan.tool_name,
          },
          tool_result: {
            message:
              "Skipped identical tool call because the same request already succeeded earlier in this conversation. Reuse the previous result instead of repeating the POST.",
          },
        });
        continue;
      }

      metricsStore.noteToolUsed(turnId, plan.tool_name);

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

      const historyEntry: HistoryEntry = {
        tool_name: plan.tool_name,
        tool_args: normalizedArgs,
        tool_result: result,
      };
      history.push(historyEntry);

      if (isMutatingExecuteCall) {
        successfulCallCache.set(callKey, historyEntry);
      }

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

function createToolCallKey(toolName: string, args: unknown): string {
  return `${toolName}:${stableStringify(args)}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => a.localeCompare(b)
    );
    return `{${entries
      .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`)
      .join(",")}}`;
  }
  if (value === undefined) {
    return "undefined";
  }
  return JSON.stringify(value);
}

function findLatestPayload(history: HistoryEntry[]) {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const entry = history[i];
    if (!entry) {
      continue;
    }
    if (
      typeof entry.tool_name === "string" &&
      entry.tool_name.startsWith("assistant.")
    ) {
      continue;
    }
    const payload = extractToolJsonPayload(entry.tool_result);
    if (payload !== undefined) {
      return payload;
    }
  }
  return undefined;
}

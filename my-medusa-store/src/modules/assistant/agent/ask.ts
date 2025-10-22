import { getMcp } from "../../../lib/mcp/manager";
import { metricsStore } from "../../../lib/metrics/store";
import { normalizeToolArgs, ensureMarkdownMinimum } from "../lib/utils";
import { FALLBACK_MESSAGE } from "../lib/plan-normalizer";
import { HistoryEntry, InitialOperation, McpTool } from "../lib/types";
import { AssistantModuleOptions } from "../config";
import { preloadOpenApiSuggestions } from "./preload";
import { executeTool, ExecuteOutcome } from "./tool-executor";
import { HistoryTracker, isMutatingExecuteCall } from "./history-tracker";
import { planNextAction } from "./planner-driver";
import { ValidationContinuationResult } from "../domain/validation/types";
import { createValidationGate } from "./validation-flow";

type AskInput = {
  prompt: string;
  history?: HistoryEntry[];
  onCancel?: (cancel: () => void) => void;
};

type AgentResult = ValidationContinuationResult;

type ToolSuccessContext = {
  outcome: ExecuteOutcome;
  toolName: string;
  args: Record<string, unknown>;
  cacheable: boolean;
};

const MAX_DUPLICATE_REPLAYS = 3;

export async function askAgent(
  input: AskInput,
  options: {
    config: AssistantModuleOptions;
    initialToolHistory?: HistoryEntry[];
    initialStep?: number;
  }
): Promise<AgentResult> {
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

  const seededHistory = [
    ...(options.initialToolHistory ?? []),
    ...(input.history ?? []),
  ];
  const historyTracker = new HistoryTracker(seededHistory);
  const turnId = metricsStore.startAssistantTurn({ user: prompt });
  let consecutiveDuplicateHits = 0;

  let isCancelled = false;
  if (typeof input.onCancel === "function") {
    input.onCancel(() => {
      isCancelled = true;
    });
  }

  const handleSuccessfulExecution = ({
    outcome,
    toolName,
    args,
    cacheable,
  }: ToolSuccessContext) => {
    const result = outcome.result;
    console.log(
      `   Tool Result: ${JSON.stringify(result).substring(0, 200)}...`
    );

    const durationMs =
      typeof outcome.durationMs === "number" && Number.isFinite(outcome.durationMs)
        ? outcome.durationMs
        : undefined;

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

    historyTracker.recordResult(toolName, args, result, cacheable, {
      durationMs,
      startedAtMs: outcome.startedAtMs,
      finishedAtMs: outcome.finishedAtMs,
    });

    if (outcome.summary) {
      historyTracker.recordSummary(toolName, outcome.summary);
    }
  };

  const runLoop = async (step: number): Promise<AgentResult> => {
    if (isCancelled) {
      throw new Error("Request was cancelled by the client.");
    }

    if (step >= options.config.maxSteps) {
      metricsStore.endAssistantTurn(turnId, "[aborted: max steps exceeded]");
      throw new Error(
        "The agent could not complete the request within the maximum number of steps."
      );
    }

    console.log(`\n--- AGENT LOOP: STEP ${step + 1} ---`);

    const { plan, rawPlan } = await planNextAction({
      prompt,
      tools: availableTools,
      history: historyTracker.list,
      modelName: options.config.modelName,
      initialOperations,
      config: options.config,
    });

    if (!plan) {
      console.warn("Planner returned an unrecognized plan", rawPlan);
      metricsStore.endAssistantTurn(turnId, FALLBACK_MESSAGE);
      return {
        answer: FALLBACK_MESSAGE,
        data: null,
        history: historyTracker.list,
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

      const latestPayload = historyTracker.latestPayload();
      const formattedAnswer = ensureMarkdownMinimum(chosenAnswer);

      return {
        answer: formattedAnswer,
        data: latestPayload ?? null,
        history: historyTracker.list,
      };
    }

    if (plan.action !== "call_tool" || !plan.tool_name || !plan.tool_args) {
      throw new Error("AI returned an invalid plan. Cannot proceed.");
    }

    const toolName = plan.tool_name;
    console.log(`  AI wants to call tool: ${toolName}`);
    console.log(`   With args: ${JSON.stringify(plan.tool_args)}`);

    const normalizedArgs = normalizeToolArgs(plan.tool_args);
    if (JSON.stringify(normalizedArgs) !== JSON.stringify(plan.tool_args)) {
      console.log(`   Normalized args: ${JSON.stringify(normalizedArgs)}`);
    }

    const cacheable =
      toolName === "openapi.execute" && isMutatingExecuteCall(normalizedArgs);
    const previousSuccess = historyTracker.getCachedSuccess(
      toolName,
      normalizedArgs,
      cacheable
    );

    if (previousSuccess) {
      consecutiveDuplicateHits += 1;
      console.log(
        "   2uplicate tool call detected; reusing prior successful result."
      );
      historyTracker.recordDuplicate(toolName, previousSuccess);
      if (consecutiveDuplicateHits >= MAX_DUPLICATE_REPLAYS) {
        metricsStore.endAssistantTurn(turnId, "[aborted: duplicate tool loop]");
        throw new Error(
          `Detected ${consecutiveDuplicateHits} consecutive duplicate tool calls for ${toolName}. Aborting to avoid infinite loop.`
        );
      }
      return runLoop(step + 1);
    }

    consecutiveDuplicateHits = 0;
    metricsStore.noteToolUsed(turnId, toolName);

    const outcome = await executeTool(
      {
        mcp,
        toolName,
        args: normalizedArgs as Record<string, unknown>,
      },
      { skipValidation: false }
    );

    if (outcome.validationRequest) {
      console.log(`    Validation required for operation`);
      return createValidationGate({
        request: outcome.validationRequest,
        mcp,
        toolName,
        args: normalizedArgs as Record<string, unknown>,
        historyTracker,
        cacheable,
        handleSuccessfulExecution,
        runNext: () => runLoop(step + 1),
        step,
      });
    }

    if (outcome.error) {
      historyTracker.recordError(toolName, normalizedArgs, outcome.error, {
        durationMs: outcome.durationMs,
        startedAtMs: outcome.startedAtMs,
        finishedAtMs: outcome.finishedAtMs,
      });
      return runLoop(step + 1);
    }

    handleSuccessfulExecution({
      outcome,
      toolName,
      args: normalizedArgs as Record<string, unknown>,
      cacheable,
    });

    return runLoop(step + 1);
  };

  return runLoop(options.initialStep ?? 0);
}

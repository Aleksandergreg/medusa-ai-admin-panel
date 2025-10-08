import { getMcp } from "../../../lib/mcp/manager";
import { metricsStore } from "../../../lib/metrics/store";
import { normalizeToolArgs, ensureMarkdownMinimum } from "../lib/utils";
import { FALLBACK_MESSAGE } from "../lib/plan-normalizer";
import { HistoryEntry, InitialOperation, McpTool } from "../lib/types";
import { AssistantModuleOptions } from "../config";
import { preloadOpenApiSuggestions } from "./preload";
import { executeTool } from "./tool-executor";
import { HistoryTracker, isMutatingExecuteCall } from "./history-tracker";
import { planNextAction } from "./planner-driver";

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

  const historyTracker = new HistoryTracker(input.history || []);

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

    if (plan.action === "call_tool" && plan.tool_name && plan.tool_args) {
      console.log(`  AI wants to call tool: ${plan.tool_name}`);
      console.log(`   With args: ${JSON.stringify(plan.tool_args)}`);

      const normalizedArgs = normalizeToolArgs(plan.tool_args);
      if (JSON.stringify(normalizedArgs) !== JSON.stringify(plan.tool_args)) {
        console.log(`   Normalized args: ${JSON.stringify(normalizedArgs)}`);
      }

      const cacheable =
        plan.tool_name === "openapi.execute" &&
        isMutatingExecuteCall(normalizedArgs);
      const previousSuccess = historyTracker.getCachedSuccess(
        plan.tool_name,
        normalizedArgs,
        cacheable
      );

      if (previousSuccess) {
        console.log(
          "   Duplicate tool call detected; reusing prior successful result."
        );
        historyTracker.recordDuplicate(plan.tool_name);
        continue;
      }

      metricsStore.noteToolUsed(turnId, plan.tool_name);

      const outcome = await executeTool({
        mcp,
        toolName: plan.tool_name!,
        args: normalizedArgs as Record<string, unknown>,
      });

      // Handle validation request
      if (outcome.validationRequest) {
        console.log(`   🛑 Validation required for operation`);

        // Determine operation type for user-friendly message
        const isDelete = outcome.validationRequest.method === "DELETE";
        const action = isDelete ? "delete" : "create";

        // Return early with a special message indicating validation is needed
        const validationMessage = `## 🔐 Your Approval is Required\n\nI've prepared everything to ${action} this item, but I need your confirmation before proceeding.\n\nPlease review the details below and click **"Approve & Execute"** if you'd like me to continue, or **"Cancel"** if you've changed your mind.`;

        return {
          answer: validationMessage,
          data: outcome.validationRequest,
          history: historyTracker.list,
        };
      }

      if (outcome.error) {
        historyTracker.recordError(plan.tool_name, normalizedArgs, outcome.error);
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

      historyTracker.recordResult(
        plan.tool_name,
        normalizedArgs,
        result,
        cacheable
      );

      if (outcome.summary) {
        historyTracker.recordSummary(plan.tool_name, outcome.summary);
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

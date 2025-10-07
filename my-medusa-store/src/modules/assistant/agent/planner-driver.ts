import { AssistantModuleOptions } from "../config";
import { FALLBACK_MESSAGE, normalizePlan, NormalizedPlan } from "../lib/plan-normalizer";
import { HistoryEntry, InitialOperation, McpTool } from "../lib/types";
import { planNextStepWithGemini } from "./planner";

export type PlanResult = {
  plan: NormalizedPlan | null;
  rawPlan: unknown;
};

export async function planNextAction(params: {
  prompt: string;
  tools: McpTool[];
  history: HistoryEntry[];
  modelName: string;
  initialOperations: InitialOperation[];
  config: AssistantModuleOptions;
}): Promise<PlanResult> {
  const rawPlan = await planNextStepWithGemini(
    params.prompt,
    params.tools,
    params.history,
    params.modelName,
    params.initialOperations,
    params.config
  );

  if (!rawPlan) {
    return { plan: null, rawPlan: FALLBACK_MESSAGE };
  }

  return { plan: normalizePlan(rawPlan), rawPlan };
}

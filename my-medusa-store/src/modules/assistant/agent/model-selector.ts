import { AssistantModuleOptions } from "../config";
import { HistoryEntry } from "../lib/types";

type Strategy = NonNullable<AssistantModuleOptions["finalModelStrategy"]>;

export type ModelSelectionContext = {
  prompt: string;
  planAnswer?: string;
  history: HistoryEntry[];
  config: AssistantModuleOptions;
};

const DEFAULT_THRESHOLD = 3;
const COMPLEX_KEYWORDS = [
  "analyz",
  "insight",
  "trend",
  "forecast",
  "projection",
  "regression",
  "statistic",
  "variance",
  "correlat",
  "compare",
  "benchmark",
  "optimiz",
  "growth",
  "decline",
  "strategy",
  "churn",
  "retention",
  "conversion",
  "margin",
  "revenue",
  "profit",
  "segment",
  "cohort",
  "distribution",
  "histogram",
  "ratio",
  "percentile",
];

const HIGH_IMPACT_VERBS = ["explain", "evaluate", "diagnose", "investigate", "improve"];

const isAssistantTool = (name: string | undefined): boolean =>
  typeof name === "string" && name.startsWith("assistant.");

const isConversationMarker = (name: string | undefined): boolean =>
  name === "conversation";

const countActualToolCalls = (history: HistoryEntry[]): number =>
  history.filter(
    (entry) =>
      Boolean(entry?.tool_name) &&
      !isAssistantTool(entry.tool_name) &&
      !isConversationMarker(entry.tool_name)
  ).length;

const countSummaries = (history: HistoryEntry[]): number =>
  history.filter((entry) => entry?.tool_name === "assistant.summary").length;

const containsKeyword = (text: string, keywords: string[]): boolean => {
  const lowered = text.toLowerCase();
  return keywords.some((keyword) => lowered.includes(keyword));
};

const computePromptScore = (prompt: string): number => {
  if (!prompt.trim()) return 0;

  let score = 0;

  if (containsKeyword(prompt, COMPLEX_KEYWORDS)) {
    score += 2;
  }

  if (containsKeyword(prompt, HIGH_IMPACT_VERBS)) {
    score += 1;
  }

  if (/(\bmonth|\bquarter|\byear|\bweek)\b/i.test(prompt)) {
    score += 1;
  }

  if (/(vs\.|versus|compared to|difference between)/i.test(prompt)) {
    score += 1;
  }

  return score;
};

const computePlanScore = (planAnswer?: string): number => {
  if (!planAnswer) return 0;
  const trimmed = planAnswer.trim();
  if (!trimmed.length) return 0;

  let score = 0;

  if (trimmed.length > 900) {
    score += 2;
  } else if (trimmed.length > 450) {
    score += 1;
  }

  if (/(trend|analysis|insight|suggest)/i.test(trimmed)) {
    score += 1;
  }

  if (/(```|table|chart)/i.test(trimmed)) {
    score += 1;
  }

  return score;
};

const computeHistoryScore = (history: HistoryEntry[]): number => {
  if (!history.length) return 0;

  const toolCalls = countActualToolCalls(history);
  const summaries = countSummaries(history);

  let score = 0;

  if (toolCalls >= 4) {
    score += 2;
  } else if (toolCalls >= 2) {
    score += 1;
  }

  if (summaries >= 2) {
    score += 2;
  } else if (summaries >= 1) {
    score += 1;
  }

  return score;
};

const computeComplexityScore = (context: ModelSelectionContext): number => {
  return (
    computePromptScore(context.prompt) +
    computePlanScore(context.planAnswer) +
    computeHistoryScore(context.history)
  );
};

const resolveStrategy = (config: AssistantModuleOptions): Strategy =>
  config.finalModelStrategy ?? "always";

const resolveThreshold = (config: AssistantModuleOptions): number =>
  Number.isFinite(config.finalModelAdaptiveThreshold)
    ? (config.finalModelAdaptiveThreshold as number)
    : DEFAULT_THRESHOLD;

export function pickFinalResponseModel(
  context: ModelSelectionContext
): string | null {
  const configuredFinalModel = context.config.finalModelName;
  if (!configuredFinalModel) {
    return null;
  }

  if (configuredFinalModel === context.config.modelName) {
    return null;
  }

  const strategy = resolveStrategy(context.config);
  if (strategy === "never") {
    return null;
  }

  if (strategy === "always") {
    return configuredFinalModel;
  }

  const threshold = resolveThreshold(context.config);
  const score = computeComplexityScore(context);

  console.log(
    `[Assistant] Adaptive final model score=${score} threshold=${threshold} (strategy=${strategy})`
  );

  if (score >= threshold) {
    return configuredFinalModel;
  }

  return null;
}

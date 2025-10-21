import { AgentNpsEvaluation } from "./types";
import { extractToolJsonPayload, isPlainRecord } from "../../lib/utils";
import type { HistoryEntry } from "../../lib/types";

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

type OperationAnalysis = {
  attempts: number;
  errors: number;
  success: boolean;
  lastStatusCode: number | null;
  summaries: string[];
};

// The default expected duration for an agent operation is set to 60 seconds (60,000 ms).
// This value reflects the typical time required for most standard agent operations,
// such as API calls or data processing tasks, balancing responsiveness with the
// need to allow sufficient time for completion. Longer durations are only assigned
// to specific operations known to take more time (e.g., price list or promotion updates).
const DEFAULT_EXPECTED_MS = 60_000;
const normalizeOperationIdentifier = (value: string): string =>
  value.toLowerCase().replace(/[_-]/g, "");

const extractOperationIdentifier = (
  args: Record<string, unknown>
): string | null => {
  const camel = args.operationId;
  if (typeof camel === "string" && camel.trim().length) {
    return camel;
  }
  const snake = (args as Record<string, unknown>).operation_id;
  if (typeof snake === "string" && snake.trim().length) {
    return snake;
  }
  return null;
};

const analyzeOperationHistory = (
  history: HistoryEntry[],
  operationId: string
): OperationAnalysis => {
  let attempts = 0;
  let errors = 0;
  let success = false;
  let lastStatusCode: number | null = null;
  const summaries: string[] = [];

  for (const entry of history) {
    if (entry.tool_name !== "openapi.execute") {
      continue;
    }

    const args = entry.tool_args as Record<string, unknown>;
    if (!args) {
      continue;
    }

    const entryOperationId = extractOperationIdentifier(args);
    if (!entryOperationId) {
      continue;
    }

    const normalizedTarget = normalizeOperationIdentifier(operationId);
    const normalizedEntry = normalizeOperationIdentifier(entryOperationId);
    if (
      entryOperationId !== operationId &&
      normalizedEntry !== normalizedTarget
    ) {
      continue;
    }

    attempts += 1;
    const payload = extractToolJsonPayload(entry.tool_result);

    if (isPlainRecord(payload)) {
      const status = payload.statusCode ?? payload.status ?? null;
      lastStatusCode =
        typeof status === "number" ? status : Number(status ?? NaN);
      const message =
        typeof payload.message === "string" ? payload.message : null;
      if (typeof lastStatusCode === "number") {
        if (lastStatusCode >= 200 && lastStatusCode < 300) {
          success = true;
        } else if (lastStatusCode >= 400) {
          errors += 1;
        }
      }
      if (message) {
        summaries.push(message);
      }
    } else if (
      entry.tool_result &&
      typeof entry.tool_result === "object" &&
      (entry.tool_result as Record<string, unknown>).error
    ) {
      errors += 1;
    }
  }

  return {
    attempts,
    errors,
    success,
    lastStatusCode: Number.isFinite(lastStatusCode) ? lastStatusCode : null,
    summaries,
  };
};

const normalizeSearchText = (value: string | null | undefined): string =>
  typeof value === "string" && value.trim().length
    ? value.trim().toLowerCase().replace(/[_-]+/g, " ")
    : "";

const includesAny = (target: string, terms: string[]): boolean =>
  terms.some((term) => target.includes(term));

const getExpectedMs = (
  operationId: string,
  taskLabel: string | null
): number => {
  const searchText = [
    normalizeSearchText(taskLabel),
    normalizeSearchText(operationId),
  ]
    .filter(Boolean)
    .join(" ");

  if (searchText && includesAny(searchText, ["price list", "pricelist"])) {
    return 240_000;
  }

  if (searchText && includesAny(searchText, ["promotion", "promo"])) {
    return 150_000;
  }

  if (searchText && includesAny(searchText, ["order"])) {
    return 90_000;
  }

  return DEFAULT_EXPECTED_MS;
};

export function evaluateAgentNpsScore(params: {
  operationId: string;
  taskLabel: string | null;
  history: HistoryEntry[];
  durationMs: number;
  agentComputeMs?: number | null;
}): AgentNpsEvaluation | null {
  const { operationId, history, durationMs, agentComputeMs } = params;
  const analysis = analyzeOperationHistory(history, operationId);

  if (analysis.attempts === 0) {
    return null;
  }

  // If the agent never achieved success, still record a score describing the struggle.
  let score = analysis.success ? 10 : 4;

  if (analysis.attempts > 1) {
    score -= clamp(analysis.attempts - 1, 0, 3);
  }

  if (analysis.errors > 0) {
    score -= clamp(analysis.errors * 2, 0, 6);
  }

  const expectedMs = getExpectedMs(operationId, params.taskLabel);

  if (expectedMs > 0) {
    const effectiveDurationMs =
      typeof agentComputeMs === "number" && Number.isFinite(agentComputeMs)
        ? Math.max(0, agentComputeMs)
        : durationMs;
    const ratio = expectedMs ? effectiveDurationMs / expectedMs : 0;

    if (ratio > 2.0) {
      score -= 3;
    } else if (ratio > 1.25) {
      score -= 2;
    } else if (ratio > 1.0) {
      score -= 1;
    }
  }

  score = clamp(Math.round(score), 0, 10);

  const notes: string[] = [];
  if (analysis.success) {
    notes.push("Completed successfully");
  } else {
    notes.push("Did not reach a successful outcome");
  }
  if (analysis.attempts > 1) {
    notes.push(`Attempts: ${analysis.attempts}`);
  }
  if (analysis.errors > 0) {
    notes.push(`Errors: ${analysis.errors}`);
  }
  if (durationMs) {
    notes.push(`Duration: ${(durationMs / 1000).toFixed(1)}s`);
  }
  if (
    typeof agentComputeMs === "number" &&
    Number.isFinite(agentComputeMs) &&
    agentComputeMs >= 0 &&
    (!durationMs || Math.abs(agentComputeMs - durationMs) > 1_000)
  ) {
    notes.push(`Compute: ${(agentComputeMs / 1000).toFixed(1)}s`);
  }
  if (analysis.lastStatusCode !== null) {
    notes.push(`Last status: ${analysis.lastStatusCode}`);
  }
  if (analysis.summaries.length) {
    notes.push(
      `Messages: ${analysis.summaries.slice(-2).join(" | ").substring(0, 200)}`
    );
  }

  return {
    score,
    errorFlag: !analysis.success || analysis.errors > 0,
    errorSummary: analysis.success
      ? null
      : analysis.summaries.slice(-1)[0] ?? null,
    attempts: analysis.attempts,
    errors: analysis.errors,
    durationMs,
    feedbackNote: notes.join("; "),
  };
}

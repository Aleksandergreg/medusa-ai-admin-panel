import { AgentNpsEvaluation } from "./anps";
import { extractToolJsonPayload, isPlainRecord } from "./utils";
import type { HistoryEntry } from "./types";

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

type OperationAnalysis = {
  attempts: number;
  errors: number;
  success: boolean;
  lastStatusCode: number | null;
  summaries: string[];
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
    if (!args || args.operationId !== operationId) {
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

export function evaluateAgentNpsScore(params: {
  operationId: string;
  taskLabel: string | null;
  history: HistoryEntry[];
  durationMs: number;
}): AgentNpsEvaluation | null {
  const { operationId, history, durationMs } = params;
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

  if (durationMs > 180_000) {
    score -= 3;
  } else if (durationMs > 60_000) {
    score -= 2;
  } else if (durationMs > 20_000) {
    score -= 1;
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
  if (analysis.lastStatusCode != null) {
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
    errorSummary: analysis.success ? null : analysis.summaries.slice(-1)[0] ?? null,
    attempts: analysis.attempts,
    errors: analysis.errors,
    durationMs,
    feedbackNote: notes.join("; "),
  };
}

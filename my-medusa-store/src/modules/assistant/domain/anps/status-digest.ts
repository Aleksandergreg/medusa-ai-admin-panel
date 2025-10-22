import type { HistoryEntry } from "../../lib/types";
import { extractToolJsonPayload, isPlainRecord } from "../../lib/utils";
import {
  extractOperationIdentifier,
  normalizeOperationIdentifier,
} from "./operation-utils";

export type StatusDigest = {
  statusCode: number | null;
  message: string | null;
  operationSummary: string | null;
};

const MAX_STATUS_ENTRIES = 5;

const coerceStatusCode = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }

  return null;
};

export const summarizeStatusMessages = (
  history: HistoryEntry[],
  operationId: string
): StatusDigest[] => {
  const normalizedTarget = normalizeOperationIdentifier(operationId);
  const digests: StatusDigest[] = [];

  for (let i = history.length - 1; i >= 0; i -= 1) {
    const entry = history[i];
    if (entry.tool_name !== "openapi.execute") {
      continue;
    }

    const args =
      entry.tool_args && typeof entry.tool_args === "object"
        ? (entry.tool_args as Record<string, unknown>)
        : null;
    if (!args) {
      continue;
    }

    const entryId = extractOperationIdentifier(args);
    if (!entryId) {
      continue;
    }
    const normalizedEntry = normalizeOperationIdentifier(entryId);
    if (normalizedEntry !== normalizedTarget) {
      continue;
    }

    const payload = extractToolJsonPayload(entry.tool_result);
    let statusCode: number | null = null;
    let message: string | null = null;

    if (isPlainRecord(payload)) {
      statusCode =
        coerceStatusCode(
          payload.statusCode ?? payload.status ?? payload.code
        ) ?? null;
      if (typeof payload.message === "string" && payload.message.trim()) {
        message = payload.message.trim();
      } else if (typeof payload.error === "string" && payload.error.trim()) {
        message = payload.error.trim();
      } else if (typeof payload.title === "string" && payload.title.trim()) {
        message = payload.title.trim();
      }
    } else if (
      entry.tool_result &&
      typeof entry.tool_result === "object" &&
      (entry.tool_result as Record<string, unknown>).error
    ) {
      const rawError = (entry.tool_result as Record<string, unknown>).error;
      message =
        typeof rawError === "string" && rawError.trim()
          ? rawError.trim()
          : null;
    }

    const summary =
      typeof args.summary === "string" && args.summary.trim()
        ? args.summary.trim()
        : entryId;

    digests.push({
      statusCode,
      message,
      operationSummary: summary,
    });

    if (digests.length >= MAX_STATUS_ENTRIES) {
      break;
    }
  }

  return digests.reverse();
};

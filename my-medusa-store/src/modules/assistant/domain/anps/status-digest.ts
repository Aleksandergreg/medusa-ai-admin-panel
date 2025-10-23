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

    const candidateRecords: Record<string, unknown>[] = [];

    if (isPlainRecord(payload)) {
      candidateRecords.push(payload);
    }

    const resultRecord = isPlainRecord(entry.tool_result)
      ? (entry.tool_result as Record<string, unknown>)
      : null;
    if (resultRecord) {
      candidateRecords.push(resultRecord);
      const nestedResult = resultRecord.result;
      if (isPlainRecord(nestedResult)) {
        candidateRecords.push(nestedResult);
      }
      const nestedPayload = extractToolJsonPayload(resultRecord.result);
      if (isPlainRecord(nestedPayload)) {
        candidateRecords.push(nestedPayload);
      }
    }

    const tryReadMessage = (value: unknown): string | null =>
      typeof value === "string" && value.trim().length
        ? value.trim()
        : null;

    for (const record of candidateRecords) {
      if (statusCode === null) {
        const rawStatus =
          record["statusCode"] ??
          record["status"] ??
          record["code"] ??
          record["status_code"];
        const coerced = coerceStatusCode(rawStatus);
        if (coerced !== null) {
          statusCode = coerced;
        }
      }

      if (!message) {
        const errorField = record["error"];
        const candidates: unknown[] = [
          errorField,
          record["message"],
          record["statusText"],
          record["reason"],
          record["title"],
        ];

        for (const candidate of candidates) {
          const normalized = tryReadMessage(candidate);
          if (normalized) {
            message = normalized;
            break;
          }
        }
      }

      if (statusCode !== null && message) {
        break;
      }
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

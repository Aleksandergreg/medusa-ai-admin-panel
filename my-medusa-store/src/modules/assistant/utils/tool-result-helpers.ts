/**
 * Helper functions for processing MCP tool execution results
 */

import type { ToolExecutionResult } from "./type-guards";

export const getFirstTextContent = (
  result: ToolExecutionResult
): string | null => {
  if (!result?.content || !Array.isArray(result.content)) {
    return null;
  }

  for (const entry of result.content) {
    if (
      entry &&
      typeof entry === "object" &&
      entry.type === "text" &&
      typeof entry.text === "string"
    ) {
      return entry.text;
    }
  }

  return null;
};

export const safeParseJson = <T>(value: string | null): T | null => {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
};

export const normalizeErrorMessage = (
  raw: string | null,
  fallback: string
): string => {
  if (!raw) {
    return fallback;
  }

  const trimmed = raw.replace(/^Error:\s*/i, "").trim();
  return trimmed.length ? trimmed : fallback;
};

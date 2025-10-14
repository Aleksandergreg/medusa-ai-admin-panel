/**
 * Type guards and validators for MCP tool execution results
 */

export type ToolContentEntry = {
  type?: string;
  text?: string;
  [k: string]: unknown;
};

export type ToolExecutionResult = {
  content?: ToolContentEntry[];
  isError?: boolean;
  [k: string]: unknown;
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const isToolContentEntry = (
  value: unknown
): value is ToolContentEntry => {
  if (!isRecord(value)) {
    return false;
  }

  const { type, text } = value as { type?: unknown; text?: unknown };
  if (type !== undefined && typeof type !== "string") {
    return false;
  }
  if (text !== undefined && typeof text !== "string") {
    return false;
  }
  return true;
};

export const isToolExecutionResult = (
  value: unknown
): value is ToolExecutionResult => {
  if (!isRecord(value)) {
    return false;
  }

  const isError = (value as { isError?: unknown }).isError;
  if (isError !== undefined && typeof isError !== "boolean") {
    return false;
  }

  if ("content" in value) {
    const content = (value as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      return false;
    }
    if (!content.every(isToolContentEntry)) {
      return false;
    }
  }

  return true;
};

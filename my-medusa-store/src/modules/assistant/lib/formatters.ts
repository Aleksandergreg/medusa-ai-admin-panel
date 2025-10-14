import { isPlainRecord } from "./utils";
import { resolveLabel } from "./label-utils";

export const hasRenderableData = (value: unknown): boolean => {
  if (value === undefined) return false;
  if (value === null) return true;
  if (Array.isArray(value)) {
    return value.some((item) => hasRenderableData(item));
  }
  if (isPlainRecord(value)) {
    return Object.values(value).some((entry) => hasRenderableData(entry));
  }
  return true;
};

export const prettifyKey = (key: string): string =>
  key
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());

export const formatPrimitive = (value: unknown): string => {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : '""';
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export const formatArray = (
  values: unknown[],
  indent: number,
  labelMap: Map<string, string>
): string => {
  if (!values.length) {
    return `${"  ".repeat(indent)}- (none)`;
  }

  return values
    .map((item) => {
      const prefix = `${"  ".repeat(indent)}- `;
      if (isPlainRecord(item)) {
        const nested = formatRecord(item, indent + 1, labelMap);
        return `${prefix}Item\n${nested}`;
      }
      if (Array.isArray(item)) {
        const nested = formatArray(item, indent + 1, labelMap);
        return `${prefix}Items\n${nested}`;
      }
      if (typeof item === "string") {
        const label = resolveLabel(item, labelMap);
        if (label && label !== item) {
          return `${prefix}${label} (${item})`;
        }
      }
      return `${prefix}${formatPrimitive(item)}`;
    })
    .join("\n");
};

export const formatRecord = (
  record: Record<string, unknown>,
  indent = 0,
  labelMap: Map<string, string>
): string => {
  const entries = Object.entries(record).filter(([, value]) =>
    hasRenderableData(value)
  );
  if (!entries.length) {
    return `${"  ".repeat(indent)}- (empty)`;
  }

  return entries
    .map(([key, value]) => {
      const prefix = `${"  ".repeat(indent)}- **${prettifyKey(key)}**`;
      if (isPlainRecord(value)) {
        const nested = formatRecord(value, indent + 1, labelMap);
        return `${prefix}\n${nested}`;
      }
      if (Array.isArray(value)) {
        const nested = formatArray(value, indent + 1, labelMap);
        return `${prefix}\n${nested}`;
      }
      if (typeof value === "string") {
        const label = resolveLabel(value, labelMap);
        if (label && label !== value) {
          return `${prefix}: ${label} (${value})`;
        }
      }
      return `${prefix}: ${formatPrimitive(value)}`;
    })
    .join("\n");
};

export const formatData = (
  value: unknown,
  indent = 0,
  labelMap: Map<string, string>
): string => {
  if (Array.isArray(value)) {
    return formatArray(value, indent, labelMap);
  }
  if (isPlainRecord(value)) {
    return formatRecord(value, indent, labelMap);
  }
  if (!hasRenderableData(value)) {
    return "";
  }
  if (typeof value === "string") {
    const label = resolveLabel(value, labelMap);
    if (label && label !== value) {
      return `${"  ".repeat(indent)}- ${label} (${value})`;
    }
  }
  return `${"  ".repeat(indent)}- ${formatPrimitive(value)}`;
};

export const extractRecord = (
  source: Record<string, unknown>,
  keys: string[]
): Record<string, unknown> | undefined => {
  for (const key of keys) {
    const candidate = source[key];
    if (isPlainRecord(candidate)) {
      return candidate;
    }
  }
  return undefined;
};

export const normalizeBodyForDisplay = (value: unknown): unknown => {
  if (value === undefined) {
    return undefined;
  }
  if (isPlainRecord(value) || Array.isArray(value)) {
    return value;
  }
  return { Value: value };
};


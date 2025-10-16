import { isPlainRecord } from "./utils";
import { pickLabelFromRecord, resolveLabel } from "./label-utils";

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

const ACRONYM_REPLACEMENTS: Record<string, string> = {
  Id: "ID",
  Ids: "IDs",
  Url: "URL",
  Sku: "SKU",
  Skus: "SKUs",
  Api: "API",
};

const replaceAcronyms = (value: string): string => {
  return value.replace(/\b([A-Z][a-z]+)\b/g, (match) => {
    return ACRONYM_REPLACEMENTS[match] ?? match;
  });
};

export const prettifyKey = (key: string): string => {
  const cleaned = key
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
  return replaceAcronyms(cleaned);
};

const GENERIC_SEGMENTS = new Set([
  "data",
  "details",
  "attributes",
  "attribute",
  "items",
  "item",
  "nodes",
  "node",
  "payload",
  "body",
]);

const humanizeStructuredPath = (value: string): string | undefined => {
  const trimmed = value.trim();
  if (!trimmed.includes(".") || !/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    return undefined;
  }

  const segments = trimmed
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length < 2) {
    return undefined;
  }

  const filtered = segments.filter(
    (segment) => !GENERIC_SEGMENTS.has(segment.toLowerCase())
  );

  if (!filtered.length) {
    return undefined;
  }

  const last = filtered[filtered.length - 1];
  const secondLast = filtered[filtered.length - 2];

  if (last.toLowerCase() === "id" && secondLast) {
    return prettifyKey(`${secondLast} ID`);
  }
  if (last.toLowerCase() === "ids" && secondLast) {
    return prettifyKey(`${secondLast} IDs`);
  }

  const significantSegments =
    filtered.length >= 2 ? filtered.slice(-2) : filtered.slice(-1);
  return prettifyKey(significantSegments.join(" "));
};

const formatStringValue = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed.length) {
    return '""';
  }

  const humanized = humanizeStructuredPath(trimmed);
  return humanized ?? trimmed;
};

export const formatPrimitive = (value: unknown): string => {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }
  if (typeof value === "string") {
    return formatStringValue(value);
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

const GENERIC_RECORD_LABELS = new Set([
  "true",
  "false",
  "null",
  "undefined",
  "in",
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "exists",
  "not exists",
]);

interface FormatOptions {
  omitKeys?: Set<string>;
}

const resolveRecordHeading = (
  recordItem: Record<string, unknown>
): { heading?: string; omit?: Set<string> } => {
  const description = recordItem["description"];
  if (typeof description === "string") {
    const trimmed = description.trim();
    if (trimmed.length) {
      return {
        heading: trimmed,
        omit: new Set(["description"]),
      };
    }
  }

  const label = pickLabelFromRecord(recordItem);
  if (!label) {
    return {};
  }

  const normalized = label.trim().toLowerCase();
  if (!label.trim().length || GENERIC_RECORD_LABELS.has(normalized)) {
    return {};
  }
  return { heading: label };
};

const CONTEXT_NAME_KEYS = [
  "attribute",
  "field",
  "target",
  "target_attribute",
  "targetField",
  "subject",
  "resource",
  "item_type",
  "itemType",
  "relationship",
  "scope",
  "collection",
];

const deriveContextName = (record: Record<string, unknown>): string | undefined => {
  for (const key of CONTEXT_NAME_KEYS) {
    const raw = record[key];
    if (typeof raw === "string" && raw.trim().length) {
      const humanized = humanizeStructuredPath(raw) ?? prettifyKey(raw);
      if (humanized.trim().length) {
        return humanized;
      }
    }
  }

  for (const key of CONTEXT_NAME_KEYS) {
    const raw = record[key];
    if (isPlainRecord(raw)) {
      const nested = pickLabelFromRecord(raw);
      if (nested) {
        return nested;
      }
    }
  }

  const label = pickLabelFromRecord(record);
  if (label) {
    return label;
  }

  return undefined;
};

const pluralizeDisplayName = (name: string): string => {
  const lower = name.toLowerCase();
  if (lower.endsWith("s") || lower.endsWith("x") || lower.endsWith("z")) {
    return prettifyKey(name);
  }
  if (lower.endsWith("y") && !/[aeiou]y$/i.test(name)) {
    return prettifyKey(`${name.slice(0, -1)}ies`);
  }
  if (lower.endsWith("f")) {
    return prettifyKey(`${name.slice(0, -1)}ves`);
  }
  if (lower.endsWith("fe")) {
    return prettifyKey(`${name.slice(0, -2)}ves`);
  }
  return prettifyKey(`${name}s`);
};

const formatArray = (
  values: unknown[],
  indent: number,
  labelMap: Map<string, string>,
  parentKey?: string
): string => {
  if (!values.length) {
    return `${"  ".repeat(indent)}- (none)`;
  }

  return values
    .map((item) => {
      const prefix = `${"  ".repeat(indent)}- `;
      if (isPlainRecord(item)) {
        const recordItem = item as Record<string, unknown>;
        const { heading, omit } = resolveRecordHeading(recordItem);
        const headingText = heading ? `**${heading}**` : "Details";
        const nested = formatRecord(recordItem, indent + 1, labelMap, {
          omitKeys: omit,
        });
        return `${prefix}${headingText}\n${nested}`;
      }
      if (Array.isArray(item)) {
        const nested = formatArray(item, indent + 1, labelMap, parentKey);
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

const friendlyKeyForRecord = (
  record: Record<string, unknown>,
  key: string
): string => {
  if (/_id$/i.test(key)) {
    return prettifyKey(key).replace(/Id\b/i, "ID");
  }
  if (/_ids$/i.test(key)) {
    return prettifyKey(key).replace(/Ids\b/i, "IDs");
  }

  if (/^is_/i.test(key)) {
    const rest = key.replace(/^is_/i, "");
    return `Is ${prettifyKey(rest)}`;
  }

  if (key === "attribute") {
    return "Target Field";
  }
  if (key === "values") {
    const attribute = record["attribute"];
    if (typeof attribute === "string") {
      const humanized = humanizeStructuredPath(attribute);
      if (humanized) {
        const base = humanized.replace(/\bID(s?)\b/g, "").trim();
        if (base.length) {
          return `Selected ${pluralizeDisplayName(base)}`;
        }
      }
    }
    const contextName = deriveContextName(record);
    if (contextName) {
      return `Selected ${pluralizeDisplayName(contextName)}`;
    }
    return "Selected Items";
  }
  if (key === "operator") {
    return "Condition";
  }

  if (key === "description") {
    return "Description";
  }

  return prettifyKey(key);
};

export const formatRecord = (
  record: Record<string, unknown>,
  indent = 0,
  labelMap: Map<string, string>,
  options: FormatOptions = {}
): string => {
  const entries = Object.entries(record).filter(([, value]) =>
    hasRenderableData(value)
  );
  if (!entries.length) {
    return `${"  ".repeat(indent)}- (empty)`;
  }

  return entries
    .filter(([key]) => !(options.omitKeys?.has(key)))
    .map(([key, value]) => {
      const friendlyKey = friendlyKeyForRecord(record, key);
      const prefix = `${"  ".repeat(indent)}- **${friendlyKey}**`;
      if (isPlainRecord(value)) {
        const nested = formatRecord(value, indent + 1, labelMap);
        return `${prefix}\n${nested}`;
      }
      if (Array.isArray(value)) {
        const nested = formatArray(value, indent + 1, labelMap, key);
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

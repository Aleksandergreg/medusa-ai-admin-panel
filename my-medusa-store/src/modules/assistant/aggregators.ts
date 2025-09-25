import { JSONObject } from "./utils";

export type CountEntry = {
  value: string;
  count: number;
};

export type CountSummary = {
  path: string;
  total: number;
  unique: number;
  counts: CountEntry[];
  top?: CountEntry;
};

export type AssistantSummary = {
  aggregates: CountSummary[];
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asJSONObject = (value: unknown): JSONObject | undefined =>
  isObject(value) && !Array.isArray(value) ? (value as JSONObject) : undefined;

const isScalar = (value: unknown): value is string | number | boolean =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean";

const normalizeScalar = (value: string | number | boolean): string => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : "(empty)";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "(nan)";
  }
  return value ? "true" : "false";
};

export function summarizePayload(payload: unknown): AssistantSummary | undefined {
  if (!isObject(payload)) return undefined;

  const countsByPath = new Map<string, Map<string, number>>();
  const totalsByPath = new Map<string, number>();

  const addCount = (path: string, value: string) => {
    if (!path) return;
    const bucket = countsByPath.get(path) ?? new Map<string, number>();
    bucket.set(value, (bucket.get(value) ?? 0) + 1);
    countsByPath.set(path, bucket);
    totalsByPath.set(path, (totalsByPath.get(path) ?? 0) + 1);
  };

  const visit = (value: unknown, path: string) => {
    if (value === null || value === undefined) {
      return;
    }
    if (Array.isArray(value)) {
      const nextPath = path ? `${path}[]` : "[]";
      for (const entry of value) {
        visit(entry, nextPath);
      }
      return;
    }
    if (isObject(value)) {
      const obj = value as JSONObject;
      for (const [key, child] of Object.entries(obj)) {
        const nextPath = path ? `${path}.${key}` : key;
        visit(child, nextPath);
      }
      return;
    }
    if (isScalar(value)) {
      const normalized = normalizeScalar(value);
      addCount(path, normalized);
    }
  };

  visit(payload, "");

  const summaries: CountSummary[] = [];
  for (const [path, valueCounts] of countsByPath.entries()) {
    const entries = Array.from(valueCounts.entries()).sort((a, b) => b[1] - a[1]);
    const total = totalsByPath.get(path) ?? 0;
    const hasDuplicates = entries.some(([, count]) => count > 1);
    if (!hasDuplicates) {
      continue;
    }

    const counts: CountEntry[] = entries.slice(0, 10).map(([value, count]) => ({
      value,
      count,
    }));

    const summary: CountSummary = {
      path,
      total,
      unique: valueCounts.size,
      counts,
      top: counts.length ? counts[0] : undefined,
    };

    summaries.push(summary);
  }

  if (!summaries.length) {
    return undefined;
  }

  summaries.sort((a, b) => {
    const topA = a.top?.count ?? 0;
    const topB = b.top?.count ?? 0;
    return topB - topA;
  });

  return { aggregates: summaries } satisfies AssistantSummary;
}


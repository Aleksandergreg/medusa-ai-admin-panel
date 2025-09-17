// Common utilities used by the assistant module

export function env(key: string): string | undefined {
  return (process.env as NodeJS.ProcessEnv)?.[key];
}

export function stripJsonFences(text: string): string {
  const fence = /```(?:json)?\n([\s\S]*?)\n```/i;
  const m = text?.match?.(fence);
  return m ? m[1] : text;
}

/** A safe description of JSON values */
export type JSONPrimitive = string | number | boolean | null;
export type JSONValue = JSONPrimitive | JSONObject | JSONArray;
export interface JSONObject { [key: string]: JSONValue }
export interface JSONArray extends Array<JSONValue> {}

/** Type guards */
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

const isJSONObject = (v: unknown): v is JSONObject =>
  isObject(v) && !Array.isArray(v);

const isArray = (v: unknown): v is unknown[] => Array.isArray(v);

/**
 * Parse a JSON-looking string safely. Returns T if you know the shape,
 * otherwise defaults to JSONValue.
 */
export function safeParseJSON<T = JSONValue>(maybeJson: unknown): T | undefined {
  if (typeof maybeJson !== "string") return undefined;
  const stripped = stripJsonFences(maybeJson).trim();

  // Try direct parse first
  try {
    return JSON.parse(stripped) as T;
  } catch (err) {
    console.error(err);
  }

  // Try object slice { ... }
  const firstObj = stripped.indexOf("{");
  const lastObj = stripped.lastIndexOf("}");
  if (firstObj !== -1 && lastObj !== -1 && lastObj > firstObj) {
    try {
      return JSON.parse(stripped.slice(firstObj, lastObj + 1)) as T;
    } catch (err) {
      console.error(err);
    }
  }

  // Try array slice [ ... ]
  const firstArr = stripped.indexOf("[");
  const lastArr = stripped.lastIndexOf("]");
  if (firstArr !== -1 && lastArr !== -1 && lastArr > firstArr) {
    try {
      return JSON.parse(stripped.slice(firstArr, lastArr + 1)) as T;
    } catch (err) {
      console.error(err);
    }
  }
  return undefined;
}

// MCP result: { content: [{ type:"text", text: "...json..." }], isError? }
type ToolContentBase = { type: string } & Record<string, unknown>;
type ToolContentText = ToolContentBase & { type: "text"; text: string };
type ToolContent = ToolContentText | ToolContentBase;

export interface MCPResult {
  content?: ToolContent[];
  isError?: boolean;
  // allow unknown extra fields
  [k: string]: unknown;
}

const isToolContentText = (c: unknown): c is ToolContentText => {
  if (!isObject(c)) return false;
  const type = c["type"];
  const text = (c as Record<string, unknown>)["text"];
  return type === "text" && typeof text === "string";
};

export function extractToolJsonPayload(toolResult: unknown): JSONValue | undefined {
  try {
    const content = (isObject(toolResult) ? (toolResult as { content?: unknown }).content : undefined);
    if (!Array.isArray(content)) return undefined;

    // find the first { type: 'text', text: string }
    const textItem = (content as unknown[]).find(isToolContentText);
    if (textItem) return safeParseJSON(textItem.text);
  } catch (err) {
    console.error(err);
  }
  return undefined;
}

/**
 * Ensure the assistant answer is presented as Markdown. If the text lacks
 * any Markdown structure, wrap it with a minimal heading and bullet points.
 */
export function ensureMarkdownMinimum(answer: string): string {
  try {
    const text = String(answer ?? "").trim();
    if (!text) return "";

    const hasMd =
      /(^\s{0,3}#{1,6}\s)|(^\s*[-*+]\s)|(\n\n-\s)|(\n\n\d+\.\s)|(```)|(^\s*>\s)|(\*\*[^*]+\*\*)|(`[^`]+`)/m.test(
        text
      );
    if (hasMd) return text;

    // If it's likely JSON, fence it for readability
    const stripped = stripJsonFences(text);
    if (/^[\[{]/.test(stripped)) {
      try {
        JSON.parse(stripped);
        return "```json\n" + stripped + "\n```";
      } catch (err) {
        console.error(err);
      }
    }

    // Build bullets from lines or sentences
    const lines = stripped.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const items =
      lines.length > 1
        ? lines
        : stripped.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);

    const heading = "### Answer";
    const bullets = items.map((s) => `- ${s}`);
    return [heading, "", ...bullets].join("\n");
  } catch (err) {
    console.error(err);
    return String(answer ?? "");
  }
}

// Normalize LLM tool args to match Medusa Admin expectations
export function normalizeToolArgs(input: unknown, toolName?: string): JSONValue {
  const needsDollar = new Set([
    "gt",
    "gte",
    "lt",
    "lte",
    "eq",
    "ne",
    "in",
    "nin",
    "not",
    "like",
    "ilike",
    "re",
    "fulltext",
    "overlap",
    "contains",
    "contained",
    "exists",
    "and",
    "or",
  ]);

  const toNumberIfNumericString = (v: unknown): unknown =>
    typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;

  const walk = (val: JSONValue, keyPath: string[] = []): JSONValue => {
    if (Array.isArray(val)) {
      const lastKey = keyPath[keyPath.length - 1];
      if (lastKey === "fields") return val.map(String).join(",");
      return (val as JSONValue[]).map((v) => walk(v, keyPath)) as JSONArray;
    }
    if (isJSONObject(val)) {
      const out: JSONObject = {};
      for (const [k, v] of Object.entries(val)) {
        const bare = k.replace(/^\$/g, "");
        const newKey = needsDollar.has(bare) ? `$${bare}` : k;
        out[newKey] = walk(v, [...keyPath, newKey]);
      }
      return out;
    }
    const last = keyPath[keyPath.length - 1];
    if (last === "limit" || last === "offset") return toNumberIfNumericString(val) as JSONValue;
    return val;
  };

  const normalized = walk((input as JSONValue) ?? null);

  // Special normalization for abandoned_carts tool: coerce natural keys
  if (toolName === "abandoned_carts" && isJSONObject(normalized)) {
    const out: JSONObject = { ...normalized };

    const isDefined = (v: unknown): boolean => v !== undefined && v !== null && v !== "";

    const toInt = (v: unknown): number | undefined => {
      if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
      if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return parseInt(v.trim(), 10);
      return undefined;
    };

    const toBool = (v: unknown): boolean | undefined => {
      if (typeof v === "boolean") return v;
      if (typeof v === "number") return v !== 0;
      if (typeof v === "string") {
        const s = v.trim().toLowerCase();
        if (["true", "1", "yes", "y"].includes(s)) return true;
        if (["false", "0", "no", "n"].includes(s)) return false;
      }
      return undefined;
    };

    const parseMinutes = (v: unknown): number | undefined => {
      if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.trunc(v));
      if (typeof v !== "string") return undefined;
      const s = v.trim().toLowerCase().replace(/ago$/, "").trim();
      const m1 = s.match(/^(\d+(?:\.\d+)?)(m|h|d)$/i);
      if (m1) {
        const n = parseFloat(m1[1]);
        const u = m1[2].toLowerCase();
        if (u === "m") return Math.round(n);
        if (u === "h") return Math.round(n * 60);
        if (u === "d") return Math.round(n * 1440);
      }
      const m2 = s.match(
        /^(\d+(?:\.\d+)?)\s*(minute|minutes|min|m|hour|hours|hr|h|day|days|d)$/i
      );
      if (m2) {
        const n = parseFloat(m2[1]);
        const u = m2[2].toLowerCase();
        if (["minute", "minutes", "min", "m"].includes(u)) return Math.round(n);
        if (["hour", "hours", "hr", "h"].includes(u)) return Math.round(n * 60);
        if (["day", "days", "d"].includes(u)) return Math.round(n * 1440);
      }
      const num = toInt(s);
      return typeof num === "number" ? Math.max(0, num) : undefined;
    };

    const pick = (obj: JSONObject, keys: string[]): unknown => {
      for (const k of keys) if (isDefined(obj?.[k])) return obj[k];
      return undefined;
    };

    // minutes: prefer explicit older_than_minutes, else map aliases
    const olderRaw = pick(out, [
      "older_than_minutes",
      "threshold",
      "threshold_minutes",
      "min_last_updated",
      "minutes_old",
      "min_age",
    ]);

    if (!isDefined(out.older_than_minutes) && isDefined(olderRaw)) {
      const unitRaw = pick(out, ["threshold_unit", "unit"]);
      const unit = typeof unitRaw === "string" ? unitRaw.toLowerCase().trim() : "";
      let mins: number | undefined;
      const n = toInt(olderRaw);
      if (typeof n === "number") {
        if (!unit || ["m", "min", "minute", "minutes"].includes(unit)) mins = n;
        else if (["h", "hour", "hours"].includes(unit)) mins = n * 60;
        else if (["d", "day", "days"].includes(unit)) mins = n * 1440;
      }
      mins ??= parseMinutes(olderRaw);
      if (typeof mins === "number") out.older_than_minutes = mins;
    }

    // email requirement: map various flags to require_email false
    if (!isDefined(out.require_email)) {
      const flags = [
        out.include_email_less,
        out.include_emailless,
        out.include_without_email,
        out.without_email,
        out.even_without_email,
      ];
      const anyFlag = flags.map(toBool).some((b) => b === true);
      if (anyFlag) out.require_email = false;
    }

    return out;
  }

  // Rely on medusa-mcp analytics tools to interpret sorting hints
  return normalized;
}

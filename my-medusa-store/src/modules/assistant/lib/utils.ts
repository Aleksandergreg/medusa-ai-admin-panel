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
export interface JSONObject {
  [key: string]: JSONValue;
}
export type JSONArray = JSONValue[];

/** Type guards */
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

const isJSONObject = (v: unknown): v is JSONObject =>
  isObject(v) && !Array.isArray(v);

/**
 * Parse a JSON-looking string safely. Returns T if you know the shape,
 * otherwise defaults to JSONValue.
 */
export function safeParseJSON<T = JSONValue>(
  maybeJson: unknown
): T | undefined {
  if (typeof maybeJson !== "string") return undefined;
  const stripped = stripJsonFences(maybeJson).trim();

  // Try direct parse first
  try {
    return JSON.parse(stripped) as T;
  } catch {
    // Silent fallback - errors are handled by callers
  }

  // Try object slice { ... }
  const firstObj = stripped.indexOf("{");
  const lastObj = stripped.lastIndexOf("}");
  if (firstObj !== -1 && lastObj !== -1 && lastObj > firstObj) {
    try {
      return JSON.parse(stripped.slice(firstObj, lastObj + 1)) as T;
    } catch {
      // Silent fallback - errors are handled by callers
    }
  }

  // Try array slice [ ... ]
  const firstArr = stripped.indexOf("[");
  const lastArr = stripped.lastIndexOf("]");
  if (firstArr !== -1 && lastArr !== -1 && lastArr > firstArr) {
    try {
      return JSON.parse(stripped.slice(firstArr, lastArr + 1)) as T;
    } catch {
      // Silent fallback - errors are handled by callers
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

export function extractToolJsonPayload(
  toolResult: unknown
): JSONValue | undefined {
  try {
    const content = isObject(toolResult)
      ? (toolResult as { content?: unknown }).content
      : undefined;
    if (!Array.isArray(content)) return undefined;

    // find the first { type: 'text', text: string }
    const textItem = (content as unknown[]).find(isToolContentText);
    if (textItem) return safeParseJSON(textItem.text);
  } catch {
    // Silent fallback - errors are handled by callers
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
    if (/^[[{]/.test(stripped)) {
      try {
        JSON.parse(stripped);
        return "```json\n" + stripped + "\n```";
      } catch {
        // Not valid JSON, continue with regular formatting
      }
    }

    // Build bullets from lines or sentences
    const lines = stripped
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const items =
      lines.length > 1
        ? lines
        : stripped
            .split(/(?<=[.!?])\s+/)
            .map((s) => s.trim())
            .filter(Boolean);

    const heading = "### Answer";
    const bullets = items.map((s) => `- ${s}`);
    return [heading, "", ...bullets].join("\n");
  } catch {
    // Silent fallback - return original answer
    return String(answer ?? "");
  }
}

// Normalize LLM tool args to match Medusa Admin expectations
export function normalizeToolArgs(input: unknown): JSONValue {
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
    if (last === "limit" || last === "offset")
      return toNumberIfNumericString(val) as JSONValue;
    return val;
  };

  const normalized = walk((input as JSONValue) ?? null);

  // Rely on medusa-mcp analytics tools to interpret sorting hints
  return normalized;
}

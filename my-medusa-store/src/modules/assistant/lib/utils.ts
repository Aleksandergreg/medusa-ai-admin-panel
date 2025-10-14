// Common utilities used by the assistant module

export function env(key: string): string | undefined {
  return (process.env as NodeJS.ProcessEnv)?.[key];
}

export function stripJsonFences(text: string): string {
  try {
    const t = String(text ?? "");
    // Match any fenced block (```lang\n...\n```), prefer the first
    const fence = /```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```/i;
    const m = t.match(fence);
    return m ? m[1] : t;
  } catch {
    return String(text ?? "");
  }
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

// Common record check used across agent modules
export const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Parse a JSON-looking string safely. Returns T if you know the shape,
 * otherwise defaults to JSONValue.
 */
export function safeParseJSON<T = JSONValue>(
  maybeJson: unknown
): T | undefined {
  if (typeof maybeJson !== "string") return undefined;

  // Normalize input: remove BOM, strip fences, and trim
  const source = stripJsonFences(maybeJson)
    .replace(/^\uFEFF/, "")
    .trim();

  // 1) Try direct strict parse
  try {
    return JSON.parse(source) as T;
  } catch {
    // continue
  }

  // Helper: extract the first complete top-level JSON block ({...} or [...])
  const extractFirstJsonBlock = (s: string): string | undefined => {
    let inString = false;
    let escape = false;
    let start = -1;
    let depth = 0;
    let opener: "{" | "[" | null = null;

    for (let i = 0; i < s.length; i++) {
      const ch = s[i];

      if (inString) {
        if (escape) {
          escape = false;
        } else if (ch === "\\") {
          escape = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === "{" || ch === "[") {
        if (depth === 0) {
          start = i;
          opener = ch as "{" | "[";
        }
        depth++;
        continue;
      }
      if (ch === "}" || ch === "]") {
        if (depth > 0) depth--;
        if (depth === 0 && start !== -1) {
          // Validate matching pair
          if (
            (opener === "{" && ch !== "}") ||
            (opener === "[" && ch !== "]")
          ) {
            return undefined;
          }
          return s.slice(start, i + 1);
        }
      }
    }
    return undefined;
  };

  // Helper: remove trailing commas that commonly sneak into LLM JSON
  const removeTrailingCommas = (s: string): string => {
    let inString = false;
    let escape = false;
    let out = "";
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (inString) {
        out += ch;
        if (escape) {
          escape = false;
        } else if (ch === "\\") {
          escape = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        out += ch;
        continue;
      }
      if (ch === ",") {
        // Look ahead: if the next non-space is '}' or ']', drop this comma
        let j = i + 1;
        while (j < s.length && /\s/.test(s[j])) j++;
        if (j < s.length && (s[j] === "}" || s[j] === "]")) {
          // skip this comma
          continue;
        }
      }
      out += ch;
    }
    return out;
  };

  // 2) Try to extract the first JSON block inside free text
  const block = extractFirstJsonBlock(source);
  if (block) {
    // Try strict parse first
    try {
      return JSON.parse(block) as T;
    } catch {
      // Attempt to repair common JSON mistakes (e.g., trailing commas)
      try {
        const repaired = removeTrailingCommas(block);
        return JSON.parse(repaired) as T;
      } catch {
        // fall through
      }
    }
  }

  // 3) As a final fallback, try repairing the whole source
  try {
    const repaired = removeTrailingCommas(source);
    return JSON.parse(repaired) as T;
  } catch {
    // give up
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

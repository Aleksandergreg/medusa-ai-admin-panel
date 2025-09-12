// Common utilities used by the assistant module

export function env(key: string): string | undefined {
  return (process.env as any)?.[key];
}

export function stripJsonFences(text: string): string {
  const fence = /```(?:json)?\n([\s\S]*?)\n```/i;
  const m = text?.match?.(fence);
  return m ? m[1] : text;
}

export function safeParseJSON(maybeJson: unknown): any | undefined {
  if (typeof maybeJson !== "string") return undefined;
  const stripped = stripJsonFences(maybeJson).trim();
  // Try direct parse first
  try {
    return JSON.parse(stripped);
  } catch {}

  // Try object slice { ... }
  const firstObj = stripped.indexOf("{");
  const lastObj = stripped.lastIndexOf("}");
  if (firstObj !== -1 && lastObj !== -1 && lastObj > firstObj) {
    try {
      return JSON.parse(stripped.slice(firstObj, lastObj + 1));
    } catch {}
  }

  // Try array slice [ ... ]
  const firstArr = stripped.indexOf("[");
  const lastArr = stripped.lastIndexOf("]");
  if (firstArr !== -1 && lastArr !== -1 && lastArr > firstArr) {
    try {
      return JSON.parse(stripped.slice(firstArr, lastArr + 1));
    } catch {}
  }
  return undefined;
}

// MCP result: { content: [{ type:"text", text: "...json..." }], isError? }
export function extractToolJsonPayload(toolResult: any): any | undefined {
  try {
    const textItem = toolResult?.content?.find?.(
      (c: any) => c?.type === "text"
    );
    if (textItem?.text) return safeParseJSON(textItem.text);
  } catch {}
  return undefined;
}

// Normalize LLM tool args to match Medusa Admin expectations
export function normalizeToolArgs(input: any, toolName?: string): any {
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

  const toNumberIfNumericString = (v: unknown) =>
    typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;

  const walk = (val: any, keyPath: string[] = []): any => {
    if (Array.isArray(val)) {
      const lastKey = keyPath[keyPath.length - 1];
      if (lastKey === "fields") return val.map(String).join(",");
      return val.map((v) => walk(v, keyPath));
    }
    if (val && typeof val === "object") {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(val)) {
        const bare = k.replace(/^\$/g, "");
        const newKey = needsDollar.has(bare) ? `$${bare}` : k;
        out[newKey] = walk(v, [...keyPath, newKey]);
      }
      return out;
    }
    const last = keyPath[keyPath.length - 1];
    if (last === "limit" || last === "offset")
      return toNumberIfNumericString(val);
    return val;
  };

  const normalized = walk(input);

  // Special normalization for abandoned_carts tool: coerce natural keys
  if (toolName === "abandoned_carts" && normalized && typeof normalized === "object") {
    const out: Record<string, any> = { ...normalized };

    const isDefined = (v: any) => v !== undefined && v !== null && v !== "";
    const toInt = (v: any): number | undefined => {
      if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
      if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return parseInt(v.trim(), 10);
      return undefined;
    };
    const toBool = (v: any): boolean | undefined => {
      if (typeof v === "boolean") return v;
      if (typeof v === "number") return v !== 0;
      if (typeof v === "string") {
        const s = v.trim().toLowerCase();
        if (["true", "1", "yes", "y"].includes(s)) return true;
        if (["false", "0", "no", "n"].includes(s)) return false;
      }
      return undefined;
    };
    const parseMinutes = (v: any): number | undefined => {
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
      const m2 = s.match(/^(\d+(?:\.\d+)?)\s*(minute|minutes|min|m|hour|hours|hr|h|day|days|d)$/i);
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

    const pick = (obj: any, keys: string[]) => {
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
      const unit = String(pick(out, ["threshold_unit", "unit"]) ?? "").toLowerCase().trim();
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

  return normalized;
}

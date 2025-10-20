import { HistoryEntry } from "../lib/types";

type CachedEntry = {
  entry: HistoryEntry;
  args: unknown;
};

const APPROXIMATE_TOOLS = new Set(["openapi.execute"]);
const TIMESTAMP_KEY_PATTERN = /(_at|At)$/;
const TIMESTAMP_TOLERANCE_MS = 90_000;

export class ToolDedupeCache {
  private readonly cache = new Map<string, CachedEntry>();
  private readonly indexByTool = new Map<string, Set<string>>();

  get(
    toolName: string,
    args: unknown,
    cacheable: boolean
  ): HistoryEntry | undefined {
    if (!cacheable) {
      return undefined;
    }

    const key = this.key(toolName, args);
    const direct = this.cache.get(key);
    if (direct) {
      return direct.entry;
    }

    if (!APPROXIMATE_TOOLS.has(toolName)) {
      return undefined;
    }

    const candidates = this.indexByTool.get(toolName);
    if (!candidates?.size) {
      return undefined;
    }

    for (const candidateKey of candidates) {
      const candidate = this.cache.get(candidateKey);
      if (!candidate) {
        continue;
      }
      if (this.isApproximatelyEqual(candidate.args, args)) {
        return candidate.entry;
      }
    }

    return undefined;
  }

  set(
    toolName: string,
    args: unknown,
    entry: HistoryEntry,
    cacheable: boolean
  ): void {
    if (!cacheable) {
      return;
    }

    const key = this.key(toolName, args);
    this.cache.set(key, { entry, args });

    const bucket = this.indexByTool.get(toolName);
    if (bucket) {
      bucket.add(key);
    } else {
      this.indexByTool.set(toolName, new Set([key]));
    }
  }

  private key(toolName: string, args: unknown): string {
    return `${toolName}:${this.stringify(args)}`;
  }

  private stringify(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((entry) => this.stringify(entry)).join(",")}]`;
    }
    if (this.isPlainObject(value)) {
      const entries = Object.entries(value).sort(([a], [b]) =>
        a.localeCompare(b)
      );
      return `{${entries
        .map(([key, val]) => `${JSON.stringify(key)}:${this.stringify(val)}`)
        .join(",")}}`;
    }
    if (value === undefined) {
      return "undefined";
    }
    return JSON.stringify(value);
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private isApproximatelyEqual(
    a: unknown,
    b: unknown,
    path: string[] = []
  ): boolean {
    if (a === b) {
      return true;
    }

    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) {
        return false;
      }
      for (let i = 0; i < a.length; i += 1) {
        if (!this.isApproximatelyEqual(a[i], b[i], [...path, String(i)])) {
          return false;
        }
      }
      return true;
    }

    if (this.isPlainObject(a) && this.isPlainObject(b)) {
      const keysA = Object.keys(a).sort();
      const keysB = Object.keys(b).sort();
      if (keysA.length !== keysB.length) {
        return false;
      }
      for (let i = 0; i < keysA.length; i += 1) {
        if (keysA[i] !== keysB[i]) {
          return false;
        }
      }
      for (const key of keysA) {
        if (
          !this.isApproximatelyEqual(a[key], b[key], [...path, key])
        ) {
          return false;
        }
      }
      return true;
    }

    if (
      typeof a === "string" &&
      typeof b === "string" &&
      this.isTimestampKey(path[path.length - 1]) &&
      this.areTimestampsClose(a, b)
    ) {
      return true;
    }

    return false;
  }

  private isTimestampKey(key?: string): boolean {
    return !!key && TIMESTAMP_KEY_PATTERN.test(key);
  }

  private areTimestampsClose(first: string, second: string): boolean {
    const a = this.parseTimestamp(first);
    const b = this.parseTimestamp(second);
    if (a === null || b === null) {
      return false;
    }
    return Math.abs(a - b) <= TIMESTAMP_TOLERANCE_MS;
  }

  private parseTimestamp(value: string): number | null {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const normalized = trimmed.includes("T")
      ? trimmed
      : trimmed.replace(" ", "T");

    const parsed = Date.parse(normalized);
    if (Number.isNaN(parsed)) {
      const parsedUtc = Date.parse(`${normalized}Z`);
      return Number.isNaN(parsedUtc) ? null : parsedUtc;
    }

    return parsed;
  }
}

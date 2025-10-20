import { HistoryEntry } from "../lib/types";

export class ToolDedupeCache {
  private readonly cache = new Map<string, HistoryEntry>();

  get(toolName: string, args: unknown, cacheable: boolean): HistoryEntry | undefined {
    if (!cacheable) {
      return undefined;
    }
    return this.cache.get(this.key(toolName, args));
  }

  set(toolName: string, args: unknown, entry: HistoryEntry, cacheable: boolean): void {
    if (!cacheable) {
      return;
    }
    this.cache.set(this.key(toolName, args), entry);
  }

  private key(toolName: string, args: unknown): string {
    return `${toolName}:${this.stringify(args)}`;
  }

  private stringify(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((entry) => this.stringify(entry)).join(",")}]`;
    }
    if (value && typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>).sort(
        ([a], [b]) => a.localeCompare(b)
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
}

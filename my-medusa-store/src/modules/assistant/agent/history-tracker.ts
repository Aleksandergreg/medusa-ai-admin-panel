import { HistoryEntry } from "../lib/types";
import { extractToolJsonPayload } from "../lib/utils";

const DUPLICATE_NOTE_REASON = "duplicate_tool_call";
const DUPLICATE_NOTE_MESSAGE =
  "Skipped identical tool call because the same request already succeeded earlier in this conversation. Reuse the previous result instead of repeating the POST.";

export class HistoryTracker {
  private readonly entries: HistoryEntry[];
  private readonly successCache = new Map<string, HistoryEntry>();

  constructor(initialHistory: HistoryEntry[] = []) {
    this.entries = [...initialHistory];
  }

  get list(): HistoryEntry[] {
    return this.entries;
  }

  latestPayload(): unknown {
    for (let i = this.entries.length - 1; i >= 0; i -= 1) {
      const entry = this.entries[i];
      if (!entry) continue;
      if (
        typeof entry.tool_name === "string" &&
        entry.tool_name.startsWith("assistant.")
      ) {
        continue;
      }
      const payload = extractToolJsonPayload(entry.tool_result);
      if (payload !== undefined) {
        return payload;
      }
    }
    return undefined;
  }

  getCachedSuccess(
    toolName: string,
    args: unknown,
    cacheable: boolean
  ): HistoryEntry | undefined {
    if (!cacheable) {
      return undefined;
    }
    const key = createToolCallKey(toolName, args);
    return this.successCache.get(key);
  }

  recordDuplicate(toolName: string): void {
    this.entries.push({
      tool_name: "assistant.note",
      tool_args: {
        reason: DUPLICATE_NOTE_REASON,
        tool_name: toolName,
      },
      tool_result: {
        message: DUPLICATE_NOTE_MESSAGE,
      },
    });
  }

  recordError(
    toolName: string,
    args: unknown,
    error: Record<string, unknown>
  ): void {
    this.entries.push({
      tool_name: toolName,
      tool_args: args,
      tool_result: error,
    });
  }

  recordResult(
    toolName: string,
    args: unknown,
    result: unknown,
    cacheable: boolean
  ): HistoryEntry {
    const entry: HistoryEntry = {
      tool_name: toolName,
      tool_args: args,
      tool_result: result,
    };
    this.entries.push(entry);

    if (cacheable) {
      const key = createToolCallKey(toolName, args);
      this.successCache.set(key, entry);
    }

    return entry;
  }

  recordSummary(sourceTool: string, summary: unknown): void {
    this.entries.push({
      tool_name: "assistant.summary",
      tool_args: { source_tool: sourceTool },
      tool_result: { assistant_summary: summary },
    });
  }
}

export function isMutatingExecuteCall(args: unknown): boolean {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return false;
  }
  return "body" in (args as Record<string, unknown>);
}

function createToolCallKey(toolName: string, args: unknown): string {
  return `${toolName}:${stableStringify(args)}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => a.localeCompare(b)
    );
    return `{${entries
      .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`)
      .join(",")}}`;
  }
  if (value === undefined) {
    return "undefined";
  }
  return JSON.stringify(value);
}
